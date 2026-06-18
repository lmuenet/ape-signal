import { describe, expect, it } from "vitest";
import { detectSetups, setupLabel } from "./setupRadar";
import type { QuoteMap, TickQuote, WatchlistEntry } from "./types";

const tq = (over: Partial<TickQuote> = {}): TickQuote => ({ close: 100, changePct: 0, high: 101, low: 99, ...over });
const entry = (over: Partial<WatchlistEntry> = {}): WatchlistEntry => ({
  ticker: "AAPL", note: "Earnings-Momentum", addedDay: "2026-06-09", firedKinds: [], ...over,
});

describe("detectSetups — EMA cross", () => {
  it("fires ema-cross-up when EMA10 crosses above EMA20", () => {
    const prev: QuoteMap = { AAPL: tq({ ema10: 99, ema20: 100 }) };
    const now: QuoteMap = { AAPL: tq({ close: 105, ema10: 101, ema20: 100 }) };
    const t = detectSetups([entry()], now, prev);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ ticker: "AAPL", kind: "ema-cross-up", price: 105 });
    expect(t[0].note).toContain("EMA10×EMA20 ↑");
  });

  it("fires ema-cross-down on the mirror", () => {
    const prev: QuoteMap = { AAPL: tq({ ema10: 101, ema20: 100 }) };
    const now: QuoteMap = { AAPL: tq({ ema10: 99, ema20: 100 }) };
    expect(detectSetups([entry()], now, prev)[0]?.kind).toBe("ema-cross-down");
  });

  it("does not fire without a real crossing (stack unchanged)", () => {
    const prev: QuoteMap = { AAPL: tq({ ema10: 102, ema20: 100 }) };
    const now: QuoteMap = { AAPL: tq({ ema10: 103, ema20: 100 }) };
    expect(detectSetups([entry()], now, prev)).toHaveLength(0);
  });

  it("stays silent on a degraded snapshot (EMA missing)", () => {
    const prev: QuoteMap = { AAPL: tq({ ema10: 99 }) }; // no ema20
    const now: QuoteMap = { AAPL: tq({ ema10: 101, ema20: 100 }) };
    expect(detectSetups([entry()], now, prev)).toHaveLength(0);
  });
});

describe("detectSetups — RSI extremes", () => {
  it("fires rsi-overbought when RSI crosses 70 upward", () => {
    const prev: QuoteMap = { AAPL: tq({ rsi: 68 }) };
    const now: QuoteMap = { AAPL: tq({ rsi: 72 }) };
    const t = detectSetups([entry()], now, prev);
    expect(t[0]?.kind).toBe("rsi-overbought");
    expect(t[0]?.note).toContain("RSI 72");
  });

  it("fires rsi-oversold when RSI crosses 30 downward", () => {
    const prev: QuoteMap = { AAPL: tq({ rsi: 33 }) };
    const now: QuoteMap = { AAPL: tq({ rsi: 28 }) };
    expect(detectSetups([entry()], now, prev)[0]?.kind).toBe("rsi-oversold");
  });
});

describe("detectSetups — gating", () => {
  it("skips a kind already fired today and a ticker without a previous quote", () => {
    const prev: QuoteMap = { AAPL: tq({ ema10: 99, ema20: 100 }) };
    const now: QuoteMap = { AAPL: tq({ ema10: 101, ema20: 100 }) };
    expect(detectSetups([entry({ firedKinds: ["ema-cross-up"] })], now, prev)).toHaveLength(0);
    expect(detectSetups([entry()], now, {})).toHaveLength(0); // no prev
  });

  it("returns one trigger per fired kind when several fire at once", () => {
    const prev: QuoteMap = { AAPL: tq({ ema10: 99, ema20: 100, rsi: 33 }) };
    const now: QuoteMap = { AAPL: tq({ ema10: 101, ema20: 100, rsi: 28 }) };
    const kinds = detectSetups([entry()], now, prev).map((t) => t.kind);
    expect(kinds).toEqual(["ema-cross-up", "rsi-oversold"]);
  });
});

describe("setupLabel", () => {
  it("gives a human label per kind", () => {
    expect(setupLabel("rsi-overbought")).toContain("überkauft");
  });
});
