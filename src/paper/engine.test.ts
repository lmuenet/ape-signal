import { describe, expect, it } from "vitest";
import {
  adminAdjust,
  applyAdjustments,
  applyTick,
  equity,
  liquidationPrice,
  placeOrders,
  positionPnl,
  tradesPlacedToday,
} from "./engine";
import { freshPortfolio, type EntryOrder, type Portfolio, type Position, type QuoteMap } from "./types";

const NOW = "2026-06-09T15:30:00.000Z";
const DAY = "2026-06-09";

const q = (close: number, high: number, low: number): QuoteMap[string] => ({
  close,
  changePct: 0,
  high,
  low,
});

function order(over: Partial<EntryOrder> = {}): EntryOrder {
  return {
    id: "NVDA-2026-06-09-1",
    ticker: "NVDA",
    side: "long",
    stake: 200,
    leverage: 3,
    entryType: "limit",
    limitPrice: 100,
    stopLoss: 95,
    takeProfit: 120,
    thesis: "test",
    createdAt: NOW,
    day: DAY,
    ...over,
  };
}

function position(over: Partial<Position> = {}): Position {
  return {
    id: "NVDA-2026-06-09-1",
    ticker: "NVDA",
    side: "long",
    stake: 200,
    leverage: 3,
    entryPrice: 100,
    units: 6, // 200*3/100
    stopLoss: 95,
    takeProfit: 120,
    openedAt: "2026-06-08T15:30:00.000Z",
    thesis: "test",
    ...over,
  };
}

function withLastTick(p: Portfolio, quotes: QuoteMap, day = DAY): Portfolio {
  return { ...p, lastTick: { at: NOW, day, quotes } };
}

describe("positionPnl", () => {
  it("computes leveraged long P&L", () => {
    expect(positionPnl(position(), 110)).toBeCloseTo(60); // 6 units × +10
  });

  it("computes short P&L and caps the loss at the stake", () => {
    const shortPos = position({ side: "short" });
    expect(positionPnl(shortPos, 90)).toBeCloseTo(60);
    expect(positionPnl(shortPos, 200)).toBe(-200); // raw -600, capped at -stake
  });
});

describe("equity", () => {
  it("sums free cash, reserved order stakes and position value", () => {
    const p: Portfolio = {
      ...freshPortfolio(600),
      orders: [order({ stake: 200 })],
      positions: [position({ stake: 200 })],
    };
    expect(equity(p, { NVDA: q(110, 111, 99) })).toBeCloseTo(600 + 200 + 200 + 60);
    // Without a quote the position counts at its margin.
    expect(equity(p, {})).toBeCloseTo(1000);
  });
});

