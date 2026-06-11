import { describe, expect, it } from "vitest";
import { equitySeries } from "./series";
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
