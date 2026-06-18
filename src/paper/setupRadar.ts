// src/paper/setupRadar.ts — deterministic intraday setup detection (Stufe 2).
// Pure functions: close-based triggers on a watchlist of NON-held tickers, from
// the scanner's EMA/RSI columns (no proxy, no candles, no LLM). A trigger only
// ALERTS — opening a trade is the gated Stufe 3 path (see intraday.ts).
import type { QuoteMap, SetupKind, SetupTrigger, TickQuote, WatchlistEntry } from "./types";

/** EMA10×EMA20 crossed between prev and now (needs both EMAs in both snapshots). */
function emaCross(prev: TickQuote, now: TickQuote): SetupKind | null {
  if (prev.ema10 === undefined || prev.ema20 === undefined || now.ema10 === undefined || now.ema20 === undefined) {
    return null;
  }
  if (prev.ema10 <= prev.ema20 && now.ema10 > now.ema20) return "ema-cross-up";
  if (prev.ema10 >= prev.ema20 && now.ema10 < now.ema20) return "ema-cross-down";
  return null;
}

/** RSI crossed an extreme (70/30) between prev and now (needs RSI in both). */
function rsiExtreme(prev: TickQuote, now: TickQuote): SetupKind | null {
  if (prev.rsi === undefined || now.rsi === undefined) return null;
  if (prev.rsi < 70 && now.rsi >= 70) return "rsi-overbought";
  if (prev.rsi > 30 && now.rsi <= 30) return "rsi-oversold";
  return null;
}

const KIND_LABEL: Record<SetupKind, string> = {
  "ema-cross-up": "EMA10×EMA20 ↑",
  "ema-cross-down": "EMA10×EMA20 ↓",
  "rsi-overbought": "RSI ≥ 70 (überkauft)",
  "rsi-oversold": "RSI ≤ 30 (überverkauft)",
};

/** Short human label for a setup kind. */
export function setupLabel(kind: SetupKind): string {
  return KIND_LABEL[kind];
}

/**
 * Fired setups for the watchlist: a kind fires only on a real crossing (prev→now)
 * and only if the entry has not already fired that kind today (firedKinds). Tickers
 * without a current/previous quote, or with a degraded (EMA/RSI-less) snapshot, stay
 * silent — never a false signal.
 */
export function detectSetups(
  entries: WatchlistEntry[],
  quotes: QuoteMap,
  prevQuotes: QuoteMap = {},
): SetupTrigger[] {
  const triggers: SetupTrigger[] = [];
  for (const entry of entries) {
    const now = quotes[entry.ticker];
    const prev = prevQuotes[entry.ticker];
    if (!now || !prev) continue;
    for (const kind of [emaCross(prev, now), rsiExtreme(prev, now)]) {
      if (kind === null || entry.firedKinds.includes(kind)) continue;
      const rsiPart = now.rsi !== undefined ? ` · RSI ${Math.round(now.rsi)}` : "";
      triggers.push({
        ticker: entry.ticker,
        kind,
        price: now.close,
        note: `${setupLabel(kind)}${rsiPart}${entry.note ? ` — ${entry.note}` : ""}`,
      });
    }
  }
  return triggers;
}
