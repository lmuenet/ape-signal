import { describe, expect, it } from "vitest";
import { enrichWithListing, resolveAndFetchEur } from "./eurPricing";
import type { ResolvedListing } from "../core/listingMap";
import type { TradeDecision } from "./types";

const QCOM = "US7475251036";
const ok = (data: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as unknown as Response);

// One mock that serves all three scans resolveAndFetchEur makes: the america
// ISIN lookup, the germany venue rows (resolveListings, "description" layout)
// and the germany full quotes (fetchTickQuotesEur, "EMA10" layout).
function scannerMock() {
  return (u: RequestInfo | URL, init?: RequestInit) => {
    const url = String(u);
    const body = String(init?.body ?? "");
    if (url.includes("/america/")) return ok({ data: [{ s: "NASDAQ:QCOM", d: ["QCOM", QCOM] }] });
    if (body.includes('"description"')) {
      return ok({
        data: [
          { s: "TRADEGATE:QCI", d: ["QUALCOMM Incorporated", 181.04, "EUR", "TRADEGATE", QCOM, -6.61, 190, 177.82] },
          { s: "XETR:QCI", d: ["QUALCOMM Incorporated", 180.1, "EUR", "XETR", QCOM, -10.1, 185.46, 178] },
        ],
      });
    }
    return ok({
      data: [
        { s: "TRADEGATE:QCI", d: [181.04, -6.61, 190, 177.82, 188.8, 187.8, 173.3, 48] },
        { s: "XETR:QCI", d: [180.1, -10.1, 185.46, 178, 189.8, 188.5, 173.6, 47.3] },
      ],
    });
  };
}

describe("resolveAndFetchEur", () => {
  it("resolves a US ticker to its EUR venue and prices it (quotes keyed by ticker)", async () => {
    const { quotes, listings } = await resolveAndFetchEur(["QCOM"], scannerMock() as typeof fetch);
    expect(listings.get("QCOM")).toMatchObject({ venue: "TRADEGATE", currency: "EUR", name: "QUALCOMM Incorporated" });
    // Priced on the resolved (Tradegate) venue, full quote incl. EMA/RSI.
    expect(quotes.QCOM).toMatchObject({ close: 181.04, high: 190, low: 177.82, ema10: 188.8, rsi: 48 });
  });

  it("returns empty pricing without throwing when nothing resolves", async () => {
    const fetchFn = (u: RequestInfo | URL) =>
      String(u).includes("/america/") ? ok({ data: [] }) : ok({ data: [] });
    const { quotes, listings } = await resolveAndFetchEur(["NOPE"], fetchFn as typeof fetch);
    expect(listings.size).toBe(0);
    expect(quotes).toEqual({});
  });
});

describe("enrichWithListing", () => {
  const listing: ResolvedListing = {
    usTicker: "QCOM",
    isin: QCOM,
    name: "QUALCOMM Incorporated",
    deSymbol: "TRADEGATE:QCI",
    venue: "TRADEGATE",
    currency: "EUR",
    close: 181.04,
  };
  const listings = new Map([["QCOM", listing]]);
  const trade: TradeDecision = { ticker: "QCOM", side: "long", stake: 200, leverage: 2, entry: 180, stopLoss: 170, thesis: "t" };

  it("copies the resolved listing fields onto the decision", () => {
    expect(enrichWithListing(trade, listings)).toMatchObject({
      deSymbol: "TRADEGATE:QCI",
      isin: QCOM,
      name: "QUALCOMM Incorporated",
      currency: "EUR",
    });
  });

  it("passes a decision through unchanged when its ticker has no EUR listing", () => {
    expect(enrichWithListing({ ...trade, ticker: "NOPE" }, listings)).toEqual({ ...trade, ticker: "NOPE" });
  });
});
