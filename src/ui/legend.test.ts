import { describe, expect, it } from "vitest";
import { distancePct, buildLegend } from "./public/legend.js";

const pos = {
  ticker: "GME", side: "long", leverage: 3, stake: 100,
  entryPrice: 24.1, stopLoss: 22.5, takeProfit: 28, wakeAbove: 26.5, wakeBelow: 23,
};

describe("distancePct", () => {
  it("computes a signed percent distance from price to threshold", () => {
    // (28 - 25.3) / 25.3 * 100 = 10.671...
    expect(distancePct(25.3, 28)).toBeCloseTo(10.6719, 3);
    expect(distancePct(25.3, 22.5)).toBeCloseTo(-11.067, 3);
  });
  it("returns null when price is missing, zero, or negative", () => {
    expect(distancePct(undefined, 28)).toBeNull();
    expect(distancePct(0, 28)).toBeNull();
    expect(distancePct(-5, 28)).toBeNull();
  });
  it("returns null when the threshold is missing", () => {
    expect(distancePct(25.3, undefined)).toBeNull();
  });
});

describe("buildLegend", () => {
  it("builds price + five rows in fixed order with pct on the thresholds", () => {
    const m = buildLegend(pos, 25.3);
    expect(m.price).toBe(25.3);
    expect(m.rows.map((r) => r.key)).toEqual(["entry", "tp", "wakeUp", "wakeDown", "sl"]);
    const tp = m.rows.find((r) => r.key === "tp");
    expect(tp).toMatchObject({ label: "TP", price: 28, tone: "pos" });
    expect(tp.pct).toBeCloseTo(10.6719, 3);
    // Entry is a reference point: shown without a pct.
    expect(m.rows.find((r) => r.key === "entry")).toMatchObject({ price: 24.1, pct: null, tone: "muted" });
  });

  it("uses null price and drops all pct when the current price is missing", () => {
    const m = buildLegend(pos, undefined);
    expect(m.price).toBeNull();
    for (const r of m.rows) expect(r.pct).toBeNull();
    // Threshold prices stay visible.
    expect(m.rows.find((r) => r.key === "sl").price).toBe(22.5);
  });

  it("shows null price and null pct for unset thresholds (no TP, no wake bands)", () => {
    const bare = { ...pos, takeProfit: undefined, wakeAbove: undefined, wakeBelow: undefined };
    const m = buildLegend(bare, 25.3);
    expect(m.rows.find((r) => r.key === "tp")).toMatchObject({ price: null, pct: null });
    expect(m.rows.find((r) => r.key === "wakeUp")).toMatchObject({ price: null, pct: null });
  });

  it("computes the same positional pct for short positions", () => {
    const short = { ...pos, side: "short" };
    expect(buildLegend(short, 25.3).rows.find((r) => r.key === "tp").pct).toBeCloseTo(10.6719, 3);
  });
});
