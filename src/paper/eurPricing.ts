// src/paper/eurPricing.ts — the shared EUR pricing layer that ties identity
// resolution (core/listingMap: US ticker → German venue via ISIN) to price
// fetching (quotes: fetchTickQuotesEur). The Kür, the intraday opener and the
// Setup-Radar all start from bare US tickers, so they resolve + price here; the
// monitor tick prices held positions directly (their venue is already stored).
// See docs/superpowers/specs/2026-06-23-eur-pricing-* and ADR 0005.
import { resolveListings, type ResolvedListing } from "../core/listingMap";
import type { FetchFn } from "../core/tvScanner";
import { fetchTickQuotesEur, type QuoteHolding } from "./quotes";
import type { QuoteMap, TradeDecision } from "./types";

export interface EurPricing {
  /** EUR quotes keyed by US ticker (drop-in for the engine, which looks up by ticker). */
  quotes: QuoteMap;
  /** Resolved listings keyed by UPPER-CASE US ticker — to enrich decisions with name/venue. */
  listings: Map<string, ResolvedListing>;
}

/**
 * Resolve bare US tickers to their German EUR listings and fetch EUR quotes.
 * `heldHoldings` (open positions/orders that already carry their venue) override
 * the freshly resolved holdings for the quote fetch, so a held name is always
 * priced on the SAME venue it was entered on (consistent with the monitor tick).
 * The `listings` map only covers the resolved tickers; held names already carry
 * their own ListingRef. Throws if a scan fails (callers degrade/skip).
 */
export async function resolveAndFetchEur(
  tickers: string[],
  fetchFn: FetchFn = fetch,
  heldHoldings: QuoteHolding[] = [],
): Promise<EurPricing> {
  const resolved = await resolveListings(tickers, fetchFn);
  const listings = new Map(resolved.map((r) => [r.usTicker.toUpperCase(), r]));
  const byTicker = new Map<string, QuoteHolding>();
  for (const r of resolved) byTicker.set(r.usTicker, { ticker: r.usTicker, deSymbol: r.deSymbol, isin: r.isin });
  for (const h of heldHoldings) byTicker.set(h.ticker, h); // held override (stored venue)
  const quotes = await fetchTickQuotesEur([...byTicker.values()], fetchFn);
  return { quotes, listings };
}

/**
 * Enrich one of Mr Ape's trade decisions with its resolved German EUR listing
 * (deSymbol/isin/name/currency) so placeOrders carries it onto the order →
 * position. A ticker with no resolved EUR listing is returned unchanged (it will
 * lack an EUR quote and be rejected at placeOrders — v1 trades EUR names only).
 */
export function enrichWithListing(trade: TradeDecision, listings: Map<string, ResolvedListing>): TradeDecision {
  const l = listings.get(trade.ticker.toUpperCase());
  if (!l) return trade;
  return { ...trade, deSymbol: l.deSymbol, isin: l.isin, name: l.name, currency: l.currency };
}
