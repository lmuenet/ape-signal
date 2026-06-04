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

describe("formatStrategy (HTML card)", () => {
  const QUOTE = { current: 198.1, changePct: -1.22, high: 199.04, low: 183.8, open: 195, prevClose: 200.76 };

  it("puts short decision fields + the live price in a monospace box, long fields as flowing text", () => {
    const text = formatStrategy(
      "GLW",
      { risk: "balanced", horizon: "swing" },
      {
        recommendation: "Stay out — kein belastbarer Edge",
        conviction: "low",
        direction: "stay-out",
        timeframe: "Beobachten; Neubewertung in 1-2 Wochen nach sauberer Kursbestaetigung ueber 205",
        targetPrice: "Kein Long-Ziel ohne Einstieg; Watch: ueber 205 dann 215-220 (setup-abhaengig)",
        stopLoss: "< 183",
        rationale: "Es gibt keinen handelbaren Edge.",
        risks: "Auf fehlerhaften Daten zu handeln.",
      },
      "raw",
      QUOTE,
    );
    // monospace box holds the at-a-glance short fields
    expect(text).toContain("<pre>");
    expect(text).toContain("Direction");
    expect(text).toContain("stay-out");
    expect(text).toContain("Conviction");
    expect(text).toContain("Kurs");
    expect(text).toContain("198.10");
    expect(text).toContain("-1.22%");
    // a short stop lands in the box, HTML-escaped
    expect(text).toContain("&lt; 183");
    // long timeframe/target do NOT fit the box → flowing with bold headers
    expect(text).toContain("<b>Empfehlung</b>");
    expect(text).toContain("<b>Horizont</b>");
    expect(text).toContain("<b>Ziel</b>");
    expect(text).toContain("<b>Begründung</b>");
    expect(text).toContain("<b>Risiken</b>");
    expect(text).toContain("not financial advice");
  });

  it("HTML-escapes <, > and & so Claude's >205 / <183 never break Telegram HTML", () => {
    const text = formatStrategy(
      "X",
      { risk: "balanced", horizon: "swing" },
      { recommendation: "a & b", conviction: "low", direction: "long", rationale: "buy >205, stop <183 & hold" },
      "raw",
      null,
    );
    expect(text).toContain("&amp;");
    expect(text).toContain("&gt;205");
    expect(text).toContain("&lt;183");
    expect(text).not.toContain(">205"); // no raw, unescaped angle bracket
  });

  it("omits the Kurs row when no live quote is available", () => {
    const text = formatStrategy(
      "X",
      { risk: "balanced", horizon: "swing" },
      { recommendation: "x", conviction: "low", direction: "long" },
      "raw",
      null,
    );
    expect(text).not.toContain("Kurs");
  });

  it("falls back to escaped raw output (still HTML-safe) when parsing failed", () => {
    const text = formatStrategy(
      "TSLA",
      { risk: "balanced", horizon: "swing" },
      null,
      "free <b>form</b> >5",
      null,
    );
    expect(text).toContain("free &lt;b&gt;form");
    expect(text).toContain("TSLA");
    expect(text).toContain("not financial advice");
  });
});
