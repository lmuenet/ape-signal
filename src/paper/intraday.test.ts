import { describe, expect, it, vi } from "vitest";
import { intradayGateOpen, runIntradayOpportunity, type IntradayDeps } from "./intraday";
import { berlinDay, berlinStamp } from "./store";
import { freshPortfolio, type Portfolio, type QuoteMap, type SetupTrigger } from "./types";
import { ClaudeLimitError } from "../claude/invoke";

const NOW = new Date("2026-06-09T15:00:00Z"); // 17:00 Berlin
const DAY = "2026-06-09";
const trigger: SetupTrigger = { ticker: "AMD", kind: "ema-cross-up", price: 100, note: "EMA10×EMA20 ↑ — Pullback" };
const quotes: QuoteMap = { AMD: { close: 100, changePct: 1, high: 101, low: 99 } };
const LIMIT_DECISION = JSON.stringify({
  trades: [{ ticker: "AMD", side: "long", stake: 150, leverage: 2, entry: 99, stopLoss: 94, thesis: "EMA-Cross bestätigt den Pullback" }],
  journal: "Setze ein Limit knapp unter Markt.",
});

function makeDeps(p: Portfolio, over: Partial<IntradayDeps> = {}) {
  const saved: Portfolio[] = [];
  const sent: string[] = [];
  const journal: Array<[string, string]> = [];
  const deps: IntradayDeps = {
    loadPortfolio: () => p,
    savePortfolio: (x) => saved.push(x),
    appendJournal: (t, b) => journal.push([t, b]),
    readJournalTail: () => "",
    fetchQuotes: vi.fn(async () => quotes),
    runner: vi.fn(async () => LIMIT_DECISION),
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

const intradayOrder = (over = {}) => ({
  id: "X-1", ticker: "X", side: "long" as const, stake: 100, leverage: 1,
  entryType: "limit" as const, limitPrice: 50, stopLoss: 40, thesis: "",
  createdAt: NOW.toISOString(), day: DAY, source: "intraday" as const, ...over,
});

describe("runIntradayOpportunity", () => {
  it("places a limit order tagged source=intraday and posts to Telegram", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000));
    await runIntradayOpportunity(trigger, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1);
    expect(saved.at(-1)?.orders[0].source).toBe("intraday");
    expect(saved.at(-1)?.orders[0].entryType).toBe("limit");
    expect(saved.at(-1)?.orders[0].limitPrice).toBe(99);
    expect(sent[0]).toContain("Intraday-Chance AMD");
  });

  it("does nothing (no order, no post) when Mr Ape declines", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), {
      runner: vi.fn(async () => '{"trades":[],"journal":"Kein klares Setup."}'),
    });
    await runIntradayOpportunity(trigger, deps);
    expect(saved).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("refuses a market entry (limit-only) without placing", async () => {
    const { deps, saved } = makeDeps(freshPortfolio(1000), {
      runner: vi.fn(async () => JSON.stringify({ trades: [{ ticker: "AMD", side: "long", stake: 100, leverage: 1, entry: "market", stopLoss: 94, thesis: "x" }], journal: "" })),
    });
    await runIntradayOpportunity(trigger, deps);
    expect(saved).toHaveLength(0);
  });

  it("does not call the LLM when the ticker is already held (no doubling)", async () => {
    const held: Portfolio = {
      ...freshPortfolio(1000),
      positions: [{ id: "AMD-x", ticker: "AMD", side: "long", stake: 100, leverage: 1, entryPrice: 100, units: 1, stopLoss: 90, openedAt: NOW.toISOString(), thesis: "" }],
    };
    const { deps } = makeDeps(held);
    await runIntradayOpportunity(trigger, deps);
    expect(deps.runner).not.toHaveBeenCalled();
  });

  it("does not call the LLM when the intraday budget tier is used", async () => {
    const used: Portfolio = { ...freshPortfolio(1000), orders: [intradayOrder()] };
    const { deps } = makeDeps(used);
    await runIntradayOpportunity(trigger, deps);
    expect(deps.runner).not.toHaveBeenCalled();
  });

  it("degrades silently on a Claude limit (no order, deterministic protection elsewhere)", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), {
      runner: vi.fn(async () => {
        throw new ClaudeLimitError("usage limit reached", "Intraday");
      }),
    });
    await runIntradayOpportunity(trigger, deps);
    expect(saved).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});

describe("intradayGateOpen", () => {
  it("is open on a fresh depot and closed once an intraday trade exists", () => {
    expect(intradayGateOpen(freshPortfolio(1000), DAY, "AMD")).toBe(true);
    const used: Portfolio = { ...freshPortfolio(1000), orders: [intradayOrder()] };
    expect(intradayGateOpen(used, DAY, "AMD")).toBe(false);
  });
});
