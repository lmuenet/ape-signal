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

type Filter = Array<Record<string, unknown>>;

const COLUMNS = ["name", "close", "change", "Perf.W", "Perf.1M"];

/** SPY's 1-month performance — the market benchmark for relative strength. */
async function fetchSpyPerfM(fetchFn: FetchFn): Promise<number> {
  const spy = await postScan(fetchFn, {
    symbols: { tickers: ["AMEX:SPY"], query: { types: [] } },
    columns: ["Perf.1M"],
  });
  const raw = spy.data?.[0]?.d?.[0];
  if (typeof raw !== "number") {
    // No benchmark → RS would be meaningless; throw so the caller degrades.
    throw new Error("TradingView scan returned no SPY Perf.1M benchmark");
  }
  return raw;
}

function mapCandidates(resp: ScanResponse, spyPerfM: number): RsCandidate[] {
  return (resp.data ?? [])
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
}

/** Liquid common stocks only — excludes ETFs/leveraged funds (type "fund"). */
function liquidity(minMarketCap: number, minAvgVol: number): Filter {
  return [
    { left: "market_cap_basic", operation: "egreater", right: minMarketCap },
    { left: "average_volume_90d_calc", operation: "egreater", right: minAvgVol },
    { left: "type", operation: "equal", right: "stock" },
  ];
}

/** Run the long (Perf.1M desc) and short (Perf.1M asc) scans for a given filter. */
async function longShort(
  fetchFn: FetchFn,
  filter: Filter,
  spyPerfM: number,
  limit: number,
): Promise<Pick<RsResult, "longs" | "shorts">> {
  const query = (sortOrder: "desc" | "asc") => ({
    filter,
    sort: { sortBy: "Perf.1M", sortOrder },
    range: [0, limit],
    columns: COLUMNS,
  });
  const [longs, shorts] = await Promise.all([postScan(fetchFn, query("desc")), postScan(fetchFn, query("asc"))]);
  return { longs: mapCandidates(longs, spyPerfM), shorts: mapCandidates(shorts, spyPerfM) };
}

interface DualScanArgs {
  longFilter: Filter;
  shortFilter: Filter;
  sortBy: string;
  limit: number;
  spyPerfM: number;
}

/** Run a long (desc) + short (asc) pair with DISTINCT filters and a chosen sort field. */
async function dualScan(fetchFn: FetchFn, args: DualScanArgs): Promise<Pick<RsResult, "longs" | "shorts">> {
  const query = (filter: Filter, sortOrder: "desc" | "asc") => ({
    filter,
    sort: { sortBy: args.sortBy, sortOrder },
    range: [0, args.limit],
    columns: COLUMNS,
  });
  const [longs, shorts] = await Promise.all([
    postScan(fetchFn, query(args.longFilter, "desc")),
    postScan(fetchFn, query(args.shortFilter, "asc")),
  ]);
  return { longs: mapCandidates(longs, args.spyPerfM), shorts: mapCandidates(shorts, args.spyPerfM) };
}

/**
 * Long/short candidates by RELATIVE STRENGTH vs the market (TradingView, free,
 * no key, VPS-reachable). Ranks liquid large-cap common stocks by 1-month
 * performance vs SPY — hour-independent so it works at both the 08:45 and the
 * pre-US-open 15:15 scans. Throws on a non-ok response so the caller can degrade.
 */
export async function fetchRsLongShort(fetchFn: FetchFn = fetch, opts: RsOptions = {}): Promise<RsResult> {
  const limit = opts.limit ?? 8;
  const spyPerfM = await fetchSpyPerfM(fetchFn);
  const { longs, shorts } = await longShort(
    fetchFn,
    liquidity(opts.minMarketCap ?? 10_000_000_000, opts.minAvgVol ?? 1_000_000),
    spyPerfM,
    limit,
  );
  return { longs, shorts, spyPerfM };
}

/**
 * "Rising Strength / Ready to Trend": established relative strength that is
 * currently CONSOLIDATING — strong 1-month performance but a quiet today and a
 * flat-ish week, i.e. coiled for a (re)trend rather than already extended. Shorts
 * are the mirror (weak 1-month, pausing before continuation down). A smaller-cap
 * universe than the headline RS scan so it surfaces set-ups, not just mega-caps.
 */
export async function fetchReadyToTrend(fetchFn: FetchFn = fetch, opts: RsOptions = {}): Promise<RsResult> {
  const limit = opts.limit ?? 8;
  const base = liquidity(opts.minMarketCap ?? 2_000_000_000, opts.minAvgVol ?? 500_000);
  const spyPerfM = await fetchSpyPerfM(fetchFn);

  const quiet = [
    { left: "change", operation: "in_range", right: [-2, 2] }, // not popping today
  ];
  const longFilter: Filter = [
    ...base,
    ...quiet,
    { left: "Perf.1M", operation: "egreater", right: 8 }, // 1-month strength
    { left: "Perf.W", operation: "in_range", right: [-3, 4] }, // flat week (pausing)
  ];
  const shortFilter: Filter = [
    ...base,
    ...quiet,
    { left: "Perf.1M", operation: "eless", right: -8 }, // 1-month weakness
    { left: "Perf.W", operation: "in_range", right: [-4, 3] },
  ];

  const query = (filter: Filter, sortOrder: "desc" | "asc") => ({
    filter,
    sort: { sortBy: "Perf.1M", sortOrder },
    range: [0, limit],
    columns: COLUMNS,
  });
  const [longs, shorts] = await Promise.all([
    postScan(fetchFn, query(longFilter, "desc")),
    postScan(fetchFn, query(shortFilter, "asc")),
  ]);
  return { longs: mapCandidates(longs, spyPerfM), shorts: mapCandidates(shorts, spyPerfM), spyPerfM };
}

/**
 * "Strong Daily": a clean uptrend in motion — price stacked above its 20/50/200
 * moving averages with positive relative strength vs SPY (1M). Shorts are the
 * full mirror (price below a falling MA stack, negative RS). Mid-cap universe so
 * it surfaces names beyond the mega-cap RS leaderboard. Daily-bar only, so it is
 * meaningful at both the 08:45 and the pre-US-open 15:15 scans.
 */
export async function fetchStrongDaily(fetchFn: FetchFn = fetch, opts: RsOptions = {}): Promise<RsResult> {
  const limit = opts.limit ?? 8;
  const base = liquidity(opts.minMarketCap ?? 2_000_000_000, opts.minAvgVol ?? 500_000);
  const spyPerfM = await fetchSpyPerfM(fetchFn);

  const longFilter: Filter = [
    ...base,
    { left: "close", operation: "egreater", right: "SMA20" },
    { left: "SMA20", operation: "egreater", right: "SMA50" },
    { left: "SMA50", operation: "egreater", right: "SMA200" },
    { left: "Perf.1M", operation: "egreater", right: spyPerfM }, // positive RS vs market
  ];
  const shortFilter: Filter = [
    ...base,
    { left: "close", operation: "eless", right: "SMA20" },
    { left: "SMA20", operation: "eless", right: "SMA50" },
    { left: "SMA50", operation: "eless", right: "SMA200" },
    { left: "Perf.1M", operation: "eless", right: spyPerfM },
  ];

  const { longs, shorts } = await dualScan(fetchFn, { longFilter, shortFilter, sortBy: "Perf.1M", limit, spyPerfM });
  return { longs, shorts, spyPerfM };
}
