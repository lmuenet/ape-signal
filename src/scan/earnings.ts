// src/scan/earnings.ts
import type { EarningsDate } from "../core/ape-intel";

export interface EarningsRow {
  ticker: string;
  date: string;
  epsEstimate: number | null;
}

export interface EarningsDeps {
  fetchEarnings: (ticker: string) => Promise<EarningsDate | null>;
  now: number;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** For each ticker, keep it only if its NEXT earnings date equals today. Per-ticker errors are skipped. */
export async function fetchEarningsToday(
  tickers: string[],
  deps: EarningsDeps,
): Promise<EarningsRow[]> {
  const today = ymd(deps.now);
  const rows: EarningsRow[] = [];
  for (const ticker of tickers) {
    try {
      const next = await deps.fetchEarnings(ticker);
      if (next && next.date === today) {
        rows.push({ ticker, date: next.date, epsEstimate: next.epsEstimate });
      }
    } catch (err) {
      console.error(`[earnings] ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return rows;
}
