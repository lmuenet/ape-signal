const SCANNER_ENDPOINT = "https://scanner.tradingview.com/america/scan";

export interface TrendQuote {
  close: number;
  changePct: number; // today's % change
  perfW: number; // 1-week performance %
  perfM: number; // 1-month performance %
  perf3M: number; // 3-month performance %
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ScanRow {
  s?: string; // exchange-qualified symbol, e.g. "NASDAQ:AVGO"
  d?: unknown[]; // [name, close, change, Perf.W, Perf.1M, Perf.3M]
}
interface ScanResponse {
  data?: ScanRow[];
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

/**
 * Per-ticker current price + multi-timeframe trend via the TradingView scanner
 * (one POST for all tickers; free, no key). This is the chosen trend source
 * because — unlike StockTwits/Tradestie/Yahoo/Finnhub-candles, all of which the
 * VPS datacenter IP is blocked from or that now require payment — the scanner is
 * reachable from the VPS. Returns a Map keyed by UPPER-CASE ticker; symbols the
 * scanner doesn't recognise are simply absent. Throws on a non-ok HTTP status so
 * the caller's resilience wrapper can degrade it to "no prices".
 */
export async function fetchTradingViewTrend(
  tickers: string[],
  fetchFn: FetchFn = fetch,
): Promise<Map<string, TrendQuote>> {
  const out = new Map<string, TrendQuote>();
  if (tickers.length === 0) return out;

  const body = {
    // TradingView's scanner uses operation "in_range" on the "name" field as a
    // SET membership test ("name is one of [...]"), not a numeric between-bounds
    // check — this is the documented way to fetch a specific bare-ticker list in
    // one call (verified against the live endpoint). Avoids exchange-prefix guessing.
    filter: [{ left: "name", operation: "in_range", right: tickers.map((t) => t.toUpperCase()) }],
    columns: ["name", "close", "change", "Perf.W", "Perf.1M", "Perf.3M"],
    range: [0, Math.max(tickers.length * 2, 60)],
  };
  const res = await fetchFn(SCANNER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TradingView scan returned ${res.status}`);

  const json = (await res.json()) as ScanResponse;
  for (const row of json.data ?? []) {
    const d = row.d;
    if (!Array.isArray(d)) continue;
    const name = typeof d[0] === "string" ? d[0].toUpperCase() : null;
    const close = typeof d[1] === "number" ? d[1] : null;
    if (name === null || close === null) continue;
    if (out.has(name)) continue; // first match wins → ignore duplicate listings
    out.set(name, {
      close,
      changePct: num(d[2]),
      perfW: num(d[3]),
      perfM: num(d[4]),
      perf3M: num(d[5]),
    });
  }
  return out;
}
