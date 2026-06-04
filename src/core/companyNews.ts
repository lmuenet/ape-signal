import { classifyCatalyst, type NewsItem } from "./ape-intel";

const NEWS_ENDPOINT = "https://finnhub.io/api/v1/company-news";
const PROFILE_ENDPOINT = "https://finnhub.io/api/v1/stock/profile2";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface RawNews {
  headline?: string;
  source?: string;
  url?: string;
  datetime?: number;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Company-name suffixes/fillers that carry no matching signal. */
const NAME_STOPWORDS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited",
  "plc", "group", "holdings", "holding", "the", "class", "ag", "sa", "nv",
]);

/** The distinctive token of a company name (e.g. "Corning Inc" → "corning"). */
function significantNameToken(name: string): string | null {
  const tokens = name
    .toLowerCase()
    .replace(/[.,&]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NAME_STOPWORDS.has(t));
  return tokens[0] ?? null;
}

/**
 * True if a news headline is actually about this company — it names the ticker
 * as a whole word (so "MU" doesn't match "museum") or contains the distinctive
 * company-name token. This is what separates real coverage from the peer/sector
 * noise Finnhub mis-tags onto a symbol's `related` field.
 */
export function isRelevantHeadline(headline: string, ticker: string, companyName: string | null): boolean {
  const h = headline.toLowerCase();
  if (new RegExp(`\\b${escapeRegex(ticker.toLowerCase())}\\b`).test(h)) return true;
  const token = companyName ? significantNameToken(companyName) : null;
  if (token && token.length >= 3 && new RegExp(`\\b${escapeRegex(token)}\\b`).test(h)) return true;
  return false;
}

/** Company display name via Finnhub /stock/profile2 (free tier). Throws on a non-ok status. */
export async function fetchCompanyProfileName(
  ticker: string,
  apiKey: string,
  fetchFn: FetchFn = fetch,
): Promise<string | null> {
  const url = `${PROFILE_ENDPOINT}?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Finnhub profile returned ${res.status}`);
  const b = (await res.json()) as { name?: string };
  return typeof b.name === "string" && b.name.length > 0 ? b.name : null;
}

/** Fetch + map ALL valid company-news items (no truncation) so we can filter before slicing. */
async function fetchRawCompanyNews(
  ticker: string,
  apiKey: string,
  fetchFn: FetchFn,
  now: number,
): Promise<NewsItem[]> {
  const to = ymd(now);
  const from = ymd(now - 7 * 24 * 60 * 60 * 1000);
  const url =
    `${NEWS_ENDPOINT}?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}` +
    `&token=${encodeURIComponent(apiKey)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Finnhub news returned ${res.status}`);
  const body = (await res.json()) as RawNews[];
  if (!Array.isArray(body)) return [];

  const items: NewsItem[] = [];
  for (const r of body) {
    if (typeof r.headline !== "string" || r.headline.length === 0) continue;
    if (typeof r.url !== "string" || r.url.length === 0) continue;
    items.push({
      headline: r.headline,
      source: r.source ?? "",
      url: r.url,
      datetime: r.datetime ?? 0,
      catalyst: classifyCatalyst(r.headline),
    });
  }
  return items;
}

/**
 * Company news, relevance-filtered BEFORE truncation. Finnhub tags peer-company
 * and generic sector-roundup articles onto a symbol's `related` field; the vendor
 * fetcher takes the 5 newest such items, which can crowd out the real coverage.
 * Here we fetch the company name + the full window in parallel, keep only items
 * whose headline actually concerns the company (ticker or name), then take the 5
 * newest of THOSE. The name lookup is best-effort (a failure degrades to
 * ticker-only matching); a news-fetch failure still throws so the caller's
 * safeSource wrapper can degrade it.
 */
export async function fetchRelevantCompanyNews(
  ticker: string,
  apiKey: string,
  fetchFn: FetchFn = fetch,
  now: number = Date.now(),
): Promise<NewsItem[]> {
  const [name, items] = await Promise.all([
    fetchCompanyProfileName(ticker, apiKey, fetchFn).catch(() => null),
    fetchRawCompanyNews(ticker, apiKey, fetchFn, now),
  ]);
  return items
    .filter((it) => isRelevantHeadline(it.headline, ticker, name))
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 5);
}
