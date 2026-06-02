import { describe, it, expect } from "vitest";
import { formatReport } from "./format";
import type { TrendingRow, TrendingChallenge } from "../core/ape-intel";

const rows: TrendingRow[] = [
  { ticker: "GME", rank: 1, mentions: 500, mentions24hAgo: 600 },
  { ticker: "TSLA", rank: 2, mentions: 300, mentions24hAgo: 100 },
];

const challenge: TrendingChallenge = {
  summary: "Mostly noise today.",
  verdicts: [
    { ticker: "GME", verdict: "noise", thesis: "stale meme pump" },
    { ticker: "TSLA", verdict: "signal", thesis: "real delivery beat", watch: "guidance call" },
  ],
};

describe("formatReport", () => {
  it("includes a title, the summary and one line per verdict", () => {
    const out = formatReport(rows, challenge, { label: "Morning" });
    expect(out).toContain("Morning");
    expect(out).toContain("Mostly noise today.");
    expect(out).toContain("GME");
    expect(out).toContain("stale meme pump");
    expect(out).toContain("TSLA");
    expect(out).toContain("real delivery beat");
  });

  it("marks verdicts with distinct symbols and notes a not-financial-advice footer", () => {
    const out = formatReport(rows, challenge, { label: "Pre-US" });
    expect(out).toContain("🚫"); // noise
    expect(out).toContain("✅"); // signal
    expect(out).toContain("guidance call"); // watch field rendered
    expect(out.toLowerCase()).toContain("not financial advice");
  });

  it("falls back to the trending list when there are no verdicts", () => {
    const out = formatReport(rows, { summary: "", verdicts: [] }, { label: "Morning" });
    expect(out).toContain("GME");
    expect(out).toContain("TSLA");
    expect(out).toContain("no challenge");
  });
});
