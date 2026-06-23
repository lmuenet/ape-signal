import { describe, it, expect } from "vitest";
import {
  fetchGermanRows,
  fetchUsIsins,
  isLiveQuote,
  pickListing,
  resolveListings,
  type GermanRow,
} from "./listingMap";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

// Mirrors the live germany-scan column order: description, close, currency,
// exchange, isin, change, high, low.
const QCOM = "US7475251036";
const row = (over: Partial<GermanRow>): GermanRow => ({
  isin: QCOM,
  name: "QUALCOMM Incorporated",
  deSymbol: "TRADEGATE:QCI",
  venue: "TRADEGATE",
  currency: "EUR",
  close: 181.04,
  high: 190,
  low: 177.82,
  changePct: -6.61,
  ...over,
});

describe("isLiveQuote", () => {
  it("is true when the venue shows a real intraday range", () => {
    expect(isLiveQuote({ high: 190, low: 177.82 })).toBe(true);
  });
  it("is false for a single market-maker print (high == low)", () => {
    expect(isLiveQuote({ high: 184, low: 184 })).toBe(false);
  });
});

describe("pickListing", () => {
  it("prefers Tradegate even when another venue has a wider range", () => {
    const picked = pickListing([
      row({ venue: "XETR", deSymbol: "XETR:QCI", high: 200, low: 170 }), // wider, but lower priority
      row({ venue: "TRADEGATE", deSymbol: "TRADEGATE:QCI", high: 190, low: 177.82 }),
    ]);
    expect(picked?.venue).toBe("TRADEGATE");
  });

  it("falls back to XETR when Tradegate is absent", () => {
    const picked = pickListing([
      row({ venue: "HAM", deSymbol: "HAM:QCI", high: 184, low: 184 }),
      row({ venue: "XETR", deSymbol: "XETR:QCI", high: 185.46, low: 178 }),
    ]);
    expect(picked?.venue).toBe("XETR");
  });

  it("uses widest intraday range as the tiebreaker among same-tier venues", () => {
    const picked = pickListing([
      row({ venue: "MUN", deSymbol: "MUN:QCI", high: 185.7, low: 184.5 }), // range 1.2
      row({ venue: "HAM", deSymbol: "HAM:QCI", high: 186, low: 180 }), // range 6.0
    ]);
    expect(picked?.deSymbol).toBe("HAM:QCI");
  });

  it("ignores rows without a positive close", () => {
    const picked = pickListing([
      row({ venue: "TRADEGATE", deSymbol: "TRADEGATE:QCI", close: 0 }),
      row({ venue: "XETR", deSymbol: "XETR:QCI", close: 180.1 }),
    ]);
    expect(picked?.venue).toBe("XETR");
  });

  it("returns null when no row is usable (name has no EUR listing)", () => {
    expect(pickListing([])).toBeNull();
    expect(pickListing([row({ close: 0 })])).toBeNull();
  });
});

describe("fetchUsIsins", () => {
  it("maps upper-cased tickers to their ISIN via the america scan", async () => {
    let url = "";
    let body = "";
    const fetchFn = async (u: RequestInfo | URL, init?: RequestInit) => {
      url = String(u);
      body = String(init?.body ?? "");
      return jsonResponse({ data: [{ s: "NASDAQ:QCOM", d: ["QCOM", QCOM] }] });
    };
    const m = await fetchUsIsins(["qcom"], fetchFn as typeof fetch);
    expect(m.get("QCOM")).toBe(QCOM);
    expect(url).toContain("/america/scan");
    expect(body).toContain('"left":"name"');
    expect(body).toContain('"QCOM"');
  });

  it("keeps the first match per name and skips rows without an ISIN", async () => {
    const fetchFn = async () =>
      jsonResponse({
        data: [
          { s: "NASDAQ:QCOM", d: ["QCOM", QCOM] },
          { s: "OTC:QCOM", d: ["QCOM", "OTHER"] },
          { s: "X", d: ["FOO", null] },
        ],
      });
    const m = await fetchUsIsins(["QCOM", "FOO"], fetchFn as typeof fetch);
    expect(m.get("QCOM")).toBe(QCOM);
    expect(m.has("FOO")).toBe(false);
  });

  it("does not call fetch for an empty ticker list", async () => {
    let called = false;
    const fetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    expect((await fetchUsIsins([], fetchFn as typeof fetch)).size).toBe(0);
    expect(called).toBe(false);
  });
});

