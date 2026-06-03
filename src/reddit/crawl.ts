// src/reddit/crawl.ts
import { toPosts, type CrawlRunner } from "./agentBrowser";
import { tallyTickers, type TickerStat } from "./tickers";

export interface RedditCandidate {
  ticker: string;
  mentions: number;
  score: number;
}

export interface CrawlOptions {
  subreddits: string[];
}

export interface CrawlDeps {
  run: CrawlRunner;
}

/**
 * Run the crawl (agent-browser under the hood), normalise each subreddit's
 * posts, tally tickers across all of them, and return candidates sorted by
 * mentions (desc) then score (desc). Per-subreddit errors are already swallowed
 * inside the runner (it returns [] for a failed sub).
 */
export async function crawlReddit(
  options: CrawlOptions,
  deps: CrawlDeps,
): Promise<RedditCandidate[]> {
  const bySub = await deps.run(options.subreddits);
  const merged = new Map<string, TickerStat>();
  for (const sub of options.subreddits) {
    for (const [ticker, stat] of tallyTickers(toPosts(bySub[sub] ?? []))) {
      const prev = merged.get(ticker) ?? { mentions: 0, score: 0 };
      merged.set(ticker, { mentions: prev.mentions + stat.mentions, score: prev.score + stat.score });
    }
  }
  return [...merged.entries()]
    .map(([ticker, stat]) => ({ ticker, mentions: stat.mentions, score: stat.score }))
    .sort((a, b) => b.mentions - a.mentions || b.score - a.score);
}
