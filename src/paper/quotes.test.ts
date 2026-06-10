import { describe, expect, it } from "vitest";
import { fetchTickQuotes } from "./quotes";

const ok = (data: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as unknown as Response);

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
