import { describe, it, expect } from "vitest";
import { fetchRsLongShort } from "./rsScreener";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

/** Stub the TradingView scanner: branch on the POST body (SPY vs longs vs shorts). */
function stubScanner(opts: { ok?: boolean } = {}) {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    if (opts.ok === false) return jsonResponse({}, false, 503);
    if (body.includes("AMEX:SPY")) return jsonResponse({ data: [{ s: "AMEX:SPY", d: [4.0] }] }); // SPY Perf.1M = 4%
    if (body.includes('"asc"')) {
      return jsonResponse({
        data: [
          { s: "NYSE:WEAK", d: ["WEAK", 10, -2.0, -8, -30] },
          { s: "NYSE:SOFT", d: ["SOFT", 20, -1.0, -5, -20] },
        ],
      });
    }
    // default: longs (desc)
    return jsonResponse({
      data: [
        { s: "NASDAQ:STRONG", d: ["STRONG", 100, 3.0, 12, 60] },
        { s: "NASDAQ:GOOD", d: ["GOOD", 50, 1.0, 6, 25] },
      ],
    });
  }) as unknown as typeof fetch;
}

describe("fetchRsLongShort", () => {
  it("returns longs (strong) + shorts (weak) with RS computed vs SPY's 1M perf", async () => {
    const r = await fetchRsLongShort(stubScanner(), { limit: 2 });
    expect(r.spyPerfM).toBe(4);
    expect(r.longs.map((c) => c.ticker)).toEqual(["STRONG", "GOOD"]);
    expect(r.shorts.map((c) => c.ticker)).toEqual(["WEAK", "SOFT"]);
    // RS = candidate Perf.1M - SPY Perf.1M
    expect(r.longs[0]).toMatchObject({ ticker: "STRONG", close: 100, changePct: 3, perfW: 12, perfM: 60, rsM: 56 });
    expect(r.shorts[0].rsM).toBe(-34); // -30 - 4
  });

  it("throws on a non-ok scanner response (so the caller can degrade it)", async () => {
    await expect(fetchRsLongShort(stubScanner({ ok: false }))).rejects.toThrow("503");
  });
});
