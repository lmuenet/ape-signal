// Resolves US tickers (our candidate universe) to their preferred German EUR
// listing, bridged by ISIN. Two scanner calls: america → ISIN, germany → the
// venue rows for those ISINs. The venue pick (pickListing) is pure and unit-
// tested; only the two fetches touch the network.
//
// Why this exists: the bot historically priced everything off the US (america)
// scan in USD, which is the previous day's stale close during the Xetra window.
// Pricing on a German EUR venue (Tradegate) fixes both the staleness and the
// currency mismatch. See docs/superpowers/specs/2026-06-23-eur-pricing-*.
import { num, postScan, type FetchFn } from "./tvScanner";

/** A US ticker resolved to its preferred German EUR listing. */
export interface ResolvedListing {
  usTicker: string; // bare US ticker, UPPER-CASE, e.g. "QCOM"
  isin: string; // e.g. "US7475251036"
  name: string; // human-readable company name, e.g. "QUALCOMM Incorporated"
  deSymbol: string; // venue-qualified TradingView symbol, e.g. "TRADEGATE:QCI"
  venue: string; // exchange/venue code, e.g. "TRADEGATE"
  currency: string; // expected "EUR"
  close: number; // current EUR price on that venue
}

/** One candidate German venue row for an ISIN, parsed from the germany scan. */
export interface GermanRow {
  isin: string;
  name: string;
  deSymbol: string; // the venue-qualified `s`, e.g. "XETR:QCI"
  venue: string;
  currency: string;
  close: number;
  high: number;
  low: number;
  changePct: number;
}

// Preferred venues, in order. Tradegate carries US double-listings with a real
// intraday high/low range (verified via VPS probe 2026-06-23); XETR is the
// fallback. Everything else (HAM/MUN/LS/…) often collapses to a single market-
// maker print (high==low==close), which our stop logic can't detect a touch on.
const VENUE_PRIORITY = ["TRADEGATE", "XETR"];

function venueRank(venue: string): number {
  const i = VENUE_PRIORITY.indexOf(venue.toUpperCase());
  return i === -1 ? VENUE_PRIORITY.length : i;
}

/**
 * Does this venue row show a real intraday range? A single market-maker print
 * collapses high==low, leaving the engine nothing to detect a stop touch with.
 * Used as a freshness hint at tick time; at resolution we only use it as a
 * tiebreaker so we don't drop a name merely because it is momentarily flat.
 */
export function isLiveQuote(r: Pick<GermanRow, "high" | "low">): boolean {
  return r.high > r.low;
}

/**
 * Pick the best German listing for one ISIN's candidate rows. Prefers Tradegate,
 * then XETR, then any other venue; within the same venue tier the widest
 * intraday range wins (a live, ranging quote over a stale single print). Rows
 * without a positive close are unusable. Returns null when none qualifies — the
 * caller then drops the name (v1 trades EUR-listed names only).
 */
export function pickListing(rows: GermanRow[]): GermanRow | null {
  const usable = rows.filter((r) => r.close > 0);
  if (usable.length === 0) return null;
  return [...usable].sort(
    (a, b) => venueRank(a.venue) - venueRank(b.venue) || (b.high - b.low) - (a.high - a.low),
  )[0];
}

/** Step 1: US tickers → ISIN, via the america scan. UPPER-CASE keys. */
export async function fetchUsIsins(usTickers: string[], fetchFn: FetchFn): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (usTickers.length === 0) return out;
  const tickers = usTickers.map((t) => t.toUpperCase());
  const json = await postScan(
    fetchFn,
    {
      // in_range on "name" is the scanner's set-membership test (one of [...]).
      filter: [{ left: "name", operation: "in_range", right: tickers }],
      columns: ["name", "isin"],
      range: [0, Math.max(tickers.length * 2, 60)],
    },
    "america",
  );
  for (const row of json.data ?? []) {
    const d = row.d;
    if (!Array.isArray(d)) continue;
    const name = typeof d[0] === "string" ? d[0].toUpperCase() : null;
    const isin = typeof d[1] === "string" ? d[1] : null;
    if (name === null || !isin) continue;
    if (out.has(name)) continue; // first match wins → ignore duplicate listings
    out.set(name, isin);
  }
  return out;
}

/** Step 2: ISINs → their German venue rows (grouped by ISIN), via the germany scan. */
export async function fetchGermanRows(isins: string[], fetchFn: FetchFn): Promise<Map<string, GermanRow[]>> {
  const byIsin = new Map<string, GermanRow[]>();
  if (isins.length === 0) return byIsin;
  const json = await postScan(
    fetchFn,
    {
      // isin + in_range is server-side filterable (verified via VPS probe).
      filter: [{ left: "isin", operation: "in_range", right: isins }],
      columns: ["description", "close", "currency", "exchange", "isin", "change", "high", "low"],
      range: [0, Math.max(isins.length * 12, 60)], // several venues per ISIN
    },
    "germany",
  );
  for (const row of json.data ?? []) {
    const d = row.d;
    if (!Array.isArray(d)) continue;
    const isin = typeof d[4] === "string" ? d[4] : null;
    const deSymbol = typeof row.s === "string" ? row.s : null;
    if (!isin || !deSymbol) continue;
    const parsed: GermanRow = {
      isin,
      name: typeof d[0] === "string" ? d[0] : "",
      deSymbol,
      venue: typeof d[3] === "string" ? d[3] : "",
      currency: typeof d[2] === "string" ? d[2] : "",
      close: num(d[1]),
      high: num(d[6]),
      low: num(d[7]),
      changePct: num(d[5]),
    };
    const list = byIsin.get(isin) ?? [];
    list.push(parsed);
    byIsin.set(isin, list);
  }
  return byIsin;
}

/**
 * Resolve US tickers to their preferred German EUR listings. Names without a
 * usable German venue are dropped (v1 trades EUR-listed names only — this also
 * trims Apewisdom micro-caps with no German notation). The returned list is
 * keyed implicitly by usTicker; order follows the input where resolvable.
 */
export async function resolveListings(usTickers: string[], fetchFn: FetchFn = fetch): Promise<ResolvedListing[]> {
  if (usTickers.length === 0) return [];
  const isinByTicker = await fetchUsIsins(usTickers, fetchFn);
  const isins = [...new Set(isinByTicker.values())];
  if (isins.length === 0) return [];
  const rowsByIsin = await fetchGermanRows(isins, fetchFn);
  const out: ResolvedListing[] = [];
  for (const [usTicker, isin] of isinByTicker) {
    const pick = pickListing(rowsByIsin.get(isin) ?? []);
    if (!pick) continue;
    out.push({
      usTicker,
      isin,
      name: pick.name,
      deSymbol: pick.deSymbol,
      venue: pick.venue,
      currency: pick.currency,
      close: pick.close,
    });
  }
  return out;
}
