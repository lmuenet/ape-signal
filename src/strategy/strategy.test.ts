import { describe, it, expect } from "vitest";
import { assembleStrategyInput, type StrategyDeps } from "./strategy";
import type { ApewisdomSnapshot, TradestieSnapshot } from "../core/ape-intel";

function deps(over: Partial<StrategyDeps> = {}): StrategyDeps {
  const ape: ApewisdomSnapshot = new Map([
    ["TSLA", { rank: 3, mentions: 120, mentions24hAgo: 90 }],
  ]);
  const td: TradestieSnapshot = new Map([
    ["TSLA", { comments: 50, sentimentLabel: "Bullish", sentimentScore: 0.4 }],
  ]);
  return {
    fetchApewisdom: async () => ape,
    fetchStockTwits: async () => ({ bullish: 30, bearish: 10, totalMessages: 60 }),
    fetchTradestie: async () => td,
    fetchNews: async () => [],
    fetchEarnings: async () => null,
    claudeRunner: async () => "",
    ...over,
  };
}

describe("assembleStrategyInput", () => {
  it("uppercases the ticker and pulls the matching per-source rows", async () => {
    const input = await assembleStrategyInput("tsla", deps());
    expect(input.ticker).toBe("TSLA");
    expect(input.apewisdom?.mentions).toBe(120);
    expect(input.stocktwits?.bullish).toBe(30);
    expect(input.aggregate?.barometer.label).not.toBe("unavailable");
  });

  it("tolerates a ticker missing from the snapshots (nulls, not throws)", async () => {
    const input = await assembleStrategyInput("NONE", deps());
    expect(input.apewisdom).toBeNull();
    expect(input.ticker).toBe("NONE");
  });
});

import { runStrategy, DEFAULT_PROFILE_EXPORT } from "./strategy";

describe("runStrategy", () => {
  it("builds the export prompt, runs claude, and parses the JSON block", async () => {
    let seenPrompt = "";
    const result = await runStrategy("tsla", { risk: "aggressive", horizon: "swing" }, deps({
      claudeRunner: async (p) => {
        seenPrompt = p;
        return 'My take...\n```json\n{"recommendation":"Small long","conviction":"low","direction":"long"}\n```';
      },
    }));
    expect(seenPrompt).toContain("Ape Intel Briefing — TSLA");
    expect(seenPrompt).toContain("aggressive");
    expect(result.strategy?.recommendation).toBe("Small long");
    expect(result.strategy?.direction).toBe("long");
  });

  it("returns strategy=null but keeps raw when no JSON block is present", async () => {
    const result = await runStrategy("tsla", DEFAULT_PROFILE_EXPORT, deps({
      claudeRunner: async () => "no json here",
    }));
    expect(result.strategy).toBeNull();
    expect(result.raw).toBe("no json here");
  });
});

import { formatStrategy } from "./strategy";

describe("formatStrategy", () => {
  it("renders the parsed strategy with a header and the disclaimer", () => {
    const text = formatStrategy("TSLA", { risk: "balanced", horizon: "swing" }, {
      recommendation: "Small speculative long",
      conviction: "medium",
      direction: "long",
      timeframe: "1-2 weeks",
      targetPrice: "260",
      stopLoss: "230",
      rationale: "momentum",
      risks: "earnings gap",
    }, "raw text");
    expect(text).toContain("TSLA");
    expect(text).toContain("Small speculative long");
    expect(text).toContain("medium");
    expect(text).toContain("not financial advice");
  });

  it("falls back to the raw claude output when parsing failed", () => {
    const text = formatStrategy("TSLA", { risk: "balanced", horizon: "swing" }, null, "free-form analysis");
    expect(text).toContain("free-form analysis");
    expect(text).toContain("TSLA");
  });
});
