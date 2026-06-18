// src/paper/intraday.ts — the GATED intraday opportunism opening (Stufe 3).
// A deterministic Setup-Radar trigger (setupRadar.ts) may wake ONE focused LLM
// call to place AT MOST ONE limit order on the triggered ticker, inside a
// separate budget tier and behind ENABLE_INTRADAY_OPPORTUNISM. Disciplined by
// design: all gates are deterministic, entries are limit-only, and an
// unreadable / declined / limited answer means NO trade (never a guess).
import { intradayTradesPlacedToday, placeOrders, tradesPlacedToday } from "./engine";
import { renderPortfolio, renderQuotes } from "./format";
import { buildIntradayPrompt } from "./prompts";
import { parseDecision } from "./decision";
import { GUARDRAILS, type Portfolio, type QuoteMap, type SetupTrigger } from "./types";
import type { Language } from "../core/language";
import { ClaudeError } from "../claude/invoke";

export interface IntradayDeps {
  loadPortfolio: () => Portfolio;
  savePortfolio: (p: Portfolio) => void;
  appendJournal: (title: string, body: string) => void;
  readJournalTail: () => string;
  fetchQuotes: (tickers: string[]) => Promise<QuoteMap>;
  /** Sonnet runner for the single intraday decision. */
  runner: (prompt: string) => Promise<string>;
  send: (text: string) => Promise<void>;
  now?: () => Date;
  berlinDay: (d: Date) => string;
  berlinStamp: (d: Date) => string;
  language?: Language;
}

/** True if a new intraday trade on `ticker` is allowed right now (all gates deterministic). */
export function intradayGateOpen(p: Portfolio, day: string, ticker: string): boolean {
  if (intradayTradesPlacedToday(p, day) >= GUARDRAILS.maxIntradayTrades) return false; // own tier
  if (tradesPlacedToday(p, day) >= GUARDRAILS.maxTradesPerDay) return false; // shared daily cap
  const t = ticker.toUpperCase();
  // No doubling down on a ticker we already hold or have an order for.
  if (p.positions.some((pos) => pos.ticker === t)) return false;
  if (p.orders.some((o) => o.ticker === t)) return false;
  return true;
}

/**
 * Consider opening one intraday limit order for a fired setup trigger. Best-effort
 * and self-contained (loads + saves the portfolio). Posts to Telegram only when an
 * order is actually placed; declines/rejections are journalled quietly (the trigger
 * itself was already surfaced by the radar).
 */
export async function runIntradayOpportunity(trigger: SetupTrigger, deps: IntradayDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const day = deps.berlinDay(now);
  const stamp = deps.berlinStamp(now);
  const ticker = trigger.ticker.toUpperCase();

  let portfolio = deps.loadPortfolio();
  if (!intradayGateOpen(portfolio, day, ticker)) return;

  let quotes: QuoteMap;
  try {
    quotes = await deps.fetchQuotes([ticker]);
  } catch (err) {
    console.error(`[intraday] quote fetch failed for ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!quotes[ticker]) return;

  let raw: string;
  try {
    raw = await deps.runner(
      buildIntradayPrompt({
        stamp,
        ticker,
        triggerLabel: trigger.note,
        price: trigger.price,
        portfolioBlock: renderPortfolio(portfolio, quotes),
        quotesBlock: renderQuotes(quotes),
        journalTail: deps.readJournalTail(),
        language: deps.language ?? "de",
      }),
    );
  } catch (err) {
    // Limit/timeout → silent degradation (deterministic protection keeps running).
    const kind = err instanceof ClaudeError ? err.kind : "error";
    console.error(`[intraday] runner ${kind} for ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const decision = parseDecision(raw);
  const trade = decision?.trades[0];
  if (!decision || !trade) {
    // No trade is a full answer — keep it quiet, just journal the reasoning if any.
    const note = decision?.journal?.trim();
    if (note) deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, `Kein Trade. ${note}`);
    return;
  }
  if (trade.entry === "market") {
    deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, "Vorschlag verworfen: nur Limit-Einstiege erlaubt (kein Market).");
    return;
  }

  const { portfolio: updated, accepted, rejected } = placeOrders(
    portfolio,
    [{ ...trade, ticker }],
    quotes,
    { now: now.toISOString(), day, source: "intraday" },
  );
  portfolio = updated;
  deps.savePortfolio(portfolio);

  if (accepted.length === 0) {
    const reason = rejected[0]?.reason ?? "abgelehnt";
    deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, `Order abgelehnt (${reason}).`);
    return;
  }

  const o = accepted[0];
  const journalText = decision.journal.trim();
  const orderText = `🟢 Intraday-Limit gesetzt: ${o.ticker} ${o.side} ${o.leverage}x, Einsatz $${o.stake.toFixed(2)}, Limit ${o.limitPrice}, SL ${o.stopLoss}${o.takeProfit !== undefined ? `, TP ${o.takeProfit}` : ""}${o.expiresOn ? ` (bis ${o.expiresOn})` : ""}`;
  deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, [journalText, orderText].filter((l) => l !== "").join("\n"));
  await deps.send([`🦍 Mr Ape — Intraday-Chance ${ticker} (${trigger.note})`, journalText, orderText].filter((l) => l !== "").join("\n"));
}
