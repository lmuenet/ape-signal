// src/paper/tickPipeline.ts — one MONITOR tick of Mr Ape's depot (ADR 0003):
// deterministic fill check every run; the MANAGER (one Sonnet call) is woken
// only by a hard event, a breached wake band (cooldown-limited) or the close.
// Telegram hears events, the bundled manager note and the daily summary;
// silent monitor ticks post nothing.
import { applyAdjustments, applyTick } from "./engine";
import { checkWakeBands, consumeBands, ensureBands, type WakeBreach } from "./wake";
import {
  describeAdjustment,
  formatDailySummary,
  formatEvent,
  formatManagerNote,
  renderPortfolio,
  renderQuotes,
} from "./format";
import { buildTickPrompt } from "./prompts";
import { parseTickResponse } from "./decision";
import { healthLine, recordQuoteFailure, recordQuoteSuccess, type HealthState } from "./health";
import { WAKE, type Portfolio, type QuoteMap, type TickEvent } from "./types";

export interface TickDeps {
  loadPortfolio: () => Portfolio;
  savePortfolio: (p: Portfolio) => void;
  appendJournal: (title: string, body: string) => void;
  readJournalTail: () => string;
  fetchQuotes: (tickers: string[]) => Promise<QuoteMap>;
  /** Persist this tick's quotes into the tick history (ADR 0004). Optional in tests. */
  recordTick?: (day: string, atIso: string, quotes: QuoteMap) => void;
  /** Operational health for `day` (Lebenszeichen spec): stats + failure counters. */
  loadHealth: (day: string) => HealthState;
  /** Persist health. Failures are caught by the pipeline (never break a tick). */
  saveHealth: (h: HealthState) => void;
  /** Sonnet runner (the manager role). */
  claudeRunner: (prompt: string) => Promise<string>;
  send: (text: string) => Promise<void>;
  now?: () => Date;
  berlinDay: (d: Date) => string;
  berlinStamp: (d: Date) => string;
}

export interface TickOptions {
  isClose: boolean;
}

function describeBreach(b: WakeBreach): string {
  return `⚡ ${b.ticker}: Kurs ${b.price} riss Wake-Band ${b.side === "above" ? "oben" : "unten"} (${b.level})`;
}

