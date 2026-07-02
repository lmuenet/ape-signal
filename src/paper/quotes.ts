// src/paper/quotes.ts — tick quotes (close + day high/low) for the fill
// engine, via the TradingView scanner (the only price source reachable from
// the VPS — see docs/adr/0001).
//
// Two fetchers: the legacy fetchTickQuotes (US tickers, america, USD) and
// fetchTickQuotesEur (German EUR venues, by ISIN, keyed back to the bot's
// ticker). The EUR fetcher exists to fix the stale-US-data trap — see
// docs/superpowers/specs/2026-06-23-eur-pricing-* and ADR 0005.
import { postScan, num, type FetchFn } from "../core/tvScanner";
import type { QuoteMap, TickQuote } from "./types";

/** A held instrument the monitor tick must price: its ticker plus, for the EUR
 *  path, the German venue (deSymbol) it was entered on and its ISIN. */
export interface QuoteHolding {
  ticker: string;
  deSymbol?: string;
  isin?: string;
}

/** Dedup positions/orders into one EUR holding per ticker (first listing wins). */
export function toHoldings(items: Array<{ ticker: string; deSymbol?: string; isin?: string }>): QuoteHolding[] {
  const byTicker = new Map<string, QuoteHolding>();
  for (const x of items) {
    if (!byTicker.has(x.ticker)) byTicker.set(x.ticker, { ticker: x.ticker, deSymbol: x.deSymbol, isin: x.isin });
  }
  return [...byTicker.values()];
}

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
    // Volume + 52-week columns feed the Setup-Radar triggers (Beschluss 2026-07-02).
    filter: [{ left: "name", operation: "in_range", right: tickers.map((t) => t.toUpperCase()) }],
    columns: ["name", "close", "change", "high", "low", "EMA10", "EMA20", "EMA50", "RSI", "volume", "average_volume_10d_calc", "price_52_week_high", "price_52_week_low"],
    range: [0, Math.max(tickers.length * 2, 60)],
  };
  const json = await postScan(fetchFn, body);
  for (const row of json.data ?? []) {
    const d = row.d;
    if (!Array.isArray(d)) continue;
    const name = typeof d[0] === "string" ? d[0].toUpperCase() : null;
    if (name === null || out[name]) continue; // first listing wins
    const q = toQuote(d, 1);
    if (q !== null) out[name] = q;
  }
  return out;
}

/**
 * Build a TickQuote from a scanner row, given the column offset of `close`.
 * Layout from `close`: close, change, high, low, EMA10, EMA20, EMA50, RSI,
 * volume, avg volume 10d, 52w high, 52w low.
 * Returns null when the PRICE fields are broken (missing cells coerce to 0 —
 * a 0-low would instantly trigger every stop, a 0-close a total-loss valuation).
 * Tickers without a quote are simply left untouched by the engine.
 */
function toQuote(d: unknown[], closeAt: number): TickQuote | null {
  const close = num(d[closeAt]);
  const high = num(d[closeAt + 2]);
  const low = num(d[closeAt + 3]);
  if (!(close > 0) || !(low > 0) || high < low) return null;
  const q: TickQuote = {
    close,
    changePct: num(d[closeAt + 1]),
    high,
    low,
  };
  type OptionalKey = "ema10" | "ema20" | "ema50" | "rsi" | "volume" | "avgVolume10d" | "high52w" | "low52w";
  const optional: Array<[OptionalKey, number]> = [
    ["ema10", 4], ["ema20", 5], ["ema50", 6], ["rsi", 7],
    ["volume", 8], ["avgVolume10d", 9], ["high52w", 10], ["low52w", 11],
  ];
  for (const [key, offset] of optional) {
    const v = optNum(d[closeAt + offset]);
    if (v !== undefined) q[key] = v;
  }
  return q;
}

/**
 * EUR tick quotes for held instruments, from their German venues. One scanner
 * POST filtered by ISIN (the proven server-side filter), then each holding is
 * matched to the EXACT venue (deSymbol) it was entered on — so the monitor
 * always prices the same venue the fill happened on, and the returned map is
 * keyed by the bot's ticker (drop-in for the engine, which looks up by ticker).
 *
 * Holdings without an ISIN+deSymbol are skipped (no EUR listing → untouched,
 * the same safe degradation as an unrecognised symbol). Throws on a non-ok HTTP
 * status so the caller can skip the tick.
 */
export async function fetchTickQuotesEur(holdings: QuoteHolding[], fetchFn: FetchFn = fetch): Promise<QuoteMap> {
  const out: QuoteMap = {};
  const isins = [...new Set(holdings.map((h) => h.isin).filter((x): x is string => !!x))];
  if (isins.length === 0) return out;
  const body = {
    filter: [{ left: "isin", operation: "in_range", right: isins }],
    columns: ["close", "change", "high", "low", "EMA10", "EMA20", "EMA50", "RSI", "volume", "average_volume_10d_calc", "price_52_week_high", "price_52_week_low"],
    range: [0, Math.max(isins.length * 12, 60)], // several venues per ISIN
  };
  const json = await postScan(fetchFn, body, "germany");
  // Index every returned venue row by its venue-qualified symbol (row.s).
  // Rows with broken price fields are dropped (same guard as the US path).
  const bySymbol = new Map<string, TickQuote>();
  for (const row of json.data ?? []) {
    if (!Array.isArray(row.d) || typeof row.s !== "string") continue;
    const q = toQuote(row.d, 0);
    if (q !== null) bySymbol.set(row.s, q);
  }
  // Price each holding on its exact entry venue; key the result by its ticker.
  for (const h of holdings) {
    if (!h.deSymbol) continue;
    const q = bySymbol.get(h.deSymbol);
    if (q) out[h.ticker] = q;
  }
  return out;
}
