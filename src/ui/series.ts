// src/ui/series.ts — chartable series derived from the portfolio. Realized
// equity only: open positions are NOT marked to market here (the header shows
// live equity separately, via the engine's equity() on lastTick quotes).
import { berlinParts } from "../config/marketCalendar";
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

/** One row of the "how we trade ourselves up" table — one per Berlin trading day. */
export interface DailyPerformancePoint {
  day: string; // Berlin civil date "YYYY-MM-DD" the trades closed on
  equity: number; // realized equity at that day's last close
  realizedPnl: number; // net realized P&L booked that day (pnl - fees), summed
  trades: number; // trades closed that day
  cumulativePnl: number; // realized equity - startBalance (P&L since start)
  returnPct: number; // cumulativePnl as a percent of startBalance
}

/**
 * Per-day realized performance, oldest day first. Groups closed trades by the
 * Europe/Berlin civil date of their close (same realized-only basis as
 * equitySeries: open positions are not marked to market). The cumulative
 * columns run forward from startBalance, so the last row's equity matches the
 * equity series' final point.
 */
export function dailyPerformance(p: Portfolio, startBalance: number): DailyPerformancePoint[] {
  const byDay = new Map<string, { realizedPnl: number; trades: number }>();
  for (const t of p.history) {
    const day = berlinParts(new Date(t.closedAt)).day;
    const agg = byDay.get(day) ?? { realizedPnl: 0, trades: 0 };
    agg.realizedPnl += t.pnl - (t.fees ?? 0);
    agg.trades += 1;
    byDay.set(day, agg);
  }
  const days = [...byDay.keys()].sort(); // ISO day strings sort chronologically
  const out: DailyPerformancePoint[] = [];
  let equity = startBalance;
  for (const day of days) {
    const agg = byDay.get(day)!;
    equity += agg.realizedPnl;
    out.push({
      day,
      equity,
      realizedPnl: agg.realizedPnl,
      trades: agg.trades,
      cumulativePnl: equity - startBalance,
      returnPct: startBalance > 0 ? ((equity - startBalance) / startBalance) * 100 : 0,
    });
  }
  return out;
}
