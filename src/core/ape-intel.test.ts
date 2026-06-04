import { describe, it, expect } from "vitest";
import {
  fetchApewisdomSnapshot,
  assembleTrendingBriefing,
  TRENDING_EXPORT_PROMPT,
  buildTrendingClipboardPayload,
  parseTrendingChallenge,
} from "./ape-intel";
import {
  fetchStockTwitsForTicker,
  fetchTradestieSnapshot,
  fetchCompanyNews,
  aggregate,
  buildClipboardPayload,
  DEFAULT_EXPORT_PROMPT,
  DEFAULT_PROFILE,
  normalizeProfile,
  parseStrategy,
} from "./ape-intel";

describe("ape-intel barrel", () => {
  it("re-exports the pure lib surface the scan needs", () => {
    expect(typeof fetchApewisdomSnapshot).toBe("function");
    expect(typeof assembleTrendingBriefing).toBe("function");
    expect(typeof buildTrendingClipboardPayload).toBe("function");
    expect(typeof parseTrendingChallenge).toBe("function");
    expect(TRENDING_EXPORT_PROMPT).toContain("signal");
  });
});

describe("ape-intel strategy re-exports", () => {
  it("re-exports the strategy/data functions used by /strategie", () => {
    expect(typeof fetchStockTwitsForTicker).toBe("function");
    expect(typeof fetchTradestieSnapshot).toBe("function");
    expect(typeof fetchCompanyNews).toBe("function");
    expect(typeof aggregate).toBe("function");
    expect(typeof buildClipboardPayload).toBe("function");
    expect(typeof parseStrategy).toBe("function");
    expect(typeof normalizeProfile).toBe("function");
    expect(DEFAULT_PROFILE.risk).toBe("balanced");
    expect(DEFAULT_EXPORT_PROMPT).toContain("equity analyst");
  });
});
