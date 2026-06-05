const SCANNER_ENDPOINT = "https://scanner.tradingview.com/america/scan";

export interface RsCandidate {
  ticker: string;
  close: number;
  changePct: number; // today's % change
  perfW: number; // 1-week performance %
  perfM: number; // 1-month performance %
  rsM: number; // relative strength = perfM - SPY's perfM (vs market, 1 month)
}

export interface RsResult {
  longs: RsCandidate[];
  shorts: RsCandidate[];
  spyPerfM: number;
}

export interface RsOptions {
  limit?: number;
  minMarketCap?: number;
  minAvgVol?: number;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ScanRow {
  s?: string;
  d?: unknown[];
}
interface ScanResponse {
  data?: ScanRow[];
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

async function scan(fetchFn: FetchFn, body: unknown): Promise<ScanResponse> {
  const res = await fetchFn(SCANNER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TradingView scan returned ${res.status}`);
  return (await res.json()) as ScanResponse;
}

/**
 * Long/short candidates by RELATIVE STRENGTH vs the market, computed from the
 * TradingView scanner (free, no key, reachable from the VPS where ZenBot/other
 * sources are not). Ranking uses 1-month performance vs SPY — deliberately
 * hour-independent so it is meaningful at both the 08:45 and (pre-US-open) 15:15
 * scans, unlike an intraday RS. Longs = strongest vs market, shorts = weakest;
 * the universe is liquid large caps. Throws on a non-ok response so the caller's
 * wrapper can degrade it to "no candidates".
 */
export async function fetchRsLongShort(fetchFn: FetchFn = fetch, opts: RsOptions = {}): Promise<RsResult> {
  const limit = opts.limit ?? 8;
  const minMarketCap = opts.minMarketCap ?? 10_000_000_000;
  const minAvgVol = opts.minAvgVol ?? 1_000_000;

  const spy = await scan(fetchFn, {
    symbols: { tickers: ["AMEX:SPY"], query: { types: [] } },
    columns: ["Perf.1M"],
  });
  const spyPerfM = num(spy.data?.[0]?.d?.[0]);

  const baseFilter = [
    { left: "market_cap_basic", operation: "egreater", right: minMarketCap },
    { left: "average_volume_90d_calc", operation: "egreater", right: minAvgVol },
  ];
  const columns = ["name", "close", "change", "Perf.W", "Perf.1M"];
  const query = (sortOrder: "desc" | "asc") => ({
    filter: baseFilter,
    sort: { sortBy: "Perf.1M", sortOrder },
    range: [0, limit],
    columns,
  });

  const [longsRaw, shortsRaw] = await Promise.all([
    scan(fetchFn, query("desc")),
    scan(fetchFn, query("asc")),
  ]);

  const map = (resp: ScanResponse): RsCandidate[] =>
    (resp.data ?? [])
      .map((row) => {
        const d = row.d ?? [];
        const ticker = typeof d[0] === "string" ? d[0] : "";
        return {
          ticker,
          close: num(d[1]),
          changePct: num(d[2]),
          perfW: num(d[3]),
          perfM: num(d[4]),
          rsM: num(d[4]) - spyPerfM,
        };
      })
      .filter((c) => c.ticker.length > 0);

  return { longs: map(longsRaw), shorts: map(shortsRaw), spyPerfM };
}
