// src/reddit/tickers.ts
import type { RedditPost } from "./agentBrowser";

// High-frequency uppercase words that are NOT tickers (WSB slang / finance acronyms).
const STOPWORDS = new Set<string>([
  "THE", "AND", "FOR", "ARE", "BUT", "NOT", "YOU", "ALL", "CAN", "HAS", "WAS",
  "YOLO", "DD", "WSB", "CEO", "CFO", "FDA", "SEC", "USA", "US", "IT", "OR", "ON",
  "IN", "TO", "BE", "DOW", "CPI", "FED", "ETF", "IPO", "EPS", "ATH", "ATM", "IMO",
  "AI", "EV", "PUT", "PUTS", "CALL", "CALLS", "BUY", "SELL", "HOLD", "HODL", "TLDR",
  "EOD", "PM", "AM", "GDP", "ROI", "PE", "EOY", "YTD", "FOMO", "RH", "OG", "LOL",
]);

const CASHTAG = /\$([A-Za-z]{1,5})\b/g;
const BARE = /\b([A-Z]{2,5})\b/g;

/** Extract candidate tickers from one text: cashtags (any case) + bare CAPS minus stopwords. Deduped, uppercased. */
export function extractTickers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CASHTAG)) out.add(m[1].toUpperCase());
  for (const m of text.matchAll(BARE)) {
    const t = m[1];
    if (!STOPWORDS.has(t)) out.add(t);
  }
  return [...out];
}

export interface TickerStat {
  mentions: number; // number of posts mentioning the ticker
  score: number; // summed reddit score of those posts
}

/** Tally tickers across posts. A ticker mentioned multiple times in one post counts once for that post. */
export function tallyTickers(posts: RedditPost[]): Map<string, TickerStat> {
  const tally = new Map<string, TickerStat>();
  for (const post of posts) {
    const tickers = new Set(extractTickers(`${post.title} ${post.selftext}`));
    for (const t of tickers) {
      const prev = tally.get(t) ?? { mentions: 0, score: 0 };
      tally.set(t, { mentions: prev.mentions + 1, score: prev.score + post.score });
    }
  }
  return tally;
}
