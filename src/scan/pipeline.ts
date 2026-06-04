// src/scan/pipeline.ts
import {
  buildTrendingClipboardPayload,
  parseTrendingChallenge,
  type ApewisdomSnapshot,
  type TrendingChallenge,
  type TrendingRow,
} from "../core/ape-intel";
import { GERMAN_DIRECTIVE_TRENDING, HEADLESS_JSON_DIRECTIVE } from "../core/language";
import { snapshotToRows } from "./trending";
import { formatReport } from "./format";
import { offRadar } from "./offradar";
import type { RedditCandidate } from "../reddit/crawl";
import type { EarningsRow } from "./earnings";

export interface ScanOptions {
  label: string;
  limit: number;
  offRadarMinMentions?: number;
  offRadarLimit?: number;
}

export interface ScanDeps {
  fetchSnapshot: () => Promise<ApewisdomSnapshot>;
  claudeRunner: (prompt: string) => Promise<string>;
  send: (text: string) => Promise<void>;
  crawlReddit?: () => Promise<RedditCandidate[]>;
  fetchEarningsToday?: (tickers: string[]) => Promise<EarningsRow[]>;
}

/**
 * One scan run: fetch Apewisdom trending → (optionally) crawl reddit for
 * off-radar candidates → challenge the COMBINED list via one Claude call →
 * (optionally) attach today's earnings → format (off-radar in its own section)
 * → send. Reddit/earnings are optional; a reddit-crawl failure is logged and
 * the scan continues without off-radar. Without the deps this behaves exactly
 * like Plan 1.
 */
export async function runScan(
  options: ScanOptions,
  deps: ScanDeps,
): Promise<TrendingChallenge> {
  const snapshot = await deps.fetchSnapshot();
  const rows = snapshotToRows(snapshot, options.limit);
  const knownTickers = new Set(snapshot.keys());

  let offRadarRows: TrendingRow[] = [];
  if (deps.crawlReddit) {
    try {
      const candidates = await deps.crawlReddit();
      const picked = offRadar(candidates, knownTickers, {
        minMentions: options.offRadarMinMentions ?? 2,
        limit: options.offRadarLimit ?? 5,
      });
      offRadarRows = picked.map((c, i) => ({
        ticker: c.ticker,
        rank: rows.length + i + 1,
        mentions: c.mentions,
        mentions24hAgo: c.mentions, // reddit has no 24h delta → flat
      }));
    } catch (err) {
      console.error(`[scan] reddit crawl failed, continuing without off-radar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const combined = [...rows, ...offRadarRows];
  const payload = `${buildTrendingClipboardPayload(combined)}\n\n${GERMAN_DIRECTIVE_TRENDING}\n\n${HEADLESS_JSON_DIRECTIVE}`;
  const raw = await deps.claudeRunner(payload);
  const challenge = parseTrendingChallenge(raw) ?? { summary: "", verdicts: [] };

  const earningsToday = deps.fetchEarningsToday
    ? await deps.fetchEarningsToday(combined.map((r) => r.ticker))
    : undefined;

  const report = formatReport(combined, challenge, {
    label: options.label,
    offRadarTickers: offRadarRows.map((r) => r.ticker),
    earningsToday,
  });
  await deps.send(report);

  return challenge;
}
