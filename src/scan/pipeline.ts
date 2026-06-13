// src/scan/pipeline.ts
import {
  buildTrendingClipboardPayload,
  parseTrendingChallenge,
  type ApewisdomSnapshot,
  type TrendingChallenge,
  type TrendingRow,
  type TrendQuote,
} from "../core/ape-intel";
import { trendingDirective, HEADLESS_JSON_DIRECTIVE } from "../core/language";
import type { Language } from "../core/language";
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
  fetchReadyToTrend?: () => Promise<RsResult>;
  fetchStrongDaily?: () => Promise<RsResult>;
  fetchMomentum?: () => Promise<RsResult>;
  language?: Language;
}

/**
 * Render a long/short candidate block (TradingView RS vs SPY data) under the
 * given title, with a closing note. Returns "" when there's nothing to show.
 */
function renderCandidateBlock(title: string, note: string, rs: RsResult | null): string {
  if (!rs || (rs.longs.length === 0 && rs.shorts.length === 0)) return "";
  const sign = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1);
  const line = (c: RsResult["longs"][number]) =>
    `${c.ticker}: ${c.close.toFixed(2)} (1M ${sign(c.perfM)}%, RS ${sign(c.rsM)}, 1W ${sign(c.perfW)}%, heute ${sign(c.changePct)}%)`;
  return [
    `## ${title}`,
    `Markt-Benchmark SPY 1M: ${sign(rs.spyPerfM)}%`,
    "Long:",
    ...rs.longs.map((c) => "  " + line(c)),
    "Short:",
    ...rs.shorts.map((c) => "  " + line(c)),
    "",
    note,
  ].join("\n");
}

const RS_TITLE = "Long-/Short-Kandidaten (relative Staerke vs. SPY, 1M, TradingView)";
const RS_NOTE =
  "Mechanische RS/RW-Kandidaten (Momentum relativ zum Markt) — KEIN Trade-Signal; pruefe Setup, Katalysator und Trend.";
const READY_TITLE = "Ready-to-Trend (relative Staerke + Konsolidierung, TradingView)";
const READY_NOTE =
  "Starke (1M) bzw. schwache Werte, die aktuell konsolidieren (ruhiger Tag/Woche) — moegliche Trend-Fortsetzung; KEIN Signal, Setup/Katalysator pruefen.";
const STRONG_TITLE = "Strong Daily (Trend-Qualitaet: Kurs ueber GD20/50/200 + RS, TradingView)";
const STRONG_NOTE =
  "Saubere Aufwaerts- (long) bzw. Abwaertstrends (short) — Kurs ueber/unter dem GD-Stapel 20/50/200 mit relativer Staerke; KEIN Signal, Setup/Katalysator pruefen.";
const MOMENTUM_TITLE = "Momentum (beschleunigende relative Staerke, TradingView)";
const MOMENTUM_NOTE =
  "Starker Monat UND starke Woche (frischer Schub) — moegliches fruehes Momentum; KEIN Signal, Setup/Katalysator pruefen.";

/** Fetch an optional candidate source, degrading a failure to null (logged). */
async function safeCandidates(
  label: string,
  fetch?: () => Promise<RsResult>,
): Promise<RsResult | null> {
  if (!fetch) return null;
  try {
    return await fetch();
  } catch (err) {
    console.error(`[scan] ${label} fetch failed, continuing without it: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
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

  const [rs, ready, strong, momentum] = await Promise.all([
    safeCandidates("RS candidates", deps.fetchRsLongShort),
    safeCandidates("ready-to-trend", deps.fetchReadyToTrend),
    safeCandidates("strong-daily", deps.fetchStrongDaily),
    safeCandidates("momentum", deps.fetchMomentum),
  ]);

  const payload = [
    buildTrendingClipboardPayload(combined),
    renderTrendBlock(combined, trend),
    renderCandidateBlock(RS_TITLE, RS_NOTE, rs),
    renderCandidateBlock(READY_TITLE, READY_NOTE, ready),
    renderCandidateBlock(STRONG_TITLE, STRONG_NOTE, strong),
    renderCandidateBlock(MOMENTUM_TITLE, MOMENTUM_NOTE, momentum),
    trendingDirective(deps.language ?? "de"),
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
