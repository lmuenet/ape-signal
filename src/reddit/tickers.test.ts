// src/reddit/tickers.test.ts
import { describe, it, expect } from "vitest";
import { extractTickers, tallyTickers } from "./tickers";
import type { RedditPost } from "./agentBrowser";

describe("extractTickers", () => {
  it("extracts cashtags case-insensitively", () => {
    expect(extractTickers("buying $gme and $AMC today")).toEqual(expect.arrayContaining(["GME", "AMC"]));
  });
  it("extracts bare uppercase tickers but drops common stopwords", () => {
    const out = extractTickers("KSS looks good but YOLO and the CEO said DD on FDA");
    expect(out).toContain("KSS");
    expect(out).not.toContain("YOLO");
    expect(out).not.toContain("CEO");
    expect(out).not.toContain("DD");
    expect(out).not.toContain("FDA");
  });
  it("dedupes within a single text", () => {
    expect(extractTickers("$GME $GME GME")).toEqual(["GME"]);
  });
});

describe("tallyTickers", () => {
  it("counts mentions across posts and sums score", () => {
    const posts: RedditPost[] = [
      { title: "$KSS squeeze", selftext: "KSS again", score: 50, numComments: 5 },
      { title: "boring", selftext: "$KSS once more", score: 20, numComments: 2 },
    ];
    const tally = tallyTickers(posts);
    expect(tally.get("KSS")).toEqual({ mentions: 2, score: 70 });
  });
});
