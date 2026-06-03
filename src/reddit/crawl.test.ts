// src/reddit/crawl.test.ts
import { describe, it, expect, vi } from "vitest";
import { crawlReddit } from "./crawl";
import type { RawRedditPost } from "./agentBrowser";

describe("crawlReddit", () => {
  it("runs the crawl, tallies across subreddits, returns mention-sorted candidates", async () => {
    const raw: Record<string, RawRedditPost[]> = {
      wallstreetbets: [{ title: "$KSS squeeze", score: "50", comments: "5 comments" }],
      shortsqueeze: [
        { title: "$KSS again", score: "30", comments: "2 comments" },
        { title: "$BBBY revival", score: "10", comments: "1 comment" },
      ],
    };
    const run = vi.fn(async () => raw);

    const candidates = await crawlReddit({ subreddits: ["wallstreetbets", "shortsqueeze"] }, { run });

    expect(run).toHaveBeenCalledWith(["wallstreetbets", "shortsqueeze"]);
    expect(candidates[0]).toEqual({ ticker: "KSS", mentions: 2, score: 80 });
    expect(candidates.find((c) => c.ticker === "BBBY")).toEqual({ ticker: "BBBY", mentions: 1, score: 10 });
  });

  it("treats a missing subreddit key as empty", async () => {
    const run = vi.fn(async () => ({ wallstreetbets: [{ title: "$GME", score: "5", comments: "1 comment" }] }));
    const candidates = await crawlReddit({ subreddits: ["wallstreetbets", "absent"] }, { run });
    expect(candidates).toEqual([{ ticker: "GME", mentions: 1, score: 5 }]);
  });
});
