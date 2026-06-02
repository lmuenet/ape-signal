import type { TrendingRow, TrendingChallenge, Verdict } from "../core/ape-intel";

export interface ReportMeta {
  label: string; // e.g. "Morning" / "Pre-US"
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

/** Render a compact, mobile-friendly report. Plain text (no Markdown parse mode). */
export function formatReport(
  rows: TrendingRow[],
  challenge: TrendingChallenge,
  meta: ReportMeta,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`📊 Ape Signal — ${meta.label} scan (${date})`, ""];

  if (challenge.summary) {
    lines.push(challenge.summary, "");
  }

  const byTicker = new Map(rows.map((r) => [r.ticker, r]));

  if (challenge.verdicts.length === 0) {
    lines.push("(no challenge available — raw trending list)", "");
    for (const r of rows) {
      lines.push(`#${r.rank} ${r.ticker} — ${r.mentions} mentions ${trendArrow(r)}`);
    }
  } else {
    for (const v of challenge.verdicts) {
      const r = byTicker.get(v.ticker);
      const meta2 = r ? ` (#${r.rank}, ${r.mentions} ${trendArrow(r)})` : "";
      const thesis = v.thesis ? ` — ${v.thesis}` : "";
      lines.push(`${VERDICT_SYMBOL[v.verdict]} ${v.ticker}${meta2}${thesis}`);
      if (v.watch) lines.push(`   👁 watch: ${v.watch}`);
    }
  }

  lines.push("", "For personal research — not financial advice.");
  return lines.join("\n");
}