describe("fetchGermanRows", () => {
  it("groups venue rows by ISIN and parses the germany columns", async () => {
    let url = "";
    let body = "";
    const fetchFn = async (u: RequestInfo | URL, init?: RequestInit) => {
      url = String(u);
      body = String(init?.body ?? "");
      return jsonResponse({
        data: [
          { s: "TRADEGATE:QCI", d: ["QUALCOMM Incorporated", 181.04, "EUR", "TRADEGATE", QCOM, -6.61, 190, 177.82] },
          { s: "XETR:QCI", d: ["QUALCOMM Incorporated", 180.1, "EUR", "XETR", QCOM, -10.1, 185.46, 178] },
        ],
      });
    };
    const byIsin = await fetchGermanRows([QCOM], fetchFn as typeof fetch);
    expect(url).toContain("/germany/scan");
    expect(body).toContain('"left":"isin"');
    const rows = byIsin.get(QCOM);
    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toEqual({
      isin: QCOM,
      name: "QUALCOMM Incorporated",
      deSymbol: "TRADEGATE:QCI",
      venue: "TRADEGATE",
      currency: "EUR",
      close: 181.04,
      high: 190,
      low: 177.82,
      changePct: -6.61,
    });
  });

  it("does not call fetch for an empty ISIN list", async () => {
    let called = false;
    const fetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    expect((await fetchGermanRows([], fetchFn as typeof fetch)).size).toBe(0);
    expect(called).toBe(false);
  });
});

describe("resolveListings", () => {
  it("joins US tickers to their preferred EUR venue and carries the clear name", async () => {
    const fetchFn = async (u: RequestInfo | URL) => {
      if (String(u).includes("/america/")) {
        return jsonResponse({ data: [{ s: "NASDAQ:QCOM", d: ["QCOM", QCOM] }] });
      }
      return jsonResponse({
        data: [
          { s: "HAM:QCI", d: ["QUALCOMM Incorporated", 184, "EUR", "HAM", QCOM, -8.05, 184, 184] },
          { s: "TRADEGATE:QCI", d: ["QUALCOMM Incorporated", 181.04, "EUR", "TRADEGATE", QCOM, -6.61, 190, 177.82] },
        ],
      });
    };
    const out = await resolveListings(["QCOM"], fetchFn as typeof fetch);
    expect(out).toEqual([
      {
        usTicker: "QCOM",
        isin: QCOM,
        name: "QUALCOMM Incorporated",
        deSymbol: "TRADEGATE:QCI",
        venue: "TRADEGATE",
        currency: "EUR",
        close: 181.04,
      },
    ]);
  });

  it("drops a name whose ISIN has no German listing (v1: EUR-only)", async () => {
    const fetchFn = async (u: RequestInfo | URL) => {
      if (String(u).includes("/america/")) {
        return jsonResponse({ data: [{ s: "NASDAQ:QCOM", d: ["QCOM", QCOM] }] });
      }
      return jsonResponse({ data: [] }); // no German venue for this ISIN
    };
    expect(await resolveListings(["QCOM"], fetchFn as typeof fetch)).toEqual([]);
  });

  it("returns empty without fetching when given no tickers", async () => {
    let called = false;
    const fetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    expect(await resolveListings([], fetchFn as typeof fetch)).toEqual([]);
    expect(called).toBe(false);
  });
});
