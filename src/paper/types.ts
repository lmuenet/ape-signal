// src/paper/types.ts — domain types for Mr Ape's paper-trading depot.
// portfolio.json is the single source of truth for numbers (see CONTEXT.md:
// Mr Ape decides, the engine does the bookkeeping).

export type Side = "long" | "short";

/** One scanner snapshot for a ticker at a tick (day high/low, not window). */
export interface TickQuote {
  close: number;
  changePct: number;
  high: number; // day high so far
  low: number; // day low so far
}

export type QuoteMap = Record<string, TickQuote>;

/**
 * A pending entry order from the Kandidatenkür. The stake is reserved (already
 * deducted from balance) while the order is open; it expires unfilled at the
 * Close tick of the day it was created.
 */
export interface EntryOrder {
  id: string;
  ticker: string;
  side: Side;
  stake: number; // reserved margin (USD)
  leverage: number; // 1..3 (balanced guardrail)
  entryType: "market" | "limit";
  limitPrice?: number; // fill when the price provably touches this level
  stopLoss: number; // mandatory
  takeProfit?: number;
  thesis: string;
  createdAt: string; // ISO
  day: string; // Berlin trading day (YYYY-MM-DD) — expiry day
}

/** An open CFD-style position: notional = stake × leverage. */
export interface Position {
  id: string;
  ticker: string;
  side: Side;
  stake: number;
  leverage: number;
  entryPrice: number;
  units: number; // notional / entryPrice
  stopLoss: number;
  takeProfit?: number;
  openedAt: string; // ISO
  thesis: string;
  /** Execution fees paid so far (entry leg). Missing in pre-cost depots. */
  fees?: number;
}

export type CloseReason = "stop" | "take-profit" | "liquidation" | "manual" | "expired";

export interface ClosedTrade {
  id: string;
  ticker: string;
  side: Side;
  stake: number;
  leverage: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number; // realized, capped at -stake (can never lose more than the margin)
  /** Round-trip execution fees (entry + exit). Missing in pre-cost depots. */
  fees?: number;
  reason: Exclude<CloseReason, "expired">;
  openedAt: string;
  closedAt: string;
}

export interface Portfolio {
  /** Free cash. Stakes of open orders AND open positions are already deducted. */
  balance: number;
  positions: Position[];
  orders: EntryOrder[];
  history: ClosedTrade[];
  /** Last processed tick — the fill evidence baseline for the next tick. */
  lastTick?: { at: string; day: string; quotes: QuoteMap };
}

/** Balanced-mode guardrails — enforced by the engine, not by Mr Ape. */
export const GUARDRAILS = {
  maxLeverage: 3,
  /** Max stake per trade as a fraction of current equity (play-money depot). */
  maxStakeFraction: 0.2,
  maxTradesPerDay: 3,
} as const;

/**
 * Simulated execution costs so the paper performance doesn't flatter
 * (Smartbroker+/gettex-style fee schedule, see ADR 0002). The half-spread hits
 * market-type executions only (market entry, stop, manual close, liquidation);
 * limit-type fills (limit entry, take-profit) guarantee their level.
 */
export const COSTS = {
  /** Half-spread applied against the trade per market-type execution. */
  halfSpread: 0.001,
  /** Flat fee per execution below the free-trade threshold. */
  orderFee: 0.99,
  /** Order volume (notional) at/above which an execution is free. */
  freeFrom: 500,
} as const;

/** A trade Mr Ape (Opus) wants to place at the Kandidatenkür. */
export interface TradeDecision {
  ticker: string;
  side: Side;
  stake: number;
  leverage: number;
  entry: "market" | number; // number = limit level
  stopLoss: number;
  takeProfit?: number;
  thesis: string;
}

/** An adjustment Mr Ape (Sonnet) may request at a tick. */
export type Adjustment =
  | { type: "set_stop"; positionId: string; price: number }
  | { type: "set_take_profit"; positionId: string; price: number | null }
  | { type: "close_position"; positionId: string }
  | { type: "cancel_order"; orderId: string };

export type TickEvent =
  | { kind: "entry-filled"; position: Position }
  | { kind: "order-expired"; order: EntryOrder }
  | { kind: "position-closed"; trade: ClosedTrade };

export function freshPortfolio(startBalance: number): Portfolio {
  return { balance: startBalance, positions: [], orders: [], history: [] };
}
