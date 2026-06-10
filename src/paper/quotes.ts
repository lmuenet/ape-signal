// src/paper/quotes.ts — tick quotes (close + day high/low) for the fill
// engine, via the TradingView scanner (the only price source reachable from
// the VPS — see docs/adr/0001).
import { postScan, num, type FetchFn } from "../core/tvScanner";
import type { QuoteMap } from "./types";

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
    filter: [{ left: "name", operation: "in_range", right: tickers.map((t) => t.toUpperCase()) }],
    columns: ["name", "close", "change", "high", "low"],
    range: [0, Math.max(tickers.length * 2, 60)],
  };
  const json = await postScan(fetchFn, body);
  for (const row of json.data ?? []) {
    const d = row.d;
    if (!Array.isArray(d)) continue;
    const name = typeof d[0] === "string" ? d[0].toUpperCase() : null;
    const close = typeof d[1] === "number" ? d[1] : null;
    if (name === null || close === null || out[name]) continue; // first listing wins
    out[name] = { close, changePct: num(d[2]), high: num(d[3]), low: num(d[4]) };
  }
  return out;
}
