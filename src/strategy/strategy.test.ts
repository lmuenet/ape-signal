import { describe, it, expect } from "vitest";
import { assembleStrategyInput, runStrategy, type StrategyDeps } from "./strategy";
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
    fetchQuote: async () => ({ current: 1234.5, changePct: 1.65, high: 1240, low: 1210, open: 1215, prevClose: 1214.5 }),
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

  it("survives a throwing source (e.g. StockTwits 403 from a blocked IP) and still uses the rest", async () => {
    const input = await assembleStrategyInput("tsla", deps({
      fetchStockTwits: async () => {
        throw new Error("StockTwits returned 403");
      },
    }));
    // StockTwits degraded to null, but the briefing still assembled...
    expect(input.stocktwits).toBeNull();
    expect(input.ticker).toBe("TSLA");
    // ...and the barometer still computed from the surviving Tradestie source.
    expect(input.apewisdom?.mentions).toBe(120);
    expect(input.aggregate?.barometer.label).not.toBe("unavailable");
  });

  it("still returns a usable input even if EVERY source throws", async () => {
    const boom = async () => {
      throw new Error("blocked");
    };
    const input = await assembleStrategyInput("tsla", {
      fetchApewisdom: boom,
      fetchStockTwits: boom,
      fetchTradestie: boom,
      fetchNews: boom,
      fetchEarnings: boom,
      fetchQuote: async () => null, // not exercised here: assembleStrategyInput never calls fetchQuote; present only to satisfy the StrategyDeps type
      claudeRunner: async () => "",
    });
    expect(input.ticker).toBe("TSLA");
    expect(input.apewisdom).toBeNull();
    expect(input.stocktwits).toBeNull();
    expect(input.news).toEqual([]);
    expect(input.earnings).toBeNull();
  });
});

import { DEFAULT_PROFILE_EXPORT } from "./strategy";

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

describe("runStrategy price + language", () => {
  it("includes a live-price block plus German + headless directives in the prompt", async () => {
    let seen = "";
    await runStrategy("avgo", { risk: "balanced", horizon: "swing" }, deps({
      claudeRunner: async (p) => { seen = p; return ""; },
    }));
    expect(seen).toContain("Aktueller Kurs");
    expect(seen).toContain("1234.50");
    expect(seen).toContain("DEUTSCH");
    expect(seen).toContain("KEINE Tools");
  });

  it("notes 'Kein Live-Kurs' when the quote source fails", async () => {
    let seen = "";
    await runStrategy("avgo", { risk: "balanced", horizon: "swing" }, deps({
      fetchQuote: async () => { throw new Error("Finnhub quote returned 429"); },
      claudeRunner: async (p) => { seen = p; return ""; },
    }));
    expect(seen).toContain("Kein Live-Kurs");
  });
});

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
