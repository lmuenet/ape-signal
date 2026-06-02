import { describe, it, expect, vi } from "vitest";
import { runScan } from "./pipeline";
import type { ApewisdomSnapshot } from "../core/ape-intel";

function fakeSnapshot(): ApewisdomSnapshot {
  return new Map([
    ["GME", { rank: 1, mentions: 500, mentions24hAgo: 600 }],
    ["TSLA", { rank: 2, mentions: 300, mentions24hAgo: 100 }],
  ]);
}

describe("runScan", () => {
  it("fetches, challenges via claude, and sends the formatted report", async () => {
    const fetchSnapshot = vi.fn(async () => fakeSnapshot());
    const claudeRunner = vi.fn(async () =>
      '```json\n{"summary":"ok","verdicts":[{"ticker":"TSLA","verdict":"signal","thesis":"beat"}]}\n```',
    );
    const send = vi.fn(async () => {});

    const result = await runScan(
      { label: "Morning", limit: 10 },
      { fetchSnapshot, claudeRunner, send },
    );

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    // the prompt handed to claude must contain the export prompt + the tickers
    const prompt = claudeRunner.mock.calls[0][0] as string;
    expect(prompt).toContain("signal");
    expect(prompt).toContain("TSLA");
    // the sent message reflects the parsed verdict
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("✅ TSLA");
    expect(result.verdicts).toHaveLength(1);
  });

  it("still sends a report (raw list) when claude output cannot be parsed", async () => {
    const fetchSnapshot = vi.fn(async () => fakeSnapshot());
    const claudeRunner = vi.fn(async () => "sorry, no json here");
    const send = vi.fn(async () => {});

    await runScan({ label: "Morning", limit: 10 }, { fetchSnapshot, claudeRunner, send });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("GME"); // raw fallback list
  });
});
