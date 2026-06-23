import { describe, expect, it } from "vitest";
import { fetchTickQuotes, fetchTickQuotesEur } from "./quotes";

const ok = (data: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as unknown as Response);

const QCOM = "US7475251036";

describe("fetchTickQuotes", () => {
  it("maps scanner rows to tick quotes, first listing wins", async () => {
    const quotes = await fetchTickQuotes(["nvda", "TSLA"], () =>
      ok({
        data: [
          { s: "NASDAQ:NVDA", d: ["NVDA", 100.5, 1.2, 102, 99] },
          { s: "OTC:NVDA", d: ["NVDA", 90, 0, 0, 0] },
          { s: "NASDAQ:TSLA", d: ["TSLA", 200, -0.5, 201, 195.5] },
        ],
      }),
    );
    expect(quotes.NVDA).toEqual({ close: 100.5, changePct: 1.2, high: 102, low: 99 });
    expect(quotes.TSLA?.low).toBe(195.5);
  });

  it("parses EMA/RSI indicator columns when present", async () => {
    const quotes = await fetchTickQuotes(["NVDA"], () =>
      ok({ data: [{ s: "NASDAQ:NVDA", d: ["NVDA", 110, 1.2, 112, 108, 108.5, 105, 100, 62.4] }] }),
    );
    expect(quotes.NVDA).toEqual({
      close: 110,
      changePct: 1.2,
      high: 112,
      low: 108,
      ema10: 108.5,
      ema20: 105,
      ema50: 100,
      rsi: 62.4,
    });
  });

  it("leaves indicator fields absent (not 0) when the scanner omits them", async () => {
    const quotes = await fetchTickQuotes(["NVDA"], () =>
      ok({ data: [{ s: "NASDAQ:NVDA", d: ["NVDA", 110, 1.2, 112, 108, null, null, null, null] }] }),
    );
    expect(quotes.NVDA).toEqual({ close: 110, changePct: 1.2, high: 112, low: 108 });
    expect(quotes.NVDA?.ema20).toBeUndefined();
  });

  it("skips unknown symbols and returns {} for no tickers", async () => {
    expect(await fetchTickQuotes([], () => ok({ data: [] }))).toEqual({});
    const quotes = await fetchTickQuotes(["NVDA"], () => ok({ data: [{ d: [null, 1] }] }));
    expect(quotes).toEqual({});
  });

  it("throws on a non-ok status", async () => {
    await expect(
      fetchTickQuotes(["NVDA"], () => Promise.resolve({ ok: false, status: 429 } as unknown as Response)),
    ).rejects.toThrow(/429/);
  });
});

describe("fetchTickQuotesEur", () => {
  // Two venues for the same ISIN; the EUR layout has `close` at offset 0.
  const GERMANY = {
    data: [
      { s: "TRADEGATE:QCI", d: [181.04, -6.61, 190, 177.82, 188.8, 187.8, 173.3, 48] },
      { s: "XETR:QCI", d: [180.1, -10.1, 185.46, 178, 189.8, 188.5, 173.6, 47.3] },
    ],
  };

  it("prices each holding on its EXACT entry venue, keyed by the bot's ticker", async () => {
    let url = "";
    let body = "";
    const fetchFn = (u: RequestInfo | URL, init?: RequestInit) => {
      url = String(u);
      body = String(init?.body ?? "");
      return ok(GERMANY);
    };
    const quotes = await fetchTickQuotesEur(
      [{ ticker: "QCOM", deSymbol: "TRADEGATE:QCI", isin: QCOM }],
      fetchFn as typeof fetch,
    );
    // Tradegate's quote (not XETR's), parsed with EMA/RSI, under the US ticker key.
    expect(quotes.QCOM).toEqual({
      close: 181.04,
      changePct: -6.61,
      high: 190,
      low: 177.82,
      ema10: 188.8,
      ema20: 187.8,
      ema50: 173.3,
      rsi: 48,
    });
    expect(url).toContain("/germany/scan");
    expect(body).toContain('"left":"isin"');
    expect(body).toContain(QCOM);
  });

  it("skips a holding whose exact entry venue is absent this tick (leaves it untouched)", async () => {
    const quotes = await fetchTickQuotesEur(
      [{ ticker: "QCOM", deSymbol: "GETTEX:QCI", isin: QCOM }], // GETTEX not in the response
      () => ok(GERMANY),
    );
    expect(quotes).toEqual({});
  });

  it("returns {} WITHOUT fetching when no holding carries an ISIN", async () => {
    let called = false;
    const fetchFn = () => {
      called = true;
      return ok(GERMANY);
    };
    expect(await fetchTickQuotesEur([{ ticker: "QCOM" }], fetchFn as typeof fetch)).toEqual({});
    expect(called).toBe(false);
  });

  it("throws on a non-ok status (so the tick can skip)", async () => {
    await expect(
      fetchTickQuotesEur([{ ticker: "QCOM", deSymbol: "TRADEGATE:QCI", isin: QCOM }], () =>
        Promise.resolve({ ok: false, status: 503 } as unknown as Response),
      ),
    ).rejects.toThrow(/503/);
  });
});
