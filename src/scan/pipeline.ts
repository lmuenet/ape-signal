// src/scan/pipeline.ts
import {
  buildTrendingClipboardPayload,
  parseTrendingChallenge,
  type ApewisdomSnapshot,
  type TrendingChallenge,
  type TrendingRow,
  type TrendQuote,
} from "../core/ape-intel";
import { GERMAN_DIRECTIVE_TRENDING, HEADLESS_JSON_DIRECTIVE } from "../core/language";
import { snapshotToRows } from "./trending";
import { formatReport } from "./format";
import { offRadar } from "./offradar";
import type { RedditCandidate } from "../reddit/crawl";
import type { EarningsRow } from "./earnings";
import type { RsResult } from "./rsScreener";

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
  fetchTrend?: (tickers: string[]) => Promise<Map<string, TrendQuote>>;
  fetchRsLongShort?: () => Promise<RsResult>;
}

/**
 * Render the relative-strength long/short candidates (TradingView RS vs SPY,
 * 1-month) as a briefing section. Returns "" when there's nothing to show.
 */
function renderRsBlock(rs: RsResult | null): string {
  if (!rs || (rs.longs.length === 0 && rs.shorts.length === 0)) return "";
  const sign = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1);
  const line = (c: RsResult["longs"][number]) =>
    `${c.ticker}: ${c.close.toFixed(2)} (1M ${sign(c.perfM)}%, RS ${sign(c.rsM)}, 1W ${sign(c.perfW)}%, heute ${sign(c.changePct)}%)`;
  return [
    "## Long-/Short-Kandidaten (relative Staerke vs. SPY, 1M, TradingView)",
    `Markt-Benchmark SPY 1M: ${sign(rs.spyPerfM)}%`,
    "Long (stark vs. Markt):",
    ...rs.longs.map((c) => "  " + line(c)),
    "Short (schwach vs. Markt):",
    ...rs.shorts.map((c) => "  " + line(c)),
    "",
    "Mechanische RS/RW-Kandidaten (Momentum relativ zum Markt) — KEIN Trade-Signal;",
    "pruefe Setup, Katalysator und Trend, bevor du etwas davon ableitest.",
  ].join("\n");
}

/**
 * Render a live price + 1W/1M/3M trend block from the TradingView scanner data,
 * in the trending list's order. Tickers the scanner didn't return are skipped.
 * Returns "" when there's nothing to show (caller filters it out).
 */
function renderTrendBlock(rows: TrendingRow[], trend: Map<string, TrendQuote>): string {
  const sign = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);
  const lines = rows
    .map((r) => {
      const q = trend.get(r.ticker.toUpperCase());
      if (!q) return null;
      return `${r.ticker}: ${q.close.toFixed(2)} (heute ${sign(q.changePct)}%, 1W ${sign(q.perfW)}%, 1M ${sign(q.perfM)}%, 3M ${sign(q.perf3M)}%)`;
    })
    .filter((x): x is string => x !== null);
  if (lines.length === 0) return "";
  return [
    "## Kurse & Trend (Live, TradingView)",
    ...lines,
    "",
    "Nutze diese aktuellen Kurse und die 1W/1M/3M-Performance aktiv in deiner Einschaetzung",
    "(Momentum, Ueberdehnung, wo der Wert herkommt) — nicht nur die Mention-Zahlen.",
  ].join("\n");
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

  let trend = new Map<string, TrendQuote>();
  if (deps.fetchTrend) {
    try {
      trend = await deps.fetchTrend(combined.map((r) => r.ticker));
    } catch (err) {
      console.error(`[scan] trend fetch failed, continuing without prices: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let rs: RsResult | null = null;
  if (deps.fetchRsLongShort) {
    try {
      rs = await deps.fetchRsLongShort();
    } catch (err) {
      console.error(`[scan] RS candidates fetch failed, continuing without them: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const payload = [
    buildTrendingClipboardPayload(combined),
    renderTrendBlock(combined, trend),
    renderRsBlock(rs),
    GERMAN_DIRECTIVE_TRENDING,
    HEADLESS_JSON_DIRECTIVE,
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
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
