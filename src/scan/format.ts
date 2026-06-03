// src/scan/format.ts
import type { TrendingRow, TrendingChallenge, TickerVerdict, Verdict } from "../core/ape-intel";
import type { EarningsRow } from "./earnings";

export interface ReportMeta {
  label: string; // e.g. "Morning" / "Pre-US"
  offRadarTickers?: string[]; // reddit-origin tickers to break out into their own section
  earningsToday?: EarningsRow[];
}

const VERDICT_SYMBOL: Record<Verdict, string> = {
  signal: "✅",
  watch: "👀",
  noise: "🚫",
};

function trendArrow(row: TrendingRow): string {
  if (row.mentions > row.mentions24hAgo) return "↑";
  if (row.mentions < row.mentions24hAgo) return "↓";
  return "→";
}

function verdictLine(v: TickerVerdict, byTicker: Map<string, TrendingRow>): string[] {
  const r = byTicker.get(v.ticker);
  const meta = r ? ` (#${r.rank}, ${r.mentions} ${trendArrow(r)})` : "";
  const thesis = v.thesis ? ` — ${v.thesis}` : "";
  const lines = [`${VERDICT_SYMBOL[v.verdict]} ${v.ticker}${meta}${thesis}`];
  if (v.watch) lines.push(`   👁 watch: ${v.watch}`);
  lines.push("");
  return lines;
}

/** Render a compact, mobile-friendly report. Plain text (no Markdown parse mode). */
export function formatReport(
  rows: TrendingRow[],
  challenge: TrendingChallenge,
  meta: ReportMeta,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`📊 Ape Signal — ${meta.label} scan (${date})`, ""];
  if (challenge.summary) lines.push(challenge.summary, "");

  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  const offSet = new Set(meta.offRadarTickers ?? []);

  if (challenge.verdicts.length === 0) {
    lines.push("(no challenge available — raw trending list)", "");
    for (const r of rows) {
      lines.push(`#${r.rank} ${r.ticker} — ${r.mentions} mentions ${trendArrow(r)}`);
    }
    lines.push("");
  } else {
    const main = challenge.verdicts.filter((v) => !offSet.has(v.ticker));
    const off = challenge.verdicts.filter((v) => offSet.has(v.ticker));
    for (const v of main) lines.push(...verdictLine(v, byTicker));
    if (off.length > 0) {
      lines.push("🔥 Reddit Off-Radar (not in trending list)", "");
      for (const v of off) lines.push(...verdictLine(v, byTicker));
    }
  }

  if (meta.earningsToday && meta.earningsToday.length > 0) {
    lines.push("📅 Earnings today", "");
    for (const e of meta.earningsToday) {
      const eps = e.epsEstimate === null ? "" : ` (est EPS ${e.epsEstimate})`;
      lines.push(`• ${e.ticker}${eps}`);
    }
    lines.push("");
  }

  lines.push("For personal research — not financial advice.");
  return lines.join("\n");
}
