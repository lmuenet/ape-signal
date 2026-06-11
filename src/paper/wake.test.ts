import { describe, expect, it } from "vitest";
import { checkWakeBands, consumeBands, deriveBands, ensureBands } from "./wake";
import type { Portfolio, Position, QuoteMap } from "./types";

const pos = (over: Partial<Position> = {}): Position => ({
  id: "P1",
  ticker: "AAPL",
  side: "long",
  stake: 200,
  leverage: 2,
  entryPrice: 100,
  units: 4,
  stopLoss: 90,
  openedAt: "2026-06-11T14:00:00.000Z",
  thesis: "",
  ...over,
});

const quote = (close: number): QuoteMap[string] => ({ close, changePct: 0, high: close, low: close });

const portfolio = (positions: Position[]): Portfolio => ({
  balance: 1000,
  positions,
  orders: [],
  history: [],
});

describe("deriveBands", () => {
  it("long with TP: below = half way to stop, above = half way to TP", () => {
    const p = pos({ stopLoss: 90, takeProfit: 120 });
    expect(deriveBands(p, 100)).toEqual({ below: 95, above: 110 });
  });

  it("long without TP mirrors the stop distance upwards", () => {
    const p = pos({ stopLoss: 90, takeProfit: undefined });
    expect(deriveBands(p, 100)).toEqual({ below: 95, above: 105 });
  });

  it("short: above = half way to stop, below = half way to TP", () => {
    const p = pos({ side: "short", stopLoss: 110, takeProfit: 80 });
    expect(deriveBands(p, 100)).toEqual({ above: 105, below: 90 });
  });
});

describe("checkWakeBands", () => {
  it("reports a breach when close is at/above wakeAbove", () => {
    const p = pos({ wakeAbove: 110, wakeBelow: 95 });
    const breaches = checkWakeBands([p], { AAPL: quote(111) });
    expect(breaches).toEqual([{ positionId: "P1", ticker: "AAPL", side: "above", level: 110, price: 111 }]);
  });

  it("reports a breach when close is at/below wakeBelow", () => {
    const p = pos({ wakeAbove: 110, wakeBelow: 95 });
    expect(checkWakeBands([p], { AAPL: quote(94) })[0]?.side).toBe("below");
  });

  it("no breach inside the band, no breach without quote, no breach without band", () => {
    expect(checkWakeBands([pos({ wakeAbove: 110, wakeBelow: 95 })], { AAPL: quote(100) })).toEqual([]);
    expect(checkWakeBands([pos({ wakeAbove: 110, wakeBelow: 95 })], {})).toEqual([]);
    expect(checkWakeBands([pos()], { AAPL: quote(150) })).toEqual([]);
  });
});

describe("consumeBands", () => {
  it("clears both band sides of breached positions only", () => {
    const a = pos({ id: "P1", wakeAbove: 110, wakeBelow: 95 });
    const b = pos({ id: "P2", ticker: "TSLA", wakeAbove: 300, wakeBelow: 250 });
    const out = consumeBands(portfolio([a, b]), [
      { positionId: "P1", ticker: "AAPL", side: "above", level: 110, price: 111 },
    ]);
    expect(out.positions[0]).not.toHaveProperty("wakeAbove");
    expect(out.positions[0]).not.toHaveProperty("wakeBelow");
    expect(out.positions[1]?.wakeAbove).toBe(300);
  });
});

describe("ensureBands", () => {
  it("derives bands for positions without any, leaves existing bands alone", () => {
    const bare = pos({ id: "P1", stopLoss: 90, takeProfit: 120 });
    const set = pos({ id: "P2", ticker: "TSLA", wakeAbove: 300, wakeBelow: 250 });
    const { portfolio: out, changed } = ensureBands(portfolio([bare, set]), { AAPL: quote(100), TSLA: quote(280) });
    expect(changed).toBe(true);
    expect(out.positions[0]?.wakeBelow).toBe(95);
    expect(out.positions[0]?.wakeAbove).toBe(110);
    expect(out.positions[1]?.wakeAbove).toBe(300);
  });

  it("does nothing without quotes and reports changed=false", () => {
    const { changed } = ensureBands(portfolio([pos()]), {});
    expect(changed).toBe(false);
  });
});
