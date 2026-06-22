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
  // TradingView scanner indicator columns (free, no proxy needed). Optional:
  // absent when the scanner doesn't return them (degraded source). See trend.ts.
  ema10?: number;
  ema20?: number;
  ema50?: number;
  rsi?: number;
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
  /** Wake-up band carried into the position on fill (ADR 0003). */
  wakeAbove?: number;
  wakeBelow?: number;
  thesis: string;
  createdAt: string; // ISO
  day: string; // Berlin trading day (YYYY-MM-DD) — creation day, counts towards the daily budget
  /**
   * Berlin day (YYYY-MM-DD) the order expires at its Close tick. Absent → same-day
   * (= `day`). A multi-day order (ttlDays > 1) sits beyond `day` but still counts
   * towards the budget on its `day` only (see tradesPlacedToday).
   */
  expiresOn?: string;
  /**
   * Mutually-exclusive ladder group (Stufe 1): orders sharing this id are rungs of
   * one conviction — when one fills, the engine cancels the others (never double-enters).
   */
  rungGroup?: string;
  /** Where the order originated. Absent → "kuer" (the daily Kandidatenkür). */
  source?: TradeSource;
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
  /** Soft thresholds that wake the manager (never trade). See ADR 0003. */
  wakeAbove?: number;
  wakeBelow?: number;
  openedAt: string; // ISO
  thesis: string;
  /** Execution fees paid so far (entry leg). Missing in pre-cost depots. */
  fees?: number;
  /** Where the position originated. Absent → "kuer" (the daily Kandidatenkür). */
  source?: TradeSource;
}

/** Where a trade originated: the daily Kür, or the gated intraday opportunism loop. */
export type TradeSource = "kuer" | "intraday";

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
  /** Where the trade originated. Absent → "kuer". Carried for the intraday budget tier. */
  source?: TradeSource;
  /** The position's thesis at entry — carried into the reflection track-record. */
  thesis: string;
}

export interface Portfolio {
  /** Free cash. Stakes of open orders AND open positions are already deducted. */
  balance: number;
  positions: Position[];
  orders: EntryOrder[];
  history: ClosedTrade[];
  /** Last processed tick — the fill evidence baseline for the next tick. */
  lastTick?: { at: string; day: string; quotes: QuoteMap };
  /** Last manager (Sonnet) call — cooldown baseline for band wakes. */
  lastManagerCallAt?: string;
  /** Last monitor tick that actually ran — baseline for the interval throttle (A2). */
  lastTickAt?: string;
}

/** Balanced-mode guardrails — enforced by the engine, not by Mr Ape. */
export const GUARDRAILS = {
  maxLeverage: 3,
  /** Max stake per trade as a fraction of current equity (play-money depot). */
  maxStakeFraction: 0.2,
  maxTradesPerDay: 3,
  /** Max trading days an entry order may stay valid (Stufe 1 multi-day TTL). */
  maxTtlDays: 5,
  /** Separate daily budget tier for the gated intraday opportunism loop (Stufe 3). */
  maxIntradayTrades: 1,
} as const;

/**
 * Shape of the data-dependent intraday-opportunism knobs the Setup-Radar reads
 * (Stufe 2/3). Pulled out so detectSetups can be driven (and tested) from one
 * place instead of hard-coded literals.
 */
export interface SetupThresholds {
  /** RSI level a tick must cross UP to fire "overbought". */
  rsiOverbought: number;
  /** RSI level a tick must cross DOWN to fire "oversold". */
  rsiOversold: number;
  /**
   * Minimum EMA10−EMA20 distance the new stack must clear for an EMA cross to
   * fire — a whipsaw guard. 0 = an exact sign change (today's behaviour).
   */
  emaCrossMinGap: number;
}

/**
 * Data-dependent intraday-opportunism knobs (Stufe 2/3), centralised so the
 * post-live calibration is ONE edit here, not a code hunt. Every value is a
 * "tune from live data" knob; the defaults reproduce today's hard-coded
 * behaviour bit-for-bit (RSI 70/30, exact EMA sign change), so wiring these in
 * is a pure refactor.
 *
 * NOTE: the related budget/TTL caps `GUARDRAILS.maxIntradayTrades` (1) and
 * `GUARDRAILS.maxTtlDays` (5) are equally data-dependent but stay in GUARDRAILS
 * (the engine enforces them) — calibrate those there, alongside these.
 */
export const OPPORTUNISM = {
  rsiOverbought: 70, // tune from live data
  rsiOversold: 30, // tune from live data
  emaCrossMinGap: 0, // tune from live data (0 = exact EMA sign change = today's behaviour)
} as const satisfies SetupThresholds;

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

/** Wake-up band policy (ADR 0003): fallback derivation + manager cooldown. */
export const WAKE = {
  /** Fraction of the distance to stop/TP at which the fallback band sits. */
  fallbackFraction: 0.5,
  /** Minimum minutes between two band-triggered manager calls. */
  cooldownMinutes: 15,
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
  wakeAbove?: number;
  wakeBelow?: number;
  /** Trading days the order stays valid (1–5, default 1 = today only). Stufe 1. */
  ttlDays?: number;
  thesis: string;
}

/** An adjustment Mr Ape (Sonnet) may request at a tick. */
export type Adjustment =
  | { type: "set_stop"; positionId: string; price: number }
  | { type: "set_take_profit"; positionId: string; price: number | null }
  | { type: "set_wake_band"; positionId: string; above: number | null; below: number | null }
  | { type: "close_position"; positionId: string }
  | { type: "cancel_order"; orderId: string };

export type TickEvent =
  | { kind: "entry-filled"; position: Position }
  | { kind: "order-expired"; order: EntryOrder }
  | { kind: "position-closed"; trade: ClosedTrade };

export function freshPortfolio(startBalance: number): Portfolio {
  return { balance: startBalance, positions: [], orders: [], history: [] };
}

/** A deterministic intraday setup the Setup-Radar can fire on (Stufe 2). Close-based only. */
export type SetupKind = "ema-cross-up" | "ema-cross-down" | "rsi-overbought" | "rsi-oversold";

/** A fired setup trigger for a watched (non-held) ticker. */
export interface SetupTrigger {
  ticker: string;
  kind: SetupKind;
  price: number;
  note: string;
}

/** One non-held ticker the Kür flagged as worth watching intraday (Stufe 2). */
export interface WatchlistEntry {
  ticker: string;
  /** Directional bias from the dossier, if any. */
  side?: Side;
  /** Why it is watched (dossier angle/catalyst) — shown in the alert. */
  note: string;
  /** Berlin day this entry was seeded. */
  addedDay: string;
  /** Setup kinds already fired+posted today (consumed once per kind per day). */
  firedKinds: SetupKind[];
}

/** The intraday watchlist for one Berlin day (Stufe 2). Reseeded each Kür. */
export interface WatchlistState {
  day: string;
  entries: WatchlistEntry[];
  /** Previous watchlist tick's quotes — the baseline for cross detection. */
  lastQuotes?: QuoteMap;
}
