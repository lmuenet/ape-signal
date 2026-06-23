// src/paper/tickPipeline.ts — one MONITOR tick of Mr Ape's depot (ADR 0003):
// deterministic fill check every run; the MANAGER (one Sonnet call) is woken
// only by a hard event, a breached wake band (cooldown-limited) or the close.
// Telegram hears events, the bundled manager note and the daily summary;
// silent monitor ticks post nothing.
import { applyAdjustments, applyTick, expireDayOrders } from "./engine";
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
import { toHoldings, type QuoteHolding } from "./quotes";
import { WAKE, type Adjustment, type Portfolio, type QuoteMap, type TickEvent } from "./types";
import type { Language } from "../core/language";
import { ClaudeError } from "../claude/invoke";
import type { Notify } from "../telegram/notify";

export interface TickDeps {
  loadPortfolio: () => Portfolio;
  savePortfolio: (p: Portfolio) => void;
  appendJournal: (title: string, body: string) => void;
  readJournalTail: () => string;
  /** Price the held instruments on their stored EUR venue (deSymbol). Keyed by ticker. */
  fetchQuotes: (holdings: QuoteHolding[]) => Promise<QuoteMap>;
  /** Persist this tick's quotes into the tick history (ADR 0004). Optional in tests. */
  recordTick?: (day: string, atIso: string, quotes: QuoteMap) => void;
  /** Operational health for `day` (Lebenszeichen spec): stats + failure counters. */
  loadHealth: (day: string) => HealthState;
  /** Persist health. Failures are caught by the pipeline (never break a tick). */
  saveHealth: (h: HealthState) => void;
  /** Sonnet runner (the manager role). */
  claudeRunner: (prompt: string) => Promise<string>;
  send: Notify;
  now?: () => Date;
  berlinDay: (d: Date) => string;
  berlinStamp: (d: Date) => string;
  language?: Language;
  /** Effektives Tick-Intervall in Minuten (A2). Fehlt → keine Drossel. */
  tickIntervalMin?: number;
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
  // One holding per ticker, carrying the EUR venue (deSymbol/isin) so the fetch
  // prices each on the venue it was entered on. `tickers` stays the dedup'd
  // ticker list the activity/skip guards below use.
  const holdings = toHoldings([...portfolio.positions, ...portfolio.orders]);
  const tickers = holdings.map((h) => h.ticker);
  const hadActivity =
    portfolio.positions.length > 0 ||
    portfolio.orders.length > 0 ||
    portfolio.history.some((t) => t.closedAt.startsWith(day));

  if (tickers.length === 0 && !(opts.isClose && hadActivity)) {
    console.log("[tick] nothing to do (no open positions/orders).");
    return;
  }

  // --- Tick-Intervall-Drossel (A2): einen zu frühen Monitor-Tick überspringen,
  // BEVOR wir TradingView nach Kursen fragen. Der Close-Tick drosselt nie. ---
  if (!opts.isClose && deps.tickIntervalMin !== undefined && portfolio.lastTickAt) {
    const elapsedMs = now.getTime() - Date.parse(portfolio.lastTickAt);
    if (elapsedMs < deps.tickIntervalMin * 60_000) {
      console.log(`[tick] throttled (interval ${deps.tickIntervalMin}min not elapsed).`);
      return;
    }
  }
  // Diesen Tick als "echten" Tick markieren; reist in den nächsten savePortfolio mit.
  portfolio = { ...portfolio, lastTickAt: now.toISOString() };

