import type { ApewisdomSnapshot, TrendingRow } from "../core/ape-intel";

const DEFAULT_LIMIT = 15;

/**
 * Flatten an Apewisdom snapshot into ranked TrendingRows. Mirrors what the
 * extension's ApewisdomService.board() does, but without the browser KvStore —
 * the scan holds the snapshot in memory for one run.
 */
export function snapshotToRows(
  snapshot: ApewisdomSnapshot,
  limit: number = DEFAULT_LIMIT,
): TrendingRow[] {
  return Array.from(snapshot.entries())
    .map(([ticker, e]) => ({
      ticker,
      name: (e as { name?: string }).name,
      rank: e.rank,
      mentions: e.mentions,
      mentions24hAgo: e.mentions24hAgo,
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
}
