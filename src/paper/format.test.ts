import { describe, expect, it } from "vitest";
import { describeAdjustment, formatDailySummary, formatManagerNote, renderPortfolio } from "./format";
import type { Adjustment, Portfolio, Position, QuoteMap, TickEvent } from "./types";

const pos: Position = {
  id: "P1", ticker: "AAPL", side: "long", stake: 200, leverage: 2,
  entryPrice: 100, units: 4, stopLoss: 90, takeProfit: 120,
  wakeAbove: 110, wakeBelow: 95,
  openedAt: "2026-06-11T14:00:00.000Z", thesis: "",
};
const quotes: QuoteMap = { AAPL: { close: 105, changePct: 1, high: 106, low: 99 } };
const p: Portfolio = { balance: 800, positions: [pos], orders: [], history: [] };

describe("renderPortfolio", () => {
  it("shows the wake band on the position line", () => {
    expect(renderPortfolio(p, quotes)).toContain("Wake 95/110");
  });
});

describe("describeAdjustment", () => {
  it("describes set_wake_band including cleared sides", () => {
    const adj: Adjustment = { type: "set_wake_band", positionId: "P1", above: 112, below: null };
    expect(describeAdjustment(adj)).toBe("Wake-Band von P1: oben 112, unten —");
  });
});

describe("formatManagerNote", () => {
  const applied: Adjustment[] = [{ type: "set_stop", positionId: "P1", price: 98 }];
  const rejected = [{ adjustment: { type: "set_take_profit", positionId: "P1", price: 90 } as Adjustment, reason: "falsche Seite" }];

  it("bundles journal, applied, rejected and close events into one message", () => {
    const closeEvent: TickEvent = {
      kind: "position-closed",
      trade: {
        id: "P2", ticker: "TSLA", side: "long", stake: 100, leverage: 1,
        entryPrice: 200, exitPrice: 210, pnl: 5, reason: "manual",
        openedAt: "2026-06-10T14:00:00.000Z", closedAt: "2026-06-11T15:00:00.000Z",
      },
    };
    const msg = formatManagerNote("15:35", "Stop nachgezogen, Trend intakt.", applied, rejected, [closeEvent]);
    expect(msg).toContain("Mr Ape — Manager-Tick 15:35");
    expect(msg).toContain("Stop nachgezogen");
    expect(msg).toContain("🔧 Stop von P1 auf 98");
    expect(msg).toContain("✗ abgelehnt (falsche Seite)");
    expect(msg).toContain("TSLA");
  });

  it('returns "" when there is nothing to say', () => {
    expect(formatManagerNote("15:35", "", [], [], [])).toBe("");
  });
});

describe("formatDailySummary extras (Lebenszeichen spec)", () => {
  const empty: Portfolio = { balance: 800, positions: [], orders: [], history: [] };

  it("marks stale quotes and appends the health line when given", () => {
    const s = formatDailySummary(empty, {}, "2026-06-12", {
      staleQuotesFrom: "15:30",
      healthLine: "Monitor: 5 Ticks ok, 3 Quote-Fehler",
    });
    expect(s).toContain("(Kurse von 15:30)");
    expect(s.trimEnd().endsWith("Monitor: 5 Ticks ok, 3 Quote-Fehler")).toBe(true);
  });

  it("stays identical to the old output without opts", () => {
    const s = formatDailySummary(empty, {}, "2026-06-12");
    expect(s).not.toContain("Kurse von");
    expect(s).not.toContain("Monitor:");
  });
});
