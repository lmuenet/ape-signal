import { describe, expect, it, vi } from "vitest";
import { runSetupRadar, type RadarDeps } from "./radar";
import { berlinDay, berlinStamp } from "./store";
import { freshPortfolio, type Portfolio, type QuoteMap, type TickQuote, type WatchlistState } from "./types";

const NOW = new Date("2026-06-09T15:00:00Z");
const DAY = "2026-06-09";
const tq = (over: Partial<TickQuote> = {}): TickQuote => ({ close: 100, changePct: 0, high: 101, low: 99, ...over });

// prev: EMA10 below EMA20; now: EMA10 above → ema-cross-up
const watchlist = (over: Partial<WatchlistState> = {}): WatchlistState => ({
  day: DAY,
  entries: [{ ticker: "AMD", note: "Pullback", addedDay: DAY, firedKinds: [] }],
  lastQuotes: { AMD: tq({ ema10: 99, ema20: 100 }) },
  ...over,
});
const nowQuotes: QuoteMap = { AMD: tq({ close: 105, ema10: 101, ema20: 100 }) };

function makeDeps(over: Partial<RadarDeps> = {}, p: Portfolio = freshPortfolio(1000)) {
  const saved: WatchlistState[] = [];
  const sent: string[] = [];
  const journal: Array<[string, string]> = [];
  const deps: RadarDeps = {
    loadPortfolio: () => p,
    loadWatchlist: () => watchlist(),
    saveWatchlist: (s) => saved.push(s),
    fetchQuotes: vi.fn(async () => nowQuotes),
    appendJournal: (t, b) => journal.push([t, b]),
    send: vi.fn(async (t: string) => {
      sent.push(t);
    }),
    now: () => NOW,
    berlinDay,
    berlinStamp,
    ...over,
  };
  return { deps, saved, sent, journal };
}

describe("runSetupRadar", () => {
  it("posts a fired trigger, consumes the kind and refreshes the cross baseline", async () => {
    const { deps, saved, sent } = makeDeps();
    await runSetupRadar(deps);
    expect(sent[0]).toContain("⚡ Setup AMD");
    expect(saved[0].entries[0].firedKinds).toContain("ema-cross-up");
    expect(saved[0].lastQuotes?.AMD.close).toBe(105);
  });

  it("stays idle when the watchlist is from another day", async () => {
    const { deps, saved, sent } = makeDeps({ loadWatchlist: () => watchlist({ day: "2026-06-08" }) });
    await runSetupRadar(deps);
    expect(sent).toHaveLength(0);
    expect(saved).toHaveLength(0);
    expect(deps.fetchQuotes).not.toHaveBeenCalled();
  });

  it("skips tickers that are now held (the tick manages those)", async () => {
    const held: Portfolio = {
      ...freshPortfolio(1000),
      positions: [{ id: "AMD-x", ticker: "AMD", side: "long", stake: 100, leverage: 1, entryPrice: 100, units: 1, stopLoss: 90, openedAt: NOW.toISOString(), thesis: "" }],
    };
    const { deps, sent } = makeDeps({}, held);
    await runSetupRadar(deps);
    expect(deps.fetchQuotes).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("stays silent on a quote-fetch failure (best-effort)", async () => {
    const { deps, sent, saved } = makeDeps({
      fetchQuotes: vi.fn(async () => {
        throw new Error("scanner down");
      }),
    });
    await runSetupRadar(deps);
    expect(sent).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it("invokes the gated intraday opener once per fired trigger when wired", async () => {
    const intraday = vi.fn(async () => {});
    const { deps } = makeDeps({ intraday });
    await runSetupRadar(deps);
    expect(intraday).toHaveBeenCalledTimes(1);
    expect((intraday.mock.calls[0][0] as { ticker: string }).ticker).toBe("AMD");
  });

  it("does not re-fire a kind already consumed today (still refreshes the baseline)", async () => {
    const { deps, sent, saved } = makeDeps({
      loadWatchlist: () => watchlist({ entries: [{ ticker: "AMD", note: "x", addedDay: DAY, firedKinds: ["ema-cross-up"] }] }),
    });
    await runSetupRadar(deps);
    expect(sent).toHaveLength(0);
    expect(saved[0].lastQuotes?.AMD.close).toBe(105);
  });
});
