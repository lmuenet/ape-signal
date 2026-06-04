import { describe, it, expect } from "vitest";
import { fetchTradingViewTrend } from "./marketData";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const SAMPLE = {
  totalCount: 2,
  data: [
    { s: "NASDAQ:MU", d: ["MU", 1024.6, -5.09, 10.19, 68.03, 169.53] },
    { s: "NASDAQ:AVGO", d: ["AVGO", 418.13, -12.75, -0.71, -0.84, 27.37] },
  ],
};

describe("fetchTradingViewTrend", () => {
  it("maps scanner rows to a ticker→TrendQuote map (close + 1D/1W/1M/3M trend)", async () => {
    let sentBody = "";
    const fetchFn = async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return jsonResponse(SAMPLE);
    };
    const m = await fetchTradingViewTrend(["MU", "avgo"], fetchFn as typeof fetch);
    expect(m.get("AVGO")).toEqual({ close: 418.13, changePct: -12.75, perfW: -0.71, perfM: -0.84, perf3M: 27.37 });
    expect(m.get("MU")?.close).toBe(1024.6);
    // request is a filter-by-name POST with upper-cased tickers + the perf columns
    expect(sentBody).toContain("Perf.W");
    expect(sentBody).toContain("\"AVGO\"");
    // guard the exact filter structure so a silent API-shape regression is caught
    expect(sentBody).toContain("\"left\":\"name\"");
    expect(sentBody).toContain("\"in_range\"");
  });

  it("returns an empty map WITHOUT calling fetch when no tickers are given", async () => {
    let called = false;
    const fetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    const m = await fetchTradingViewTrend([], fetchFn as typeof fetch);
    expect(m.size).toBe(0);
    expect(called).toBe(false);
  });

  it("throws on a non-ok response (so the caller can degrade it)", async () => {
    const fetchFn = async () => jsonResponse({}, false, 503);
    await expect(fetchTradingViewTrend(["AVGO"], fetchFn as typeof fetch)).rejects.toThrow("503");
  });

  it("skips malformed / unrecognised rows instead of throwing", async () => {
    const fetchFn = async () => jsonResponse({ data: [{ s: "X", d: null }, { s: "Y" }] });
    const m = await fetchTradingViewTrend(["FOO"], fetchFn as typeof fetch);
    expect(m.size).toBe(0);
  });

  it("keeps the first match per name (ignores duplicate listings)", async () => {
    const fetchFn = async () =>
      jsonResponse({
        data: [
          { s: "NASDAQ:MU", d: ["MU", 1024.6, -5.09, 10.19, 68.03, 169.53] },
          { s: "OTC:MU", d: ["MU", 1.0, 0, 0, 0, 0] },
        ],
      });
    const m = await fetchTradingViewTrend(["MU"], fetchFn as typeof fetch);
    expect(m.get("MU")?.close).toBe(1024.6);
  });
});
