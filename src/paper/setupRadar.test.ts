import { describe, expect, it } from "vitest";
import { detectSetups, setupLabel } from "./setupRadar";
import { OPPORTUNISM, type QuoteMap, type TickQuote, type WatchlistEntry } from "./types";

const tq = (over: Partial<TickQuote> = {}): TickQuote => ({ close: 100, changePct: 0, high: 101, low: 99, ...over });
const entry = (over: Partial<WatchlistEntry> = {}): WatchlistEntry => ({
  ticker: "AAPL", note: "Earnings-Momentum", addedDay: "2026-06-09", firedKinds: [], ...over,
});

describe("detectSetups — EMA cross", () => {
  it("fires ema-cross-up when EMA10 crosses above EMA20", () => {
    const prev: QuoteMap = { AAPL: tq({ ema10: 99, ema20: 100 }) };
    // low above the EMA20 so the pullback-touch trigger stays out of this test
    const now: QuoteMap = { AAPL: tq({ close: 105, high: 106, low: 101, ema10: 101, ema20: 100 }) };
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

describe("detectSetups — Radar-Ausbau (Beschluss 2026-07-02)", () => {
  it("fires ema20-pullback-long when the day low touches the EMA20 in an uptrend", () => {
    const prev: QuoteMap = { AAPL: tq({ ema10: 103, ema20: 100 }) };
    const now: QuoteMap = { AAPL: tq({ close: 102, high: 104, low: 99.5, ema10: 103, ema20: 100 }) };
    const kinds = detectSetups([entry()], now, prev).map((t) => t.kind);
    expect(kinds).toEqual(["ema20-pullback-long"]);
  });

  it("fires the short mirror when the day high touches the EMA20 in a downtrend", () => {
    const prev: QuoteMap = { AAPL: tq({ ema10: 97, ema20: 100 }) };
    const now: QuoteMap = { AAPL: tq({ close: 98, high: 100.5, low: 96, ema10: 97, ema20: 100 }) };
    expect(detectSetups([entry()], now, prev)[0]?.kind).toBe("ema20-pullback-short");
  });

  it("fires ema50-reclaim / ema50-loss on a close crossing the EMA50", () => {
    const prev: QuoteMap = { AAPL: tq({ close: 98, ema50: 100 }) };
    const now: QuoteMap = { AAPL: tq({ close: 101, high: 102, low: 97, ema50: 100 }) };
    expect(detectSetups([entry()], now, prev)[0]?.kind).toBe("ema50-reclaim");
    const prevAbove: QuoteMap = { AAPL: tq({ close: 101, ema50: 100 }) };
    const nowBelow: QuoteMap = { AAPL: tq({ close: 99, high: 102, low: 97, ema50: 100 }) };
    expect(detectSetups([entry()], nowBelow, prevAbove)[0]?.kind).toBe("ema50-loss");
  });

  it("fires high52w-breakout only on a real crossing of the PREVIOUS snapshot's high", () => {
    const prev: QuoteMap = { AAPL: tq({ close: 98, high52w: 100 }) };
    const now: QuoteMap = { AAPL: tq({ close: 101, high: 102, low: 97, high52w: 101 }) };
    expect(detectSetups([entry()], now, prev)[0]?.kind).toBe("high52w-breakout");
    // already at the high before → no crossing, no signal
    const atHigh: QuoteMap = { AAPL: tq({ close: 100, high52w: 100 }) };
    expect(detectSetups([entry()], now, atHigh)).toHaveLength(0);
  });

  it("fires volume-spike when volume/avg10d crosses the factor upwards — never without data", () => {
    const prev: QuoteMap = { AAPL: tq({ volume: 150, avgVolume10d: 100 }) };
    const now: QuoteMap = { AAPL: tq({ volume: 250, avgVolume10d: 100 }) };
    expect(detectSetups([entry()], now, prev)[0]?.kind).toBe("volume-spike");
    expect(detectSetups([entry()], now, { AAPL: tq() })).toHaveLength(0); // no prev volume → silent
    expect(detectSetups([entry()], now, prev, { ...OPPORTUNISM, volumeSpikeFactor: 3 })).toHaveLength(0);
  });
});

describe("setupLabel", () => {
  it("gives a human label per kind", () => {
    expect(setupLabel("rsi-overbought")).toContain("überkauft");
  });
});

describe("OPPORTUNISM thresholds (centralised — Stufe 3 Feinschliff)", () => {
  // Smoke only: the label echoes the CURRENT threshold value. This cannot prove
  // the label is DERIVED from the constant (a hardcoded "RSI ≥ 70" would pass too
  // while the default is 70). The real wiring is proved by the teeth-tests below,
  // which pass NON-default thresholds and assert the behaviour changes.
  it("surfaces the configured RSI thresholds in the labels", () => {
    expect(setupLabel("rsi-overbought")).toContain(String(OPPORTUNISM.rsiOverbought));
    expect(setupLabel("rsi-oversold")).toContain(String(OPPORTUNISM.rsiOversold));
  });

  it("honours a stricter RSI threshold passed in — proves rsiExtreme reads the constant, not a literal", () => {
    const prev: QuoteMap = { AAPL: tq({ rsi: 69 }) };
    const now: QuoteMap = { AAPL: tq({ rsi: 73 }) };
    expect(detectSetups([entry()], now, prev)[0]?.kind).toBe("rsi-overbought"); // default 70 → 69→73 crosses
    expect(detectSetups([entry()], now, prev, { ...OPPORTUNISM, rsiOverbought: 75 })).toHaveLength(0); // 75 → not yet
  });

  it("honours an EMA-cross minimum gap; default 0 = today's exact sign change", () => {
    const prev: QuoteMap = { AAPL: tq({ ema10: 100, ema20: 100 }) };
    const small: QuoteMap = { AAPL: tq({ ema10: 100.3, ema20: 100 }) };
    expect(detectSetups([entry()], small, prev)[0]?.kind).toBe("ema-cross-up"); // gap 0 → any positive cross fires
    expect(detectSetups([entry()], small, prev, { ...OPPORTUNISM, emaCrossMinGap: 0.5 })).toHaveLength(0); // 0.3 < 0.5
    const wide: QuoteMap = { AAPL: tq({ ema10: 100.8, ema20: 100 }) };
    expect(detectSetups([entry()], wide, prev, { ...OPPORTUNISM, emaCrossMinGap: 0.5 })[0]?.kind).toBe("ema-cross-up");
  });
});
