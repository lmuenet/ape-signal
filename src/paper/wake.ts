// src/paper/wake.ts — wake-up bands (ADR 0003): soft thresholds that wake the
// manager (Sonnet) without ever trading. Pure functions only.
import { WAKE, type Portfolio, type Position, type QuoteMap } from "./types";

export interface WakeBreach {
  positionId: string;
  ticker: string;
  side: "above" | "below";
  level: number;
  price: number;
}

/**
 * Fallback bands when Mr Ape set none: half the distance to the stop on the
 * losing side; half the distance to the take-profit on the winning side
 * (mirroring the stop distance when there is no TP).
 */
export function deriveBands(pos: Position, price: number): { above: number; below: number } {
  const stopDist = Math.abs(price - pos.stopLoss);
  const tpDist = pos.takeProfit !== undefined ? Math.abs(pos.takeProfit - price) : stopDist;
  return pos.side === "long"
    ? { below: price - stopDist * WAKE.fallbackFraction, above: price + tpDist * WAKE.fallbackFraction }
    : { above: price + stopDist * WAKE.fallbackFraction, below: price - tpDist * WAKE.fallbackFraction };
}

/** Breaches at the current close. Positions without quote or band are silent. */
export function checkWakeBands(positions: Position[], quotes: QuoteMap): WakeBreach[] {
  const breaches: WakeBreach[] = [];
  for (const pos of positions) {
    const q = quotes[pos.ticker];
    if (!q) continue;
    if (pos.wakeAbove !== undefined && q.close >= pos.wakeAbove) {
      breaches.push({ positionId: pos.id, ticker: pos.ticker, side: "above", level: pos.wakeAbove, price: q.close });
    } else if (pos.wakeBelow !== undefined && q.close <= pos.wakeBelow) {
      breaches.push({ positionId: pos.id, ticker: pos.ticker, side: "below", level: pos.wakeBelow, price: q.close });
    }
  }
  return breaches;
}

/** A breached band is consumed: both sides are cleared (it never wakes twice). */
export function consumeBands(p: Portfolio, breaches: WakeBreach[]): Portfolio {
  const breached = new Set(breaches.map((b) => b.positionId));
  return {
    ...p,
    positions: p.positions.map((pos) => {
      if (!breached.has(pos.id)) return pos;
      const { wakeAbove: _a, wakeBelow: _b, ...rest } = pos;
      return rest;
    }),
  };
}

/** Give every quoted position missing BOTH band sides a derived band. */
export function ensureBands(p: Portfolio, quotes: QuoteMap): { portfolio: Portfolio; changed: boolean } {
  let changed = false;
  const positions = p.positions.map((pos) => {
    if (pos.wakeAbove !== undefined || pos.wakeBelow !== undefined) return pos;
    const q = quotes[pos.ticker];
    if (!q) return pos;
    changed = true;
    const bands = deriveBands(pos, q.close);
    return { ...pos, wakeAbove: bands.above, wakeBelow: bands.below };
  });
  return { portfolio: changed ? { ...p, positions } : p, changed };
}
