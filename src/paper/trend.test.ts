import { describe, expect, it } from "vitest";
import { formatTech, trendLabel, trendTag } from "./trend";

describe("trendTag", () => {
  it("is up when close and EMA10 are above EMA20", () => {
    expect(trendTag({ close: 110, ema10: 108, ema20: 105 })).toBe("up");
  });

  it("is down when close and EMA10 are below EMA20", () => {
    expect(trendTag({ close: 98, ema10: 99, ema20: 102 })).toBe("down");
  });

  it("is flat when close sits above EMA20 but the EMA10/20 stack disagrees", () => {
    expect(trendTag({ close: 106, ema10: 104, ema20: 105 })).toBe("flat");
  });

  it("works with EMA20 alone (no EMA10)", () => {
    expect(trendTag({ close: 110, ema20: 105 })).toBe("up");
    expect(trendTag({ close: 100, ema20: 105 })).toBe("down");
  });

  it("is unknown without EMA20 (degraded scanner)", () => {
    expect(trendTag({ close: 110 })).toBe("unknown");
  });
});

describe("trendLabel", () => {
  it("renders an arrow + word, empty for unknown", () => {
    expect(trendLabel("up")).toBe("↑ Aufwärts");
    expect(trendLabel("down")).toBe("↓ Abwärts");
    expect(trendLabel("flat")).toBe("→ seitwärts");
    expect(trendLabel("unknown")).toBe("");
  });
});

describe("formatTech", () => {
  it("renders EMA, RSI and the trend label", () => {
    const tech = formatTech({ close: 110, ema10: 108, ema20: 105, ema50: 100, rsi: 62.4 });
    expect(tech).toBe(" · EMA10 108 EMA20 105 EMA50 100 · RSI 62 · ↑ Aufwärts");
  });

  it("is empty when the scanner gave no EMA (no false signal)", () => {
    expect(formatTech({ close: 110 })).toBe("");
  });

  it("rounds EMA to 2 decimals and RSI to an integer", () => {
    expect(formatTech({ close: 110, ema20: 105.123, rsi: 49.7 })).toContain("EMA20 105.12");
    expect(formatTech({ close: 110, ema20: 105.123, rsi: 49.7 })).toContain("RSI 50");
  });
});
