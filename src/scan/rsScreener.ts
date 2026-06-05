import { postScan, num, type ScanResponse, type FetchFn } from "../core/tvScanner";

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

  const spy = await postScan(fetchFn, {
    symbols: { tickers: ["AMEX:SPY"], query: { types: [] } },
    columns: ["Perf.1M"],
  });
  const rawSpy = spy.data?.[0]?.d?.[0];
  if (typeof rawSpy !== "number") {
    // No benchmark → RS would be meaningless; throw so the caller degrades to no section.
    throw new Error("TradingView scan returned no SPY Perf.1M benchmark");
  }
  const spyPerfM = rawSpy;

  const baseFilter = [
    { left: "market_cap_basic", operation: "egreater", right: minMarketCap },
    { left: "average_volume_90d_calc", operation: "egreater", right: minAvgVol },
    // common stocks only — exclude ETFs / leveraged funds (SPY, TQQQ, …) which
    // are type "fund" and would otherwise dominate or pollute a stock RS list.
    { left: "type", operation: "equal", right: "stock" },
  ];
  const columns = ["name", "close", "change", "Perf.W", "Perf.1M"];
  const query = (sortOrder: "desc" | "asc") => ({
    filter: baseFilter,
    sort: { sortBy: "Perf.1M", sortOrder },
    range: [0, limit],
    columns,
  });

  const [longsRaw, shortsRaw] = await Promise.all([
    postScan(fetchFn, query("desc")),
    postScan(fetchFn, query("asc")),
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
