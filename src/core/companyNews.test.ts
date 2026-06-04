import { describe, it, expect } from "vitest";
import { fetchRelevantCompanyNews, fetchCompanyProfileName, isRelevantHeadline } from "./companyNews";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

/** Stub fetch that branches on the Finnhub endpoint in the URL. */
function stubFetch(profile: unknown, news: unknown, opts: { profileOk?: boolean; newsOk?: boolean } = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/stock/profile2")) return jsonResponse(profile, opts.profileOk ?? true, opts.profileOk === false ? 403 : 200);
    if (url.includes("/company-news")) return jsonResponse(news, opts.newsOk ?? true, opts.newsOk === false ? 429 : 200);
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

const GLW_NEWS = [
  { headline: "Ciena Stock Falls On Fiscal Q2 Earnings As Guidance Underwhelms", url: "u1", source: "IBD", datetime: 1000 },
  { headline: "Gapping S&P500 stocks in Thursday's session", url: "u2", source: "X", datetime: 999 },
  { headline: "Why Corning (GLW) Stock Is Trading Up Today", url: "u3", source: "Zacks", datetime: 800 },
  { headline: "How Corning Turned Glass Into Gold", url: "u4", source: "Motley", datetime: 700 },
  { headline: "CIEN Q2 Earnings Beat on AI-Led Networking Demand", url: "u5", source: "Zacks", datetime: 998 },
];

describe("isRelevantHeadline", () => {
  it("keeps headlines naming the ticker (word-boundary) or the company name", () => {
    expect(isRelevantHeadline("Why Corning (GLW) Stock Is Trading Up", "GLW", "Corning Inc")).toBe(true);
    expect(isRelevantHeadline("How Corning Turned Glass Into Gold", "GLW", "Corning Inc")).toBe(true);
  });
  it("drops peer-company and generic sector headlines", () => {
    expect(isRelevantHeadline("Ciena Stock Falls On Fiscal Q2 Earnings", "GLW", "Corning Inc")).toBe(false);
    expect(isRelevantHeadline("Gapping S&P500 stocks in Thursday's session", "GLW", "Corning Inc")).toBe(false);
  });
  it("matches the ticker only as a whole word (no substring false positives)", () => {
    expect(isRelevantHeadline("The museum opened today", "MU", null)).toBe(false);
    expect(isRelevantHeadline("MU beats on earnings", "MU", null)).toBe(true);
  });
});

describe("fetchCompanyProfileName", () => {
  it("returns the company name", async () => {
    const name = await fetchCompanyProfileName("GLW", "key", stubFetch({ name: "Corning Inc" }, []));
    expect(name).toBe("Corning Inc");
  });
  it("returns null when the profile has no name", async () => {
    expect(await fetchCompanyProfileName("X", "key", stubFetch({}, []))).toBeNull();
  });
  it("throws on a non-ok response", async () => {
    await expect(fetchCompanyProfileName("X", "key", stubFetch({}, [], { profileOk: false }))).rejects.toThrow("403");
  });
});

describe("fetchRelevantCompanyNews", () => {
  it("keeps only company-relevant items, newest first, max 5 — BEFORE truncating", async () => {
    const news = await fetchRelevantCompanyNews("GLW", "key", stubFetch({ name: "Corning Inc" }, GLW_NEWS), 2000);
    expect(news.map((n) => n.url)).toEqual(["u3", "u4"]); // the two Corning items, newest first
    expect(news.every((n) => /corning|glw/i.test(n.headline))).toBe(true);
  });

  it("falls back to ticker-only matching when the profile lookup fails", async () => {
    const news = await fetchRelevantCompanyNews("GLW", "key", stubFetch({}, GLW_NEWS, { profileOk: false }), 2000);
    // profile failed → name null → only the "(GLW)" headline matches by ticker
    expect(news.map((n) => n.url)).toEqual(["u3"]);
  });

  it("throws if the news fetch itself fails (so safeSource can degrade it)", async () => {
    await expect(
      fetchRelevantCompanyNews("GLW", "key", stubFetch({ name: "Corning Inc" }, [], { newsOk: false }), 2000),
    ).rejects.toThrow("429");
  });
});
