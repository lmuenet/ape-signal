// src/paper/setupRadar.ts — deterministic intraday setup detection (Stufe 2).
// Pure functions: close-based triggers on a watchlist of NON-held tickers, from
// the scanner's EMA/RSI columns (no proxy, no candles, no LLM). A trigger only
// ALERTS — opening a trade is the gated Stufe 3 path (see intraday.ts).
import { OPPORTUNISM, type QuoteMap, type SetupKind, type SetupThresholds, type SetupTrigger, type TickQuote, type WatchlistEntry } from "./types";

/**
 * EMA10×EMA20 crossed between prev and now, clearing `minGap` (needs both EMAs
 * in both snapshots). minGap 0 reproduces the exact sign change bit-for-bit
 * (`x ± 0` is a no-op in IEEE-754); a positive gap suppresses whipsaw crosses
 * that barely clear the other EMA.
 */
function emaCross(prev: TickQuote, now: TickQuote, minGap: number): SetupKind | null {
  if (prev.ema10 === undefined || prev.ema20 === undefined || now.ema10 === undefined || now.ema20 === undefined) {
    return null;
  }
  if (prev.ema10 <= prev.ema20 && now.ema10 > now.ema20 + minGap) return "ema-cross-up";
  if (prev.ema10 >= prev.ema20 && now.ema10 < now.ema20 - minGap) return "ema-cross-down";
  return null;
}

/** RSI crossed an extreme between prev and now (needs RSI in both). Thresholds from OPPORTUNISM. */
function rsiExtreme(prev: TickQuote, now: TickQuote, t: SetupThresholds): SetupKind | null {
  if (prev.rsi === undefined || now.rsi === undefined) return null;
  if (prev.rsi < t.rsiOverbought && now.rsi >= t.rsiOverbought) return "rsi-overbought";
  if (prev.rsi > t.rsiOversold && now.rsi <= t.rsiOversold) return "rsi-oversold";
  return null;
}

const KIND_LABEL: Record<SetupKind, string> = {
  "ema-cross-up": "EMA10×EMA20 ↑",
  "ema-cross-down": "EMA10×EMA20 ↓",
  "rsi-overbought": `RSI ≥ ${OPPORTUNISM.rsiOverbought} (überkauft)`,
  "rsi-oversold": `RSI ≤ ${OPPORTUNISM.rsiOversold} (überverkauft)`,
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
  thresholds: SetupThresholds = OPPORTUNISM,
): SetupTrigger[] {
  const triggers: SetupTrigger[] = [];
  for (const entry of entries) {
    const now = quotes[entry.ticker];
    const prev = prevQuotes[entry.ticker];
    if (!now || !prev) continue;
    for (const kind of [emaCross(prev, now, thresholds.emaCrossMinGap), rsiExtreme(prev, now, thresholds)]) {
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