function trySaveHealth(deps: TickDeps, h: HealthState): void {
  try {
    deps.saveHealth(h);
  } catch (err) {
    console.error(`[tick] saving health failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function runTick(opts: TickOptions, deps: TickDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const day = deps.berlinDay(now);
  const stamp = deps.berlinStamp(now);

  let portfolio = deps.loadPortfolio();
  const tickers = [...new Set([...portfolio.positions, ...portfolio.orders].map((x) => x.ticker))];
  const hadActivity =
    portfolio.positions.length > 0 ||
    portfolio.orders.length > 0 ||
    portfolio.history.some((t) => t.closedAt.startsWith(day));

  if (tickers.length === 0 && !(opts.isClose && hadActivity)) {
    console.log("[tick] nothing to do (no open positions/orders).");
    return;
  }

  let health = deps.loadHealth(day);
  let quotes: QuoteMap = {};
  // The close tick must never skip (it is the daily lifesign): on a fetch
  // failure it falls back to the last known quotes for VALUATION ONLY.
  let staleClose = false;
  if (tickers.length > 0) {
    try {
      quotes = await deps.fetchQuotes(tickers);
    } catch (err) {
      console.error(`[tick] quote fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      const failed = recordQuoteFailure(health);
      health = failed.health;
      trySaveHealth(deps, health);
      if (failed.alert) {
        await deps.send(`⚠️ Monitor blind: ${health.consecutiveQuoteFailures} Ticks ohne Kurse — Stops werden nicht geprüft.`);
      }
      // No quotes → no evidence → skipping the monitor tick is the safe move
      // (state untouched; the next tick's day-extreme rule catches up).
      if (!opts.isClose) return;
      staleClose = true;
      quotes = portfolio.lastTick?.quotes ?? {};
    }
    if (!staleClose) {
      const ok = recordQuoteSuccess(health);
      health = ok.health;
      trySaveHealth(deps, health);
      if (ok.allClear) await deps.send("✅ Monitor wieder ok — Kurse kommen wieder durch.");
      try {
        deps.recordTick?.(day, now.toISOString(), quotes);
      } catch (err) {
        console.error(`[tick] recording tick history failed (charts lose one point): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // --- Monitor path: deterministic engine + wake-band check. ---
  const { portfolio: afterFills, events } = applyTick(portfolio, quotes, {
    now: now.toISOString(),
    day,
    isClose: opts.isClose,
  });
  portfolio = afterFills;

  const breaches = checkWakeBands(portfolio.positions, quotes);
  if (breaches.length > 0) portfolio = consumeBands(portfolio, breaches);
  deps.savePortfolio(portfolio);

  if (events.length > 0) {
    const lines = events.map(formatEvent);
    deps.appendJournal(`Tick ${stamp.slice(11)}`, lines.join("\n"));
    await deps.send(lines.join("\n"));
  }

  // --- Manager path: wake Sonnet only with a reason (ADR 0003). ---
  const hasOpen = portfolio.positions.length > 0 || portfolio.orders.length > 0;
  const cooldownOver =
    portfolio.lastManagerCallAt === undefined ||
    now.getTime() - Date.parse(portfolio.lastManagerCallAt) >= WAKE.cooldownMinutes * 60_000;
  const wake = hasOpen && (events.length > 0 || opts.isClose || (breaches.length > 0 && cooldownOver));

  if (wake) {
    try {
      const raw = await deps.claudeRunner(
        buildTickPrompt({
          stamp,
          portfolioBlock: renderPortfolio(portfolio, quotes),
          quotesBlock: renderQuotes(quotes),
          eventsBlock: events.map(formatEvent).join("\n"),
          wakeBlock: breaches.map(describeBreach).join("\n"),
          journalTail: deps.readJournalTail(),
          isClose: opts.isClose,
        }),
      );
      portfolio = { ...portfolio, lastManagerCallAt: now.toISOString() };

      const response = parseTickResponse(raw);
      if (response && (response.adjustments.length > 0 || response.journal.trim() !== "")) {
        const result = applyAdjustments(portfolio, response.adjustments, quotes, now.toISOString());
        portfolio = result.portfolio;

        const noteLines: string[] = [];
        if (response.journal.trim() !== "") noteLines.push(response.journal.trim());
        for (const a of result.applied) noteLines.push(`→ ${describeAdjustment(a)}`);
        for (const r of result.rejected) noteLines.push(`✗ abgelehnt (${r.reason}): ${describeAdjustment(r.adjustment)}`);
        if (noteLines.length > 0) deps.appendJournal(`Tick ${stamp.slice(11)} — Mr Ape`, noteLines.join("\n"));

        const closeEvents = result.events.filter((e: TickEvent) => e.kind === "position-closed");
        const bundle = formatManagerNote(stamp.slice(11), response.journal, result.applied, result.rejected, closeEvents);
        if (bundle !== "") await deps.send(bundle);
      }
      deps.savePortfolio(portfolio);
    } catch (err) {
      // Stops stay where they are — the deterministic engine keeps protecting.
      console.error(`[tick] manager call failed, keeping current stops: ${err instanceof Error ? err.message : String(err)}`);
      try {
        await deps.send("⚠️ Mr Ape nicht erreichbar (Manager-Call fehlgeschlagen) — Stops bleiben unverändert.");
      } catch (sendErr) {
        console.error(`[tick] failed to send manager-failure alert: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
      }
    }
  }

  // --- Fallback bands: every quoted position always carries a band. ---
  const ensured = ensureBands(portfolio, quotes);
  if (ensured.changed) {
    portfolio = ensured.portfolio;
    deps.savePortfolio(portfolio);
  }

  if (opts.isClose && hadActivity) {
    const summary = formatDailySummary(portfolio, quotes, day);
    deps.appendJournal("Tagesabschluss", summary);
    await deps.send(summary);
  }
}
