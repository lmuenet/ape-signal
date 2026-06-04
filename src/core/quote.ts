const QUOTE_ENDPOINT = "https://finnhub.io/api/v1/quote";

export interface Quote {
  current: number;
  changePct: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface RawQuote {
  c?: number; // current
  dp?: number; // percent change
  h?: number; // high
  l?: number; // low
  o?: number; // open
  pc?: number; // previous close
}

/**
 * Current price for a ticker via Finnhub /quote (free-tier, real-time US).
 * Returns null for an unknown symbol (Finnhub answers c=0). Throws on a
 * non-ok HTTP status so the caller's safeSource wrapper can degrade it.
 */
export async function fetchQuote(
  ticker: string,
  apiKey: string,
  fetchFn: FetchFn = fetch,
): Promise<Quote | null> {
  const url = `${QUOTE_ENDPOINT}?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Finnhub quote returned ${res.status}`);
  const b = (await res.json()) as RawQuote;
  if (typeof b.c !== "number" || b.c === 0) return null;
  return {
    current: b.c,
    changePct: b.dp ?? 0,
    high: b.h ?? 0,
    low: b.l ?? 0,
    open: b.o ?? 0,
    prevClose: b.pc ?? 0,
  };
}
