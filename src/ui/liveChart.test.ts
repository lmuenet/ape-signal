import { describe, expect, it } from "vitest";
import { TV_EMBED_SRC, tvSymbol, tvWidgetConfig } from "./public/liveChart.js";

describe("tvSymbol", () => {
  it("upper-cases and trims a bare ticker", () => {
    expect(tvSymbol(" aapl ")).toBe("AAPL");
  });
  it("passes an exchange-qualified symbol through (upper-cased)", () => {
    expect(tvSymbol("nasdaq:aapl")).toBe("NASDAQ:AAPL");
  });
  it("degrades nullish input to an empty string", () => {
    expect(tvSymbol(undefined)).toBe("");
    expect(tvSymbol(null)).toBe("");
  });
});

describe("tvWidgetConfig", () => {
  it("builds a 1-minute dark candle config for the ticker", () => {
    const c = tvWidgetConfig("aapl");
    expect(c).toMatchObject({
      symbol: "AAPL",
      interval: "1",
      theme: "dark",
      style: "1",
      locale: "de",
      timezone: "Europe/Berlin",
      autosize: true,
    });
    // read-only: the depot UI must not let the embed change symbol or export
    expect(c.allow_symbol_change).toBe(false);
    expect(c.save_image).toBe(false);
  });

  it("exposes the official embed loader URL", () => {
    expect(TV_EMBED_SRC).toMatch(/^https:\/\/s3\.tradingview\.com\/.*embed-widget-advanced-chart\.js$/);
  });
});
