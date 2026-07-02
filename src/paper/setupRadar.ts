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

/**
 * EMA20 pullback-touch: intact trend (close on the trend side of EMA20, EMA10
 * stacked along when present) while the day's extreme touched the EMA20 — the
 * exact "Limit an der EMA20"-zone the Kür prompt recommends, as a radar trigger.
 */
function ema20Pullback(now: TickQuote): SetupKind | null {
  if (now.ema20 === undefined) return null;
  const stackUp = now.ema10 === undefined || now.ema10 >= now.ema20;
  const stackDown = now.ema10 === undefined || now.ema10 <= now.ema20;
  if (now.close > now.ema20 && stackUp && now.low <= now.ema20) return "ema20-pullback-long";
  if (now.close < now.ema20 && stackDown && now.high >= now.ema20) return "ema20-pullback-short";
  return null;
}

/** Close crossed the EMA50 between prev and now (trend-structure reclaim/loss). */
function ema50Cross(prev: TickQuote, now: TickQuote): SetupKind | null {
  if (prev.ema50 === undefined || now.ema50 === undefined) return null;
  if (prev.close <= prev.ema50 && now.close > now.ema50) return "ema50-reclaim";
  if (prev.close >= prev.ema50 && now.close < now.ema50) return "ema50-loss";
  return null;
}

/**
 * Close crossed the PREVIOUS snapshot's 52-week extreme. The prev value is the
 * reference on purpose: the scanner column already includes today's extreme, so
 * only the prev snapshot turns "is at the high" into a real crossing.
 */
function extreme52w(prev: TickQuote, now: TickQuote): SetupKind | null {
  if (prev.high52w !== undefined && prev.close < prev.high52w && now.close > prev.high52w) return "high52w-breakout";
  if (prev.low52w !== undefined && prev.close > prev.low52w && now.close < prev.low52w) return "low52w-breakdown";
  return null;
}

/**
 * volume/avgVolume10d crossed the spike factor upwards (needs volume in both
 * snapshots — never a false signal on a degraded source). Intraday volume
 * accumulates over the day, so this fires conservatively late by design.
 */
function volumeSpike(prev: TickQuote, now: TickQuote, factor: number): SetupKind | null {
  if (prev.volume === undefined || prev.avgVolume10d === undefined || prev.avgVolume10d <= 0) return null;
  if (now.volume === undefined || now.avgVolume10d === undefined || now.avgVolume10d <= 0) return null;
  const prevRatio = prev.volume / prev.avgVolume10d;
  const nowRatio = now.volume / now.avgVolume10d;
  return prevRatio < factor && nowRatio >= factor ? "volume-spike" : null;
}

const KIND_LABEL: Record<SetupKind, string> = {
  "ema-cross-up": "EMA10×EMA20 ↑",
  "ema-cross-down": "EMA10×EMA20 ↓",
  "rsi-overbought": `RSI ≥ ${OPPORTUNISM.rsiOverbought} (überkauft)`,
  "rsi-oversold": `RSI ≤ ${OPPORTUNISM.rsiOversold} (überverkauft)`,
  "ema20-pullback-long": "Pullback an EMA20 (Aufwärtstrend)",
  "ema20-pullback-short": "Rücklauf an EMA20 (Abwärtstrend)",
  "ema50-reclaim": "EMA50 zurückerobert",
  "ema50-loss": "EMA50 verloren",
  "high52w-breakout": "Ausbruch über 52W-Hoch",
  "low52w-breakdown": "Bruch des 52W-Tiefs",
  "volume-spike": `Volumen-Spike (≥ ${OPPORTUNISM.volumeSpikeFactor}× Ø10T)`,
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
    for (const kind of [
      emaCross(prev, now, thresholds.emaCrossMinGap),
      rsiExtreme(prev, now, thresholds),
      ema20Pullback(now),
      ema50Cross(prev, now),
      extreme52w(prev, now),
      volumeSpike(prev, now, thresholds.volumeSpikeFactor),
    ]) {
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
