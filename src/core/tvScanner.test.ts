import { describe, it, expect } from "vitest";
import { postScan, scanEndpoint, TV_SCANNER_ENDPOINT } from "./tvScanner";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("scanEndpoint", () => {
  it("defaults to the US (america) listings endpoint", () => {
    expect(scanEndpoint()).toBe("https://scanner.tradingview.com/america/scan");
    expect(TV_SCANNER_ENDPOINT).toBe(scanEndpoint("america"));
  });
  it("builds the germany endpoint for EUR venues", () => {
    expect(scanEndpoint("germany")).toBe("https://scanner.tradingview.com/germany/scan");
  });
});

describe("postScan market parameter", () => {
  it("posts to the US endpoint by default (backward-compatible)", async () => {
    let url = "";
    const fetchFn = async (u: RequestInfo | URL) => {
      url = String(u);
      return jsonResponse({ data: [] });
    };
    await postScan(fetchFn as typeof fetch, {});
    expect(url).toBe("https://scanner.tradingview.com/america/scan");
  });

  it("posts to the germany endpoint when market='germany'", async () => {
    let url = "";
    const fetchFn = async (u: RequestInfo | URL) => {
      url = String(u);
      return jsonResponse({ data: [] });
    };
    await postScan(fetchFn as typeof fetch, {}, "germany");
    expect(url).toBe("https://scanner.tradingview.com/germany/scan");
  });

  it("throws on a non-ok status (so callers can degrade)", async () => {
    const fetchFn = async () => jsonResponse({}, false, 500);
    await expect(postScan(fetchFn as typeof fetch, {}, "germany")).rejects.toThrow("500");
  });
});
