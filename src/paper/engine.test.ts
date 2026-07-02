import { describe, expect, it } from "vitest";
import {
  addBerlinDays,
  adminAdjust,
  applyAdjustments,
  applyTick,
  equity,
  expireDayOrders,
  executionFee,
  intradayTradesPlacedToday,
  liquidationPrice,
  placeOrders,
  positionPnl,
  tradesPlacedToday,
} from "./engine";
import { COSTS, freshPortfolio, type EntryOrder, type Portfolio, type Position, type QuoteMap } from "./types";

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
  it("fills a market order half a spread above the tick close", () => {
    const p: Portfolio = { ...freshPortfolio(800), orders: [order({ entryType: "market", limitPrice: undefined })] };
    const { portfolio, events } = applyTick(p, { NVDA: q(101, 102, 100) }, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("entry-filled");
    const effEntry = 101 * (1 + COSTS.halfSpread);
    expect(portfolio.positions[0].entryPrice).toBeCloseTo(effEntry);
    expect(portfolio.positions[0].units).toBeCloseTo(600 / effEntry);
    expect(portfolio.orders).toHaveLength(0);
    expect(portfolio.balance).toBeCloseTo(800 - COSTS.orderFee); // stake reserved; flat fee on every execution
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
  it("triggers a long stop half a spread below the stop level", () => {
    const prev = { NVDA: q(101, 102, 96) };
    const p = withLastTick({ ...freshPortfolio(800), positions: [position()] }, prev);
    const { portfolio, events } = applyTick(p, { NVDA: q(96, 102, 94.5) }, { now: NOW, day: DAY, isClose: false });
    expect(events[0].kind).toBe("position-closed");
    const trade = events[0].kind === "position-closed" ? events[0].trade : null;
    expect(trade?.reason).toBe("stop");
    const effExit = 95 * (1 - COSTS.halfSpread);
    expect(trade?.exitPrice).toBeCloseTo(effExit);
    expect(trade?.pnl).toBeCloseTo(6 * (effExit - 100)); // -30.57
    expect(portfolio.balance).toBeCloseTo(800 + 200 + 6 * (effExit - 100) - COSTS.orderFee); // flat exit fee
    expect(portfolio.positions).toHaveLength(0);
  });

  it("carries the position thesis into the closed trade", () => {
    const prev = { NVDA: q(101, 102, 96) };
    const p = withLastTick({ ...freshPortfolio(800), positions: [position({ thesis: "EMA-Cross Pullback" })] }, prev);
    const { portfolio } = applyTick(p, { NVDA: q(96, 102, 94.5) }, { now: NOW, day: DAY, isClose: false });
    expect(portfolio.history.at(-1)?.thesis).toBe("EMA-Cross Pullback");
  });

  it("prefers the stop when stop AND take-profit are touched in one window", () => {
    const prev = { NVDA: q(100, 100.5, 99) };
    const p = withLastTick({ ...freshPortfolio(800), positions: [position()] }, prev);
    const wild = { NVDA: q(110, 121, 94) }; // both extremes are new
    const { events } = applyTick(p, wild, { now: NOW, day: DAY, isClose: false });
    const trade = events[0].kind === "position-closed" ? events[0].trade : null;
    expect(trade?.reason).toBe("stop");
  });

  it("hits the take-profit exactly at the level (limit semantics, no spread)", () => {
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
    expect(trade?.pnl).toBeCloseTo(-200); // capped at the stake despite the spread
    // Stake fully gone; the flat exit fee still applies (fees are not margin).
    expect(portfolio.balance).toBeCloseTo(800 - COSTS.orderFee);
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

describe("addBerlinDays", () => {
  it("adds calendar days across month and year boundaries", () => {
    expect(addBerlinDays("2026-06-09", 0)).toBe("2026-06-09");
    expect(addBerlinDays("2026-06-09", 1)).toBe("2026-06-10");
    expect(addBerlinDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addBerlinDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addBerlinDays("2026-06-09", 4)).toBe("2026-06-13");
  });
});

describe("placeOrders — multi-day TTL (Stufe 1)", () => {
  const quotes: QuoteMap = { NVDA: q(100, 101, 99) };
  const base = { ticker: "NVDA", side: "long" as const, stake: 150, leverage: 1, entry: 97, stopLoss: 94, thesis: "t" };

  it("sets expiresOn ttlDays-1 days out and clamps/rounds to [1,5]", () => {
    const r2 = placeOrders(freshPortfolio(1000), [{ ...base, ttlDays: 2 }], quotes, { now: NOW, day: DAY });
    expect(r2.accepted[0].expiresOn).toBe("2026-06-10");
    const r99 = placeOrders(freshPortfolio(1000), [{ ...base, ttlDays: 99 }], quotes, { now: NOW, day: DAY });
    expect(r99.accepted[0].expiresOn).toBe(addBerlinDays(DAY, 4)); // clamped to 5 days → +4
    const rRound = placeOrders(freshPortfolio(1000), [{ ...base, ttlDays: 2.6 }], quotes, { now: NOW, day: DAY });
    expect(rRound.accepted[0].expiresOn).toBe(addBerlinDays(DAY, 2)); // round(2.6)=3 → +2
  });

  it("leaves expiresOn undefined for ttlDays<=1 or absent (same-day, unchanged)", () => {
    expect(placeOrders(freshPortfolio(1000), [{ ...base, ttlDays: 1 }], quotes, { now: NOW, day: DAY }).accepted[0].expiresOn).toBeUndefined();
    expect(placeOrders(freshPortfolio(1000), [{ ...base, ttlDays: 0 }], quotes, { now: NOW, day: DAY }).accepted[0].expiresOn).toBeUndefined();
    expect(placeOrders(freshPortfolio(1000), [base], quotes, { now: NOW, day: DAY }).accepted[0].expiresOn).toBeUndefined();
  });

  it("counts a multi-day order against the budget on its creation day only", () => {
    const { portfolio } = placeOrders(freshPortfolio(1000), [{ ...base, ttlDays: 3 }], quotes, { now: NOW, day: DAY });
    expect(tradesPlacedToday(portfolio, DAY)).toBe(1);
    expect(tradesPlacedToday(portfolio, "2026-06-10")).toBe(0);
  });

  it("survives the close of its creation day and expires once expiresOn is due", () => {
    // Limit far below the range so it never fills on a non-first tick.
    const multi = order({ limitPrice: 90, expiresOn: "2026-06-10" });
    const prev = { NVDA: q(102, 103, 100.5) };
    const p = withLastTick({ ...freshPortfolio(800), orders: [multi] }, prev);
    const d0 = applyTick(p, { NVDA: q(101, 103, 100.5) }, { now: NOW, day: DAY, isClose: true });
    expect(d0.events).toHaveLength(0); // not yet due → survives the creation-day close
    expect(d0.portfolio.orders).toHaveLength(1);
    const due = expireDayOrders(d0.portfolio, "2026-06-10"); // pure expiry on the due day
    expect(due.events[0].kind).toBe("order-expired");
    expect(due.portfolio.orders).toHaveLength(0);
    expect(due.portfolio.balance).toBe(1000); // stake refunded
  });
});

describe("placeOrders — ladder rungs (rungGroup, Stufe 1)", () => {
  const base = { ticker: "AAPL", side: "long" as const, stake: 100, leverage: 1, stopLoss: 90, thesis: "t" };

  it("groups ≥2 limit orders on the same ticker+side into one rungGroup", () => {
    const { accepted } = placeOrders(
      freshPortfolio(1000),
      [{ ...base, entry: 99 }, { ...base, entry: 97 }],
      { AAPL: q(100, 101, 99) },
      { now: NOW, day: DAY },
    );
    expect(accepted).toHaveLength(2);
    expect(accepted[0].rungGroup).toBeDefined();
    expect(accepted[0].rungGroup).toBe(accepted[1].rungGroup);
  });

  it("does not group a single limit or a market order", () => {
    const { accepted } = placeOrders(
      freshPortfolio(1000),
      [{ ...base, entry: 99 }, { ...base, ticker: "NVDA", entry: "market" as const }],
      { AAPL: q(100, 101, 99), NVDA: q(50, 51, 49) },
      { now: NOW, day: DAY },
    );
    expect(accepted.find((o) => o.ticker === "AAPL")?.rungGroup).toBeUndefined();
    expect(accepted.find((o) => o.ticker === "NVDA")?.rungGroup).toBeUndefined();
  });
});

describe("applyTick — ladder mutual-cancel (Stufe 1)", () => {
  const rg = "NVDA-long-2026-06-09-ladder";

  it("fills the first touched rung and cancels its siblings (refunding their stake)", () => {
    const r1 = order({ id: "NVDA-1", limitPrice: 100, rungGroup: rg, stopLoss: 90 });
    const r2 = order({ id: "NVDA-2", limitPrice: 98, rungGroup: rg, stopLoss: 90 });
    const p: Portfolio = { ...freshPortfolio(600), orders: [r1, r2] };
    // First tick, day-low 97 touches both 100 and 98.
    const { portfolio, events } = applyTick(p, { NVDA: q(99, 101, 97) }, { now: NOW, day: DAY, isClose: false });
    expect(portfolio.positions).toHaveLength(1);
    expect(portfolio.positions[0].entryPrice).toBe(100); // the nearer rung filled
    expect(portfolio.orders).toHaveLength(0); // sibling cancelled
    expect(events.filter((e) => e.kind === "entry-filled")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "order-expired")).toHaveLength(1);
    expect(portfolio.balance).toBeCloseTo(800 - COSTS.orderFee); // 600 + 200 refunded sibling stake − entry fee
  });

  it("cancels a rung kept earlier in the loop when a later sibling fills (second pass)", () => {
    const rFar = order({ id: "NVDA-far", limitPrice: 95, rungGroup: rg, stopLoss: 90 });
    const rNear = order({ id: "NVDA-near", limitPrice: 99, rungGroup: rg, stopLoss: 90 });
    const prev = { NVDA: q(100, 100, 100) };
    // Far rung placed first; it is NOT touched, the near rung is.
    const p = withLastTick({ ...freshPortfolio(600), orders: [rFar, rNear] }, prev);
    const { portfolio, events } = applyTick(p, { NVDA: q(98.5, 100, 98.5) }, { now: NOW, day: DAY, isClose: false });
    expect(portfolio.positions).toHaveLength(1);
    expect(portfolio.positions[0].id).toBe("NVDA-near");
    expect(portfolio.positions[0].entryPrice).toBe(99);
    expect(portfolio.orders).toHaveLength(0);
    expect(events.some((e) => e.kind === "order-expired")).toBe(true);
    expect(portfolio.balance).toBeCloseTo(800 - COSTS.orderFee); // far rung refunded − entry fee
  });
});

describe("intraday source tagging + separate budget tier (Stufe 3)", () => {
  const quotes: QuoteMap = { NVDA: q(100, 101, 99) };
  const base = { ticker: "NVDA", side: "long" as const, stake: 100, leverage: 1, entry: 97, stopLoss: 90, thesis: "t" };

  it("tags an intraday order and counts it only in the intraday tier (plus the shared daily cap)", () => {
    const { portfolio } = placeOrders(freshPortfolio(1000), [base], quotes, { now: NOW, day: DAY, source: "intraday" });
    expect(portfolio.orders[0].source).toBe("intraday");
    expect(intradayTradesPlacedToday(portfolio, DAY)).toBe(1);
    expect(tradesPlacedToday(portfolio, DAY)).toBe(1);
  });

  it("leaves Kür orders unsourced and out of the intraday tier", () => {
    const { portfolio } = placeOrders(freshPortfolio(1000), [base], quotes, { now: NOW, day: DAY });
    expect(portfolio.orders[0].source).toBeUndefined();
    expect(intradayTradesPlacedToday(portfolio, DAY)).toBe(0);
    expect(tradesPlacedToday(portfolio, DAY)).toBe(1);
  });

  it("propagates source onto the filled position", () => {
    const placed = placeOrders(freshPortfolio(1000), [{ ...base, entry: "market" as const }], quotes, { now: NOW, day: DAY, source: "intraday" });
    const { portfolio } = applyTick(placed.portfolio, quotes, { now: NOW, day: DAY, isClose: false });
    expect(portfolio.positions[0].source).toBe("intraday");
    expect(intradayTradesPlacedToday(portfolio, DAY)).toBe(1);
  });

  it("carries source onto the closed trade so a stopped intraday trade still counts today", () => {
    const pos = position({ source: "intraday", stopLoss: 95, openedAt: NOW });
    const prev = { NVDA: q(101, 102, 96) };
    const p = withLastTick({ ...freshPortfolio(800), positions: [pos] }, prev);
    const { portfolio } = applyTick(p, { NVDA: q(96, 102, 94.5) }, { now: NOW, day: DAY, isClose: false });
    expect(portfolio.history[0].source).toBe("intraday");
    expect(intradayTradesPlacedToday(portfolio, DAY)).toBe(1);
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

  it("closes a position half a spread below the current quote", () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position()] };
    const { portfolio, events } = applyAdjustments(p, [{ type: "close_position", positionId: position().id }], quotes, NOW);
    const trade = events[0].kind === "position-closed" ? events[0].trade : null;
    expect(trade?.reason).toBe("manual");
    const effExit = 110 * (1 - COSTS.halfSpread);
    expect(trade?.pnl).toBeCloseTo(6 * (effExit - 100)); // 59.34
    expect(portfolio.balance).toBeCloseTo(800 + 200 + 6 * (effExit - 100) - COSTS.orderFee);
  });

  it("cancels an order and refunds its stake", () => {
    const p: Portfolio = { ...freshPortfolio(800), orders: [order()] };
    const { portfolio, applied } = applyAdjustments(p, [{ type: "cancel_order", orderId: order().id }], {}, NOW);
    expect(applied).toHaveLength(1);
    expect(portfolio.orders).toHaveLength(0);
    expect(portfolio.balance).toBe(1000);
  });
});

describe("execution costs", () => {
  it("charges the flat fee on every execution regardless of volume", () => {
    expect(executionFee()).toBeCloseTo(COSTS.orderFee);
  });

  it("charges the flat fee on a market entry", () => {
    const small = order({ entryType: "market", limitPrice: undefined, stake: 100, leverage: 1 });
    const p: Portfolio = { ...freshPortfolio(900), orders: [small] };
    const { portfolio } = applyTick(p, { NVDA: q(101, 102, 100) }, { now: NOW, day: DAY, isClose: false });
    expect(portfolio.positions[0].fees).toBeCloseTo(COSTS.orderFee);
    expect(portfolio.balance).toBeCloseTo(900 - COSTS.orderFee);
  });

  it("fills a limit entry exactly at the limit (no spread), fee still applies", () => {
    const small = order({ stake: 100, leverage: 1 }); // limit 100
    const p: Portfolio = { ...freshPortfolio(900), orders: [small] };
    const { portfolio } = applyTick(p, { NVDA: q(102, 103, 99.5) }, { now: NOW, day: DAY, isClose: false });
    expect(portfolio.positions[0].entryPrice).toBe(100);
    expect(portfolio.balance).toBeCloseTo(900 - COSTS.orderFee);
  });

  it("records round-trip fees on the closed trade and nets the exit fee from the balance", () => {
    // 1 unit at entry 100 → flat fee on both legs.
    const pos = position({ stake: 100, leverage: 1, entryPrice: 100, units: 1, takeProfit: undefined, fees: COSTS.orderFee });
    const prev = { NVDA: q(101, 102, 96) };
    const p = withLastTick({ ...freshPortfolio(900), positions: [pos] }, prev);
    const { portfolio, events } = applyTick(p, { NVDA: q(96, 102, 94.5) }, { now: NOW, day: DAY, isClose: false });
    const trade = events[0].kind === "position-closed" ? events[0].trade : null;
    const effExit = 95 * (1 - COSTS.halfSpread);
    expect(trade?.fees).toBeCloseTo(2 * COSTS.orderFee); // entry + exit
    expect(trade?.pnl).toBeCloseTo(effExit - 100);
    expect(portfolio.balance).toBeCloseTo(900 + 100 + (effExit - 100) - COSTS.orderFee);
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

describe("applyAdjustments: set_wake_band", () => {
  const wakePos: Position = {
    id: "P1", ticker: "AAPL", side: "long", stake: 200, leverage: 2,
    entryPrice: 100, units: 4, stopLoss: 90, openedAt: "2026-06-11T14:00:00.000Z", thesis: "",
  };
  const base: Portfolio = { balance: 1000, positions: [wakePos], orders: [], history: [] };
  const wakeQuotes: QuoteMap = { AAPL: q(100, 101, 99) };
  const at = "2026-06-11T15:00:00.000Z";

  it("sets both sides when they straddle the current price", () => {
    const r = applyAdjustments(base, [{ type: "set_wake_band", positionId: "P1", above: 110, below: 95 }], wakeQuotes, at);
    expect(r.applied).toHaveLength(1);
    expect(r.portfolio.positions[0]?.wakeAbove).toBe(110);
    expect(r.portfolio.positions[0]?.wakeBelow).toBe(95);
  });

  it("clears a side via null", () => {
    const withBands: Portfolio = { ...base, positions: [{ ...wakePos, wakeAbove: 110, wakeBelow: 95 }] };
    const r = applyAdjustments(withBands, [{ type: "set_wake_band", positionId: "P1", above: null, below: 95 }], wakeQuotes, at);
    expect(r.portfolio.positions[0]?.wakeAbove).toBeUndefined();
    expect(r.portfolio.positions[0]?.wakeBelow).toBe(95);
  });

  it("rejects a band on the wrong side of the current price", () => {
    const r = applyAdjustments(base, [{ type: "set_wake_band", positionId: "P1", above: 99, below: 95 }], wakeQuotes, at);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected[0]?.reason).toContain("Wake-Band");
  });

  it("rejects without a current quote", () => {
    const r = applyAdjustments(base, [{ type: "set_wake_band", positionId: "P1", above: 110, below: 95 }], {}, at);
    expect(r.rejected).toHaveLength(1);
  });
});

describe("wake bands through placeOrders and fill", () => {
  const empty: Portfolio = { balance: 1000, positions: [], orders: [], history: [] };
  const wakeQuotes: QuoteMap = { AAPL: q(100, 101, 99) };
  const opts = { now: "2026-06-11T13:00:00.000Z", day: "2026-06-11" };

  const decision = (over: Record<string, unknown> = {}) => ({
    ticker: "AAPL", side: "long" as const, stake: 100, leverage: 1, entry: "market" as const,
    stopLoss: 90, thesis: "", ...over,
  });

  it("carries valid bands onto the order", () => {
    const r = placeOrders(empty, [decision({ wakeAbove: 110, wakeBelow: 95 })], wakeQuotes, opts);
    expect(r.accepted[0]?.wakeAbove).toBe(110);
    expect(r.accepted[0]?.wakeBelow).toBe(95);
  });

  it("silently drops a band on the wrong side (band is soft, trade stays)", () => {
    const r = placeOrders(empty, [decision({ wakeAbove: 99, wakeBelow: 95 })], wakeQuotes, opts);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]?.wakeAbove).toBeUndefined();
    expect(r.accepted[0]?.wakeBelow).toBe(95);
  });

  it("copies bands from order to position on fill", () => {
    const placed = placeOrders(empty, [decision({ wakeAbove: 110, wakeBelow: 95 })], wakeQuotes, opts);
    const ticked = applyTick(placed.portfolio, wakeQuotes, { now: "2026-06-11T13:35:00.000Z", day: "2026-06-11", isClose: false });
    expect(ticked.portfolio.positions[0]?.wakeAbove).toBe(110);
    expect(ticked.portfolio.positions[0]?.wakeBelow).toBe(95);
  });
});

describe("expireDayOrders (stale-close path, Lebenszeichen spec)", () => {
  it("expires due day orders, releases the stake and leaves lastTick untouched", () => {
    const lastTick = { at: NOW, day: DAY, quotes: {} };
    const p: Portfolio = { ...freshPortfolio(900), orders: [order()], lastTick };
    const { portfolio, events } = expireDayOrders(p, DAY);
    expect(portfolio.orders).toHaveLength(0);
    expect(portfolio.balance).toBe(1100); // 900 + 200 released stake
    expect(portfolio.lastTick).toBe(lastTick); // evidence baseline untouched
    expect(events).toEqual([{ kind: "order-expired", order: order() }]);
  });

  it("keeps orders from a future day", () => {
    const p: Portfolio = { ...freshPortfolio(900), orders: [order({ day: "2026-06-10" })] };
    const { portfolio, events } = expireDayOrders(p, DAY);
    expect(portfolio.orders).toHaveLength(1);
    expect(portfolio.balance).toBe(900);
    expect(events).toEqual([]);
  });
});

describe("fill evidence — no phantom fills (levelTraded)", () => {
  it("first tick: does NOT fill a buy limit below the day's traded range", () => {
    // Range 95..105, limit 90 — the price never traded at 90.
    const p: Portfolio = { ...freshPortfolio(800), orders: [order({ limitPrice: 90, stopLoss: 85 })] };
    const { portfolio, events } = applyTick(p, { NVDA: q(100, 105, 95) }, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(0);
    expect(portfolio.orders).toHaveLength(1);
  });

  it("first tick: does NOT fill a short limit above the day's traded range", () => {
    const p: Portfolio = {
      ...freshPortfolio(800),
      orders: [order({ side: "short", limitPrice: 110, stopLoss: 120 })],
    };
    const { portfolio, events } = applyTick(p, { NVDA: q(100, 105, 95) }, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(0);
    expect(portfolio.orders).toHaveLength(1);
  });

  it("does NOT fill a buy limit far below the market on a mere new day high", () => {
    // The old bug: any new day extreme made the one-sided evidence trivially
    // true for every level on the other side of the price.
    const prev = { NVDA: q(100, 104, 95) };
    const p = withLastTick({ ...freshPortfolio(800), orders: [order({ limitPrice: 90, stopLoss: 85 })] }, prev);
    const { portfolio, events } = applyTick(p, { NVDA: q(104.5, 105, 95) }, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(0);
    expect(portfolio.orders).toHaveLength(1);
  });

  it("fills when the day low moves across the limit level since the last tick", () => {
    const prev = { NVDA: q(100, 104, 99) };
    const p = withLastTick({ ...freshPortfolio(800), orders: [order({ limitPrice: 98, stopLoss: 90 })] }, prev);
    const { events } = applyTick(p, { NVDA: q(99, 104, 97.5) }, { now: NOW, day: DAY, isClose: false });
    expect(events[0]?.kind).toBe("entry-filled");
  });
});

describe("fill evidence — placement baseline (same-day orders)", () => {
  const BASELINE = { close: 102, high: 103, low: 97 }; // day low 97 happened BEFORE placement

  it("placeOrders stamps the placement quote as the order's baseline", () => {
    const { accepted } = placeOrders(
      freshPortfolio(1000),
      [{ ticker: "NVDA", side: "long", stake: 150, leverage: 1, entry: 98, stopLoss: 94, thesis: "t" }],
      { NVDA: q(102, 103, 97) },
      { now: NOW, day: DAY },
    );
    expect(accepted[0].baseline).toEqual(BASELINE);
  });

  it("ignores pre-placement day-low evidence on the first tick after placement", () => {
    // Limit 98: the day low (97) is below it, but it predates the order — no fill.
    const p: Portfolio = {
      ...freshPortfolio(800),
      orders: [order({ limitPrice: 98, stopLoss: 94, baseline: BASELINE })],
    };
    const { portfolio, events } = applyTick(p, { NVDA: q(102, 103, 97) }, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(0);
    expect(portfolio.orders).toHaveLength(1);
  });

  it("fills when the low moves below the limit AFTER placement", () => {
    const p: Portfolio = {
      ...freshPortfolio(800),
      orders: [order({ limitPrice: 98, stopLoss: 94, baseline: { close: 102, high: 103, low: 99 } })],
    };
    const { events } = applyTick(p, { NVDA: q(101, 103, 97.5) }, { now: NOW, day: DAY, isClose: false });
    expect(events[0]?.kind).toBe("entry-filled");
  });

  it("uses whole-day evidence again from the next day on (multi-day order)", () => {
    // Overnight-gap catch-up of ADR 0001: the stored baseline is stale on later days.
    const multi = order({ limitPrice: 98, stopLoss: 94, baseline: BASELINE, expiresOn: "2026-06-10" });
    const p: Portfolio = { ...freshPortfolio(800), orders: [multi] };
    const { events } = applyTick(p, { NVDA: q(102, 103, 97) }, { now: NOW, day: "2026-06-10", isClose: false });
    expect(events[0]?.kind).toBe("entry-filled");
  });
});

describe("market entries — stale-print and drift guards", () => {
  const market = (over: Partial<EntryOrder> = {}) =>
    order({ entryType: "market", limitPrice: undefined, ...over });

  it("does not fill on a collapsed single print (high == low): stale market-maker quote", () => {
    const p: Portfolio = { ...freshPortfolio(800), orders: [market()] };
    const { portfolio, events } = applyTick(p, { NVDA: q(100, 100, 100) }, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(0);
    expect(portfolio.orders).toHaveLength(1); // stays open, retries next tick
  });

  it("does not fill when the close drifted beyond the band from the placement close", () => {
    const p: Portfolio = {
      ...freshPortfolio(800),
      orders: [market({ baseline: { close: 100, high: 101, low: 99 } })],
    };
    const { portfolio, events } = applyTick(p, { NVDA: q(104, 105, 99) }, { now: NOW, day: DAY, isClose: false });
    expect(events).toHaveLength(0);
    expect(portfolio.orders).toHaveLength(1);
  });

  it("fills within the drift band at close plus half a spread", () => {
    const p: Portfolio = {
      ...freshPortfolio(800),
      orders: [market({ baseline: { close: 100, high: 101, low: 99 } })],
    };
    const { portfolio, events } = applyTick(p, { NVDA: q(102, 103, 99) }, { now: NOW, day: DAY, isClose: false });
    expect(events[0]?.kind).toBe("entry-filled");
    expect(portfolio.positions[0].entryPrice).toBeCloseTo(102 * (1 + COSTS.halfSpread));
  });
});

describe("EUR listing carry-through (ADR 0005)", () => {
  const LISTING = {
    deSymbol: "TRADEGATE:QCI",
    isin: "US7475251036",
    name: "QUALCOMM Incorporated",
    currency: "EUR",
  };

  it("placeOrders copies the resolved listing from the decision onto the order", () => {
    const p = freshPortfolio(2000);
    const { accepted } = placeOrders(
      p,
      [{ ticker: "QCOM", side: "long", stake: 200, leverage: 2, entry: 180, stopLoss: 170, thesis: "t", ...LISTING }],
      { QCOM: q(180, 182, 178) },
      { now: NOW, day: DAY },
    );
    expect(accepted[0]).toMatchObject(LISTING);
  });

  it("applyTick carries the listing from a filled order onto the position", () => {
    const p: Portfolio = { ...freshPortfolio(1800), orders: [order({ ...LISTING, ticker: "QCOM", limitPrice: 180, stopLoss: 170, takeProfit: 200 })] };
    const { events } = applyTick(p, { QCOM: q(180, 182, 178) }, { now: NOW, day: DAY, isClose: false });
    const filled = events.find((e) => e.kind === "entry-filled");
    expect(filled?.kind === "entry-filled" && filled.position).toMatchObject(LISTING);
  });

  it("closeTrade carries the listing into history (clear name + currency)", () => {
    const base = freshPortfolio(0);
    const p = withLastTick({ ...base, positions: [position({ ...LISTING, ticker: "QCOM", entryPrice: 180, units: 6, stopLoss: 170 })] }, { QCOM: q(185, 186, 184) });
    // Next tick gaps below the stop → position closes, trade enters history.
    const { portfolio } = applyTick(p, { QCOM: q(168, 169, 167) }, { now: NOW, day: DAY, isClose: false });
    expect(portfolio.history[0]).toMatchObject(LISTING);
  });
});
