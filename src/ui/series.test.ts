import { describe, expect, it } from "vitest";
import { dailyPerformance, equitySeries } from "./series";
import type { ClosedTrade, Portfolio } from "../paper/types";

const trade = (over: Partial<ClosedTrade>): ClosedTrade => ({
  id: "T", ticker: "AAPL", side: "long", stake: 100, leverage: 1,
  entryPrice: 100, exitPrice: 110, pnl: 10, fees: 1, reason: "manual",
  openedAt: "2026-06-09T14:00:00.000Z", closedAt: "2026-06-10T15:00:00.000Z",
  ...over,
});

describe("equitySeries", () => {
  it("builds a realized-equity curve: start balance, then one point per close", () => {
    const p: Portfolio = {
      balance: 0, positions: [], orders: [],
      history: [
        trade({ id: "B", closedAt: "2026-06-11T15:00:00.000Z", pnl: -20, fees: 0 }),
        trade({ id: "A", closedAt: "2026-06-10T15:00:00.000Z", pnl: 10, fees: 1 }),
      ],
    };
    expect(equitySeries(p, 2000)).toEqual([
      { at: "2026-06-09T14:00:00.000Z", equity: 2000 },
      { at: "2026-06-10T15:00:00.000Z", equity: 2009 },
      { at: "2026-06-11T15:00:00.000Z", equity: 1989 },
    ]);
  });

  it("returns just the start point when there is no history", () => {
    const p: Portfolio = { balance: 2000, positions: [], orders: [], history: [] };
    const s = equitySeries(p, 2000);
    expect(s).toHaveLength(1);
    expect(s[0]?.equity).toBe(2000);
  });
});

describe("dailyPerformance", () => {
  it("aggregates closed trades per Berlin day with running cumulative + return", () => {
    const p: Portfolio = {
      balance: 0, positions: [], orders: [],
      history: [
        trade({ id: "B", closedAt: "2026-06-11T15:00:00.000Z", pnl: -20, fees: 0 }),
        trade({ id: "A", closedAt: "2026-06-10T15:00:00.000Z", pnl: 10, fees: 1 }),
      ],
    };
    const rows = dailyPerformance(p, 2000);
    // returnPct carries raw float precision (the UI rounds on display) — assert it separately.
    expect(rows.map(({ returnPct, ...rest }) => rest)).toEqual([
      { day: "2026-06-10", equity: 2009, realizedPnl: 9, trades: 1, cumulativePnl: 9 },
      { day: "2026-06-11", equity: 1989, realizedPnl: -20, trades: 1, cumulativePnl: -11 },
    ]);
    expect(rows[0]?.returnPct).toBeCloseTo(0.45, 10);
    expect(rows[1]?.returnPct).toBeCloseTo(-0.55, 10);
  });

  it("sums multiple trades that close on the same Berlin day into one row", () => {
    const p: Portfolio = {
      balance: 0, positions: [], orders: [],
      history: [
        trade({ id: "X", closedAt: "2026-06-10T14:00:00.000Z", pnl: 30, fees: 0 }),
        trade({ id: "Y", closedAt: "2026-06-10T20:00:00.000Z", pnl: -5, fees: 0 }),
      ],
    };
    const rows = dailyPerformance(p, 2000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: "2026-06-10", trades: 2, realizedPnl: 25, equity: 2025 });
  });

  it("returns an empty list when there is no history", () => {
    expect(dailyPerformance({ balance: 2000, positions: [], orders: [], history: [] }, 2000)).toEqual([]);
  });
});
