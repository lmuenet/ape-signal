// Shared low-level client for the TradingView scanner (free, no key, reachable
// from the VPS). Used by both the trending price/trend lookup (marketData.ts)
// and the relative-strength long/short screener (scan/rsScreener.ts).

/** Scanner markets we query. `america` = US listings (USD), `germany` = deutsche
 *  Venues (EUR, e.g. Tradegate/XETR). Same column schema, just a different path. */
export type ScanMarket = "america" | "germany";

/** Scanner endpoint URL for a market (default: US listings, the historical default). */
export function scanEndpoint(market: ScanMarket = "america"): string {
  return `https://scanner.tradingview.com/${market}/scan`;
}

/** Back-compat constant: the US endpoint (kept for existing imports). */
export const TV_SCANNER_ENDPOINT = scanEndpoint("america");

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ScanRow {
  s?: string; // exchange-qualified symbol, e.g. "NASDAQ:AVGO"
  d?: unknown[]; // column values, in the requested order
}

export interface ScanResponse {
  data?: ScanRow[];
}

/** Coerce a scanner cell to a number (missing/non-numeric → 0). */
export function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

/** POST a scanner query. Throws on a non-ok status so callers can degrade it.
 *  `market` selects the listings universe (default: US, backward-compatible). */
export async function postScan(
  fetchFn: FetchFn,
  body: unknown,
  market: ScanMarket = "america",
): Promise<ScanResponse> {
  const res = await fetchFn(scanEndpoint(market), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TradingView scan returned ${res.status}`);
  return (await res.json()) as ScanResponse;
}
