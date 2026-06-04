import { describe, it, expect } from "vitest";
import { fetchQuote } from "./quote";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("fetchQuote", () => {
  it("maps a Finnhub /quote payload to a Quote", async () => {
    const fetchFn = async () => jsonResponse({ c: 1234.5, d: 20, dp: 1.65, h: 1240, l: 1210, o: 1215, pc: 1214.5 });
    const q = await fetchQuote("AVGO", "key", fetchFn as typeof fetch);
    expect(q).toEqual({ current: 1234.5, changePct: 1.65, high: 1240, low: 1210, open: 1215, prevClose: 1214.5 });
  });

  it("returns null for an unknown symbol (Finnhub returns c=0)", async () => {
    const fetchFn = async () => jsonResponse({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0 });
    expect(await fetchQuote("NOPE", "key", fetchFn as typeof fetch)).toBeNull();
  });

  it("throws on a non-ok HTTP response (so safeSource can catch it)", async () => {
    const fetchFn = async () => jsonResponse({}, false, 429);
    await expect(fetchQuote("AVGO", "key", fetchFn as typeof fetch)).rejects.toThrow("429");
  });
});
