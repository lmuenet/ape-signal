// src/scan/offradar.ts
import type { RedditCandidate } from "../reddit/crawl";

export interface OffRadarOptions {
  minMentions: number;
  limit: number;
}

/**
 * Candidates worth surfacing: buzzing on reddit, NOT already in the Apewisdom
 * ranked list, and above a mention threshold (noise guard). Input is assumed
 * mention-sorted (crawlReddit guarantees this); the limit takes the top N.
 */
export function offRadar(
  candidates: RedditCandidate[],
  knownTickers: Set<string>,
  options: OffRadarOptions,
): RedditCandidate[] {
  return candidates
    .filter((c) => !knownTickers.has(c.ticker) && c.mentions >= options.minMentions)
    .slice(0, options.limit);
}
