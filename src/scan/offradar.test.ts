// src/scan/offradar.test.ts
import { describe, it, expect } from "vitest";
import { offRadar } from "./offradar";
import type { RedditCandidate } from "../reddit/crawl";

const candidates: RedditCandidate[] = [
  { ticker: "GME", mentions: 9, score: 900 },
  { ticker: "KSS", mentions: 4, score: 300 },
  { ticker: "BBBY", mentions: 1, score: 10 },
];

describe("offRadar", () => {
  it("keeps reddit candidates not in apewisdom and above the mention threshold", () => {
    const known = new Set(["GME", "TSLA"]);
    expect(offRadar(candidates, known, { minMentions: 2, limit: 10 }).map((c) => c.ticker)).toEqual(["KSS"]);
  });

  it("applies the limit", () => {
    const many: RedditCandidate[] = [
      { ticker: "AAA", mentions: 5, score: 1 },
      { ticker: "BBB", mentions: 4, score: 1 },
      { ticker: "CCC", mentions: 3, score: 1 },
    ];
    expect(offRadar(many, new Set(), { minMentions: 2, limit: 2 })).toHaveLength(2);
  });
});