describe("applyTick — entry orders", () => {
  it("fills a market order at the tick close", () => {
    const p: Portfolio = { ...freshPortfolio(800), orders: [order({ entryType: "market", limitPrice: undefined })] };
    const { portfolio, events } = applyTick(p, { NVDA: q(101, 102, 100) }, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("entry-filled");
    expect(portfolio.positions[0].entryPrice).toBe(101);
    expect(portfolio.positions[0].units).toBeCloseTo(600 / 101);
    expect(portfolio.orders).toHaveLength(0);
    expect(portfolio.balance).toBe(800); // stake was already reserved
  });

  it("fills a limit order on first-tick day-low evidence at the limit price", () => {
    const p: Portfolio = { ...freshPortfolio(800), orders: [order()] };
    const { portfolio, events } = applyTick(p, { NVDA: q(102, 103, 99.5) }, { now: NOW, day: DAY, isClose: false });
    expect(events[0].kind).toBe("entry-filled");
    expect(portfolio.positions[0].entryPrice).toBe(100); // limit, not close
  });

  it("does not fill a limit order without touch evidence", () => {
    const prev = { NVDA: q(102, 103, 100.5) };
    const p = withLastTick({ ...freshPortfolio(800), orders: [order()] }, prev);
    // Low unchanged (no new extreme), close stayed above the limit.
    const { portfolio, events } = applyTick(p, { NVDA: q(101, 103, 100.5) }, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(0);
    expect(portfolio.orders).toHaveLength(1);
  });

  it("fills a limit order on close-cross evidence", () => {
    const prev = { NVDA: q(102, 103, 100.5) };
    const p = withLastTick({ ...freshPortfolio(800), orders: [order()] }, prev);
    const { events } = applyTick(p, { NVDA: q(99, 103, 100.5) }, { now: NOW, day: DAY, isClose: false });
    expect(events[0].kind).toBe("entry-filled");
  });

  it("expires an unfilled day order at the closing tick and refunds the stake", () => {
    const prev = { NVDA: q(102, 103, 100.5) };
    const p = withLastTick({ ...freshPortfolio(800), orders: [order()] }, prev);
    const { portfolio, events } = applyTick(p, { NVDA: q(101, 103, 100.5) }, { now: NOW, day: DAY, isClose: true });
    expect(events[0].kind).toBe("order-expired");
    expect(portfolio.orders).toHaveLength(0);
    expect(portfolio.balance).toBe(1000);
  });
});

describe("applyTick — exits", () => {
  it("triggers a long stop on new-low evidence at the stop price", () => {
    const prev = { NVDA: q(101, 102, 96) };
    const p = withLastTick({ ...freshPortfolio(800), positions: [position()] }, prev);
    const { portfolio, events } = applyTick(p, { NVDA: q(96, 102, 94.5) }, { now: NOW, day: DAY, isClose: false });
    expect(events[0].kind).toBe("position-closed");
    const trade = events[0].kind === "position-closed" ? events[0].trade : null;
    expect(trade?.reason).toBe("stop");
    expect(trade?.exitPrice).toBe(95);
    expect(trade?.pnl).toBeCloseTo(-30); // 6 units × -5
    expect(portfolio.balance).toBeCloseTo(800 + 200 - 30);
    expect(portfolio.positions).toHaveLength(0);
  });

  it("prefers the stop when stop AND take-profit are touched in one window", () => {
    const prev = { NVDA: q(100, 100.5, 99) };
    const p = withLastTick({ ...freshPortfolio(800), positions: [position()] }, prev);
    const wild = { NVDA: q(110, 121, 94) }; // both extremes are new
    const { events } = applyTick(p, wild, { now: NOW, day: DAY, isClose: false });
    const trade = events[0].kind === "position-closed" ? events[0].trade : null;
    expect(trade?.reason).toBe("stop");
  });

  it("hits the take-profit on new-high evidence", () => {
    const prev = { NVDA: q(101, 102, 99) };
    const p = withLastTick({ ...freshPortfolio(800), positions: [position()] }, prev);
    const { events } = applyTick(p, { NVDA: q(118, 121, 99) }, { now: NOW, day: DAY, isClose: false });
    const trade = events[0].kind === "position-closed" ? events[0].trade : null;
    expect(trade?.reason).toBe("take-profit");
    expect(trade?.exitPrice).toBe(120);
    expect(trade?.pnl).toBeCloseTo(120);
  });

  it("liquidates at the liquidation price when the stop sits beyond it", () => {
    // Loose stop below the liquidation level: 3x leverage → liq at entry × (1 - 1/3).
    const pos = position({ stopLoss: 50, takeProfit: undefined });
    expect(liquidationPrice(pos)).toBeCloseTo(100 - 200 / 6);
    const prev = { NVDA: q(90, 100, 80) };
    const p = withLastTick({ ...freshPortfolio(800), positions: [pos] }, prev);
    const { portfolio, events } = applyTick(p, { NVDA: q(60, 100, 55) }, { now: NOW, day: DAY, isClose: false });
    const trade = events[0].kind === "position-closed" ? events[0].trade : null;
    expect(trade?.reason).toBe("liquidation");
    expect(trade?.pnl).toBeCloseTo(-200);
    expect(portfolio.balance).toBeCloseTo(800); // stake fully gone
  });

  it("does not exit a position opened in the same tick", () => {
    const p: Portfolio = { ...freshPortfolio(800), orders: [order({ entryType: "market", limitPrice: undefined, stopLoss: 95 })] };
    // The window's low is below the stop, but the entry happened only now.
    const { portfolio, events } = applyTick(p, { NVDA: q(100, 105, 90) }, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("entry-filled");
    expect(portfolio.positions).toHaveLength(1);
  });

  it("leaves positions without a quote untouched", () => {
    const p = withLastTick({ ...freshPortfolio(800), positions: [position()] }, {});
    const { portfolio, events } = applyTick(p, {}, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(0);
    expect(portfolio.positions).toHaveLength(1);
  });
});

describe("placeOrders — guardrails", () => {
  const quotes: QuoteMap = { NVDA: q(100, 101, 99), TSLA: q(200, 202, 198) };
  const decision = {
    ticker: "NVDA",
    side: "long" as const,
    stake: 150,
    leverage: 3,
    entry: "market" as const,
    stopLoss: 95,
    thesis: "test",
  };

  it("reserves the stake and creates the order", () => {
    const { portfolio, accepted, rejected } = placeOrders(freshPortfolio(1000), [decision], quotes, { now: NOW, day: DAY });
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
    expect(portfolio.balance).toBe(850);
    expect(portfolio.orders[0].entryType).toBe("market");
  });

  it("clamps leverage to 3x and the stake to 20% of equity", () => {
    const { portfolio, accepted } = placeOrders(
      freshPortfolio(1000),
      [{ ...decision, leverage: 10, stake: 900 }],
      quotes,
      { now: NOW, day: DAY },
    );
    expect(accepted[0].leverage).toBe(3);
    expect(accepted[0].stake).toBeCloseTo(200); // 20% of 1000
    expect(portfolio.balance).toBeCloseTo(800);
  });

  it("rejects a missing or wrong-sided stop and unknown tickers", () => {
    const { accepted, rejected } = placeOrders(
      freshPortfolio(1000),
      [
        { ...decision, stopLoss: 0 },
        { ...decision, stopLoss: 105 },
        { ...decision, ticker: "NOPE" },
        { ...decision, side: "short", stopLoss: 95 },
      ],
      quotes,
      { now: NOW, day: DAY },
    );
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(4);
  });

  it("enforces the 3-trades-per-day budget across existing orders", () => {
    const seeded: Portfolio = { ...freshPortfolio(1000), orders: [order(), order({ id: "x2" }), order({ id: "x3" })] };
    expect(tradesPlacedToday(seeded, DAY)).toBe(3);
    const { accepted, rejected } = placeOrders(seeded, [decision], quotes, { now: NOW, day: DAY });
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/Tagesbudget/);
  });

  it("accepts a limit entry and validates the stop against the limit level", () => {
    const { accepted } = placeOrders(
      freshPortfolio(1000),
      [{ ...decision, entry: 97, stopLoss: 94 }],
      quotes,
      { now: NOW, day: DAY },
    );
    expect(accepted[0].entryType).toBe("limit");
    expect(accepted[0].limitPrice).toBe(97);
  });
});

describe("applyAdjustments", () => {
  const quotes: QuoteMap = { NVDA: q(110, 112, 99) };

  it("moves a stop to a valid level and rejects a wrong-sided one", () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position()] };
    const ok = applyAdjustments(p, [{ type: "set_stop", positionId: position().id, price: 105 }], quotes, NOW);
    expect(ok.applied).toHaveLength(1);
    expect(ok.portfolio.positions[0].stopLoss).toBe(105);
    const bad = applyAdjustments(p, [{ type: "set_stop", positionId: position().id, price: 115 }], quotes, NOW);
    expect(bad.rejected).toHaveLength(1);
  });

  it("closes a position at the current quote", () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position()] };
    const { portfolio, events } = applyAdjustments(p, [{ type: "close_position", positionId: position().id }], quotes, NOW);
    const trade = events[0].kind === "position-closed" ? events[0].trade : null;
    expect(trade?.reason).toBe("manual");
    expect(trade?.pnl).toBeCloseTo(60);
    expect(portfolio.balance).toBeCloseTo(800 + 260);
  });

  it("cancels an order and refunds its stake", () => {
    const p: Portfolio = { ...freshPortfolio(800), orders: [order()] };
    const { portfolio, applied } = applyAdjustments(p, [{ type: "cancel_order", orderId: order().id }], {}, NOW);
    expect(applied).toHaveLength(1);
    expect(portfolio.orders).toHaveLength(0);
    expect(portfolio.balance).toBe(1000);
  });
});

describe("adminAdjust", () => {
  it("sets, deposits and withdraws on the free balance only", () => {
    let p = freshPortfolio(100);
    p = adminAdjust(p, { action: "set_balance", amount: 500 });
    expect(p.balance).toBe(500);
    p = adminAdjust(p, { action: "deposit", amount: 200 });
    expect(p.balance).toBe(700);
    p = adminAdjust(p, { action: "withdraw", amount: 1000 });
    expect(p.balance).toBe(0); // floored at zero
    expect(adminAdjust(p, { action: "note" })).toEqual(p);
  });
});
