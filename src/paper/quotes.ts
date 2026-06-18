// src/paper/quotes.ts — tick quotes (close + day high/low) for the fill
// engine, via the TradingView scanner (the only price source reachable from
// the VPS — see docs/adr/0001).
import { postScan, num, type FetchFn } from "../core/tvScanner";
import type { QuoteMap, TickQuote } from "./types";

/** Number-or-undefined: missing/non-numeric indicator cells stay absent (NOT 0 — a 0 EMA would be a false signal). */
const optNum = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * One scanner POST for all tickers. Symbols the scanner doesn't recognise are
 * absent from the result; the engine leaves their positions untouched. Throws
 * on a non-ok HTTP status so callers can degrade (skip the tick).
 */
export async function fetchTickQuotes(tickers: string[], fetchFn: FetchFn = fetch): Promise<QuoteMap> {
  const out: QuoteMap = {};
  if (tickers.length === 0) return out;
  const body = {
    // Same set-membership trick as marketData.ts: "name in_range [...]".
    // The EMA/RSI columns are precomputed by the scanner — a free trend read
    // from the VPS without candles or a proxy (MASTERPLAN B2 / trend.ts).
    filter: [{ left: "name", operation: "in_range", right: tickers.map((t) => t.toUpperCase()) }],
    columns: ["name", "close", "change", "high", "low", "EMA10", "EMA20", "EMA50", "RSI"],
    range: [0, Math.max(tickers.length * 2, 60)],
  };
  const json = await postScan(fetchFn, body);
  for (const row of json.data ?? []) {
    const d = row.d;
    if (!Array.isArray(d)) continue;
    const name = typeof d[0] === "string" ? d[0].toUpperCase() : null;
    const close = typeof d[1] === "number" ? d[1] : null;
    if (name === null || close === null || out[name]) continue; // first listing wins
    const q: TickQuote = { close, changePct: num(d[2]), high: num(d[3]), low: num(d[4]) };
    const ema10 = optNum(d[5]);
    const ema20 = optNum(d[6]);
    const ema50 = optNum(d[7]);
    const rsi = optNum(d[8]);
    if (ema10 !== undefined) q.ema10 = ema10;
    if (ema20 !== undefined) q.ema20 = ema20;
    if (ema50 !== undefined) q.ema50 = ema50;
    if (rsi !== undefined) q.rsi = rsi;
    out[name] = q;
  }
  return out;
}
