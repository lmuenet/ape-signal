import { describe, it, expect } from "vitest";
import {
  fetchApewisdomSnapshot,
  assembleTrendingBriefing,
  TRENDING_EXPORT_PROMPT,
  buildTrendingClipboardPayload,
  parseTrendingChallenge,
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
