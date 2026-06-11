// src/ui/series.ts — chartable series derived from the portfolio. Realized
// equity only: open positions are NOT marked to market here (the header shows
// live equity separately, via the engine's equity() on lastTick quotes).
import type { Portfolio } from "../paper/types";

export interface EquityPoint {
  at: string;
  equity: number;
}

export function equitySeries(p: Portfolio, startBalance: number): EquityPoint[] {
  const sorted = [...p.history].sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  const startAt = sorted.map((t) => t.openedAt).sort()[0] ?? new Date().toISOString();
  const out: EquityPoint[] = [{ at: startAt, equity: startBalance }];
  let equity = startBalance;
  for (const t of sorted) {
    equity += t.pnl - (t.fees ?? 0);
    out.push({ at: t.closedAt, equity });
  }
  return out;
}
