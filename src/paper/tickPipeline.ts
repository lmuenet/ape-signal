// src/paper/tickPipeline.ts — one tick of Mr Ape's depot: deterministic fill
// check first (always), then — only if there is anything to manage — one
// Sonnet call to adjust stops/limits. Telegram hears about events and the
// daily summary; silent ticks post nothing.
import { applyAdjustments, applyTick } from "./engine";
import { describeAdjustment, formatDailySummary, formatEvent, renderPortfolio, renderQuotes } from "./format";
import { buildTickPrompt } from "./prompts";
import { parseTickResponse } from "./decision";
import type { Portfolio, QuoteMap, TickEvent } from "./types";

export interface TickDeps {
  loadPortfolio: () => Portfolio;
  savePortfolio: (p: Portfolio) => void;
  appendJournal: (title: string, body: string) => void;
  readJournalTail: () => string;
  fetchQuotes: (tickers: string[]) => Promise<QuoteMap>;
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

  let quotes: QuoteMap = {};
  if (tickers.length > 0) {
    try {
      quotes = await deps.fetchQuotes(tickers);
    } catch (err) {
      // No quotes → no evidence → skipping the whole tick is the safe move
      // (state untouched; the next tick's day-extreme rule catches up).
      console.error(`[tick] quote fetch failed, skipping tick: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  const { portfolio: afterFills, events } = applyTick(portfolio, quotes, {
    now: now.toISOString(),
    day,
    isClose: opts.isClose,
  });
  portfolio = afterFills;
  deps.savePortfolio(portfolio);

  if (events.length > 0) {
    const lines = events.map(formatEvent);
    deps.appendJournal(`Tick ${stamp.slice(11)}`, lines.join("\n"));
    await deps.send(lines.join("\n"));
  }

  // Manager call: only when there is something to manage.
  if (portfolio.positions.length > 0 || portfolio.orders.length > 0) {
    try {
      const raw = await deps.claudeRunner(
        buildTickPrompt({
          stamp,
          portfolioBlock: renderPortfolio(portfolio, quotes),
          quotesBlock: renderQuotes(quotes),
          eventsBlock: events.map(formatEvent).join("\n"),
          journalTail: deps.readJournalTail(),
          isClose: opts.isClose,
        }),
      );
      const response = parseTickResponse(raw);
      if (response && (response.adjustments.length > 0 || response.journal.trim() !== "")) {
        const result = applyAdjustments(portfolio, response.adjustments, quotes, now.toISOString());
        portfolio = result.portfolio;
        deps.savePortfolio(portfolio);

        const noteLines: string[] = [];
        if (response.journal.trim() !== "") noteLines.push(response.journal.trim());
        for (const a of result.applied) noteLines.push(`→ ${describeAdjustment(a)}`);
        for (const r of result.rejected) noteLines.push(`✗ abgelehnt (${r.reason}): ${describeAdjustment(r.adjustment)}`);
        if (noteLines.length > 0) deps.appendJournal(`Tick ${stamp.slice(11)} — Mr Ape`, noteLines.join("\n"));

        // Closes initiated by Mr Ape are fills the user should see.
        const closeEvents = result.events.filter((e: TickEvent) => e.kind === "position-closed");
        if (closeEvents.length > 0) await deps.send(closeEvents.map(formatEvent).join("\n"));
      }
    } catch (err) {
      // Stops stay where they are — the deterministic engine keeps protecting.
      console.error(`[tick] manager call failed, keeping current stops: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (opts.isClose && hadActivity) {
    const summary = formatDailySummary(portfolio, quotes, day);
    deps.appendJournal("Tagesabschluss", summary);
    await deps.send(summary);
  }
}
