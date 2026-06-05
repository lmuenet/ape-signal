import { describe, it, expect } from "vitest";
import { fetchRsLongShort, fetchReadyToTrend, fetchStrongDaily } from "./rsScreener"; // fetchMomentum added in Task 2

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

  it("throws when SPY's benchmark is missing (rather than silently using rs vs 0)", async () => {
    const noSpy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("AMEX:SPY")) return jsonResponse({ data: [] }); // 200 but empty
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;
    await expect(fetchRsLongShort(noSpy)).rejects.toThrow("SPY");
  });

  it("restricts the candidate universe to common stocks (excludes ETFs/funds)", async () => {
    const bodies: string[] = [];
    const spy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      bodies.push(body);
      if (body.includes("AMEX:SPY")) return jsonResponse({ data: [{ s: "AMEX:SPY", d: [4.0] }] });
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;
    await fetchRsLongShort(spy, { limit: 2 });
    const candidateBodies = bodies.filter((b) => b.includes("sortBy"));
    expect(candidateBodies.length).toBe(2);
    expect(candidateBodies.every((b) => b.includes('"type"') && b.includes('"stock"'))).toBe(true);
  });
});

describe("fetchReadyToTrend", () => {
  it("returns consolidating strong longs + weak shorts with RS, using the consolidation filter", async () => {
    const bodies: string[] = [];
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      bodies.push(body);
      if (body.includes("AMEX:SPY")) return jsonResponse({ data: [{ s: "AMEX:SPY", d: [4.0] }] });
      if (body.includes('"asc"')) return jsonResponse({ data: [{ s: "NYSE:WEAK", d: ["WEAK", 10, -1, -2, -30] }] });
      return jsonResponse({ data: [{ s: "NASDAQ:STRONG", d: ["STRONG", 100, 0.5, 1.2, 40] }] });
    }) as unknown as typeof fetch;
    const r = await fetchReadyToTrend(fetchFn, { limit: 3 });
    expect(r.longs[0]).toMatchObject({ ticker: "STRONG", perfM: 40, rsM: 36 });
    expect(r.shorts[0]).toMatchObject({ ticker: "WEAK", perfM: -30, rsM: -34 });
    // candidate queries carry the consolidation criteria (quiet today + 1M strength)
    const candidateBodies = bodies.filter((b) => b.includes("sortBy"));
    expect(candidateBodies.every((b) => b.includes("Perf.1M") && b.includes("change") && b.includes("Perf.W"))).toBe(true);
    // common-stock universe applies here too
    expect(candidateBodies.every((b) => b.includes('"type"') && b.includes('"stock"'))).toBe(true);
  });

  it("throws when SPY's benchmark is missing (shared guard)", async () => {
    const noSpy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("AMEX:SPY")) return jsonResponse({ data: [] });
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;
    await expect(fetchReadyToTrend(noSpy)).rejects.toThrow("SPY");
  });
});

describe("fetchStrongDaily", () => {
  it("returns uptrend longs + downtrend shorts using a moving-average stack + RS", async () => {
    const bodies: string[] = [];
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      bodies.push(body);
      if (body.includes("AMEX:SPY")) return jsonResponse({ data: [{ s: "AMEX:SPY", d: [4.0] }] });
      if (body.includes('"asc"')) return jsonResponse({ data: [{ s: "NYSE:DOWN", d: ["DOWN", 10, -1, -6, -20] }] });
      return jsonResponse({ data: [{ s: "NASDAQ:UPTR", d: ["UPTR", 100, 1.0, 5, 30] }] });
    }) as unknown as typeof fetch;

    const r = await fetchStrongDaily(fetchFn, { limit: 3 });
    expect(r.spyPerfM).toBe(4);
    expect(r.longs[0]).toMatchObject({ ticker: "UPTR", perfM: 30, rsM: 26 });
    expect(r.shorts[0]).toMatchObject({ ticker: "DOWN", perfM: -20, rsM: -24 });

    const candidateBodies = bodies.filter((b) => b.includes("sortBy"));
    expect(candidateBodies.length).toBe(2);
    const longBody = candidateBodies.find((b) => b.includes('"desc"'))!;
    expect(longBody).toContain('"SMA20"');
    expect(longBody).toContain('"SMA50"');
    expect(longBody).toContain('"SMA200"');
    expect(longBody).toContain('"egreater"');
    expect(longBody).toContain('"sortBy":"Perf.1M"');
    expect(candidateBodies.every((b) => b.includes('"type"') && b.includes('"stock"'))).toBe(true);
  });

  it("throws when SPY's benchmark is missing (shared guard)", async () => {
    const noSpy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("AMEX:SPY")) return jsonResponse({ data: [] });
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;
    await expect(fetchStrongDaily(noSpy)).rejects.toThrow("SPY");
  });
});