  let health = deps.loadHealth(day);
  let quotes: QuoteMap = {};
  // The close tick must never skip (it is the daily lifesign): on a fetch
  // failure it falls back to the last known quotes for VALUATION ONLY.
  let staleClose = false;
  if (tickers.length > 0) {
    try {
      quotes = await deps.fetchQuotes(holdings);
    } catch (err) {
      console.error(`[tick] quote fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      const failed = recordQuoteFailure(health);
      health = failed.health;
      trySaveHealth(deps, health);
      if (failed.alert) {
        await deps.send(`⚠️ Monitor blind: ${health.consecutiveQuoteFailures} Ticks ohne Kurse — Stops werden nicht geprüft.`, "alert");
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
      if (ok.allClear) await deps.send("✅ Monitor wieder ok — Kurse kommen wieder durch.", "alert");
      try {
        deps.recordTick?.(day, now.toISOString(), quotes);
      } catch (err) {
        console.error(`[tick] recording tick history failed (charts lose one point): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // --- Monitor path: deterministic engine + wake-band check. ---
  // Stale quotes never drive fills, stops or band checks (they are the
  // evidence baseline itself); only the time-based expiry still runs.
  let events: TickEvent[];
  let breaches: WakeBreach[] = [];
  if (staleClose) {
    const expired = expireDayOrders(portfolio, day);
    portfolio = expired.portfolio;
    events = expired.events;
  } else {
    const afterTick = applyTick(portfolio, quotes, {
      now: now.toISOString(),
      day,
      isClose: opts.isClose,
    });
    portfolio = afterTick.portfolio;
    events = afterTick.events;
    breaches = checkWakeBands(portfolio.positions, quotes);
    if (breaches.length > 0) portfolio = consumeBands(portfolio, breaches);
  }
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
  // A stale close never wakes the manager: a close_position adjustment would
  // execute at stale quotes — exactly the kind of fill stale quotes must not drive.
  const wake =
    !staleClose && hasOpen && (events.length > 0 || opts.isClose || (breaches.length > 0 && cooldownOver));

  if (wake) {
    const breachLines = breaches.map(describeBreach);
    try {
      const raw = await deps.claudeRunner(
        buildTickPrompt({
          stamp,
          portfolioBlock: renderPortfolio(portfolio, quotes),
          quotesBlock: renderQuotes(quotes),
          eventsBlock: events.map(formatEvent).join("\n"),
          wakeBlock: breachLines.join("\n"),
          journalTail: deps.readJournalTail(),
          isClose: opts.isClose,
          language: deps.language ?? "de",
        }),
      );
      portfolio = { ...portfolio, lastManagerCallAt: now.toISOString() };

      const response = parseTickResponse(raw);
      const journalText = response?.journal.trim() ?? "";
      let applied: Adjustment[] = [];
      let rejected: Array<{ adjustment: Adjustment; reason: string }> = [];
      let closeEvents: TickEvent[] = [];
      if (response && response.adjustments.length > 0) {
        const result = applyAdjustments(portfolio, response.adjustments, quotes, now.toISOString());
        portfolio = result.portfolio;
        applied = result.applied;
        rejected = result.rejected;
        closeEvents = result.events.filter((e: TickEvent) => e.kind === "position-closed");
      }

      const noteLines: string[] = [];
      if (journalText !== "") noteLines.push(journalText);
      for (const a of applied) noteLines.push(`→ ${describeAdjustment(a)}`);
      for (const r of rejected) noteLines.push(`✗ abgelehnt (${r.reason}): ${describeAdjustment(r.adjustment)}`);
      if (noteLines.length > 0) deps.appendJournal(`Tick ${stamp.slice(11)} — Mr Ape`, noteLines.join("\n"));

      // A band breach is always surfaced (with Mr Ape's hold reason when he
      // gives one), so a wake never ends in silence (ADR 0003 amendment). A
      // hard-event/close wake without a breach stays quiet on a no-op as before.
      const bundle = formatManagerNote(stamp.slice(11), journalText, applied, rejected, closeEvents, breachLines);
      if (bundle !== "") await deps.send(bundle);
      deps.savePortfolio(portfolio);
    } catch (err) {
      // Stops stay where they are — the deterministic engine keeps protecting.
      console.error(`[tick] manager call failed, keeping current stops: ${err instanceof Error ? err.message : String(err)}`);
      const reason =
        err instanceof ClaudeError && err.kind === "limit"
          ? "⚠️ Claude limitiert (Usage-Limit) — Mr Ape pausiert; Stops bleiben unverändert (deterministischer Schutz läuft weiter)."
          : err instanceof ClaudeError && err.kind === "timeout"
            ? "⚠️ Mr Ape: Zeitüberschreitung beim Manager-Tick — Stops bleiben unverändert."
            : "⚠️ Mr Ape nicht erreichbar (Manager-Call fehlgeschlagen) — Stops bleiben unverändert.";
      // Surface the breach even when the manager call failed (deterministic).
      const text = breachLines.length > 0 ? `${breachLines.join("\n")}\n${reason}` : reason;
      try {
        await deps.send(text, "progress");
      } catch (sendErr) {
        console.error(`[tick] failed to send manager-failure alert: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
      }
    }
  }

  // --- Fallback bands: every quoted position always carries a band. ---
  if (!staleClose) {
    const ensured = ensureBands(portfolio, quotes);
    if (ensured.changed) {
      portfolio = ensured.portfolio;
      deps.savePortfolio(portfolio);
    }
  }

  if (opts.isClose && hadActivity) {
    const staleQuotesFrom =
      staleClose && portfolio.lastTick !== undefined
        ? deps.berlinStamp(new Date(portfolio.lastTick.at)).slice(11)
        : undefined;
    const summary = formatDailySummary(portfolio, quotes, day, {
      staleQuotesFrom,
      healthLine: healthLine(health),
    });
    deps.appendJournal("Tagesabschluss", summary);
    await deps.send(summary, "digest");
  }
}
