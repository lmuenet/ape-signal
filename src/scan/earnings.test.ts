// src/scan/earnings.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchEarningsToday } from "./earnings";

describe("fetchEarningsToday", () => {
  it("returns only tickers whose next earnings date is today", async () => {
    const today = "2026-06-02";
    const now = new Date(`${today}T08:00:00Z`).getTime();
    const fetchEarnings = vi.fn(async (ticker: string) => {
      if (ticker === "AAPL") return { date: today, epsEstimate: 1.2 };
      if (ticker === "TSLA") return { date: "2026-07-01", epsEstimate: null };
      return null;
    });
    const out = await fetchEarningsToday(["AAPL", "TSLA", "GME"], { fetchEarnings, now });
    expect(out).toEqual([{ ticker: "AAPL", date: today, epsEstimate: 1.2 }]);
  });

  it("tolerates per-ticker fetch errors", async () => {
    const today = "2026-06-02";
    const now = new Date(`${today}T08:00:00Z`).getTime();
    const fetchEarnings = vi.fn(async (ticker: string) => {
      if (ticker === "BOOM") throw new Error("500");
      return { date: today, epsEstimate: null };
    });
    const out = await fetchEarningsToday(["BOOM", "AAPL"], { fetchEarnings, now });
    expect(out.map((e) => e.ticker)).toEqual(["AAPL"]);
  });
});
