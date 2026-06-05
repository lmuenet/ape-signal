// Shared low-level client for the TradingView scanner (free, no key, reachable
// from the VPS). Used by both the trending price/trend lookup (marketData.ts)
// and the relative-strength long/short screener (scan/rsScreener.ts).

export const TV_SCANNER_ENDPOINT = "https://scanner.tradingview.com/america/scan";

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

/** POST a scanner query. Throws on a non-ok status so callers can degrade it. */
export async function postScan(fetchFn: FetchFn, body: unknown): Promise<ScanResponse> {
  const res = await fetchFn(TV_SCANNER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TradingView scan returned ${res.status}`);
  return (await res.json()) as ScanResponse;
}
