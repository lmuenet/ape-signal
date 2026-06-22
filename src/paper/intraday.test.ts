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
const DOSSIER = JSON.stringify({
  candidates: [{ ticker: "AMD", angle: "Long auf Pullback", catalyst: "Momentum", sentiment: "bullisch" }],
  marketContext: "SPY ruhig",
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
    researchRunner: vi.fn(async () => DOSSIER),
    decideRunner: vi.fn(async () => LIMIT_DECISION),
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
  it("runs research → Opus decide, places the order, posts start-ping + result", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000));
    await runIntradayOpportunity(trigger, deps);
    expect(deps.researchRunner).toHaveBeenCalled();
    expect(deps.decideRunner).toHaveBeenCalled();
    expect(saved.at(-1)?.orders).toHaveLength(1);
    expect(saved.at(-1)?.orders[0].source).toBe("intraday");
    expect(saved.at(-1)?.orders[0].entryType).toBe("limit");
    expect(saved.at(-1)?.orders[0].limitPrice).toBe(99);
    expect(sent.some((m) => m.includes("prüft Intraday-Chance AMD"))).toBe(true); // start-ping
    expect(sent.some((m) => m.includes("Intraday-Limit gesetzt"))).toBe(true); // result
  });

  it("ALWAYS posts an outcome when Opus declines (kein Trade)", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), {
      decideRunner: vi.fn(async () => '{"trades":[],"journal":"Kein klares Setup."}'),
    });
    await runIntradayOpportunity(trigger, deps);
    expect(saved).toHaveLength(0);
    expect(sent.some((m) => m.includes("kein Trade"))).toBe(true);
  });

  it("posts a 'nicht entschieden' note on a Claude limit (never a guessed trade)", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), {
      decideRunner: vi.fn(async () => {
        throw new ClaudeLimitError("usage limit reached", "Intraday-Entscheidung");
      }),
    });
    await runIntradayOpportunity(trigger, deps);
    expect(saved).toHaveLength(0);
    expect(sent.some((m) => m.includes("nicht entschieden"))).toBe(true);
  });

  it("decides anyway when research fails (degrade), still posting an outcome", async () => {
    const { deps, sent } = makeDeps(freshPortfolio(1000), {
      researchRunner: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    await runIntradayOpportunity(trigger, deps);
    expect(deps.decideRunner).toHaveBeenCalled();
    expect(sent.some((m) => m.includes("Intraday-Limit gesetzt") || m.includes("kein Trade"))).toBe(true);
  });

  it("refuses a market entry (limit-only) and says so", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), {
      decideRunner: vi.fn(async () => JSON.stringify({ trades: [{ ticker: "AMD", side: "long", stake: 100, leverage: 1, entry: "market", stopLoss: 94, thesis: "x" }], journal: "" })),
    });
    await runIntradayOpportunity(trigger, deps);
    expect(saved).toHaveLength(0);
    expect(sent.some((m) => m.includes("nur Limit"))).toBe(true);
  });

  it("does not call any LLM when the ticker is already held (no doubling)", async () => {
    const held: Portfolio = {
      ...freshPortfolio(1000),
      positions: [{ id: "AMD-x", ticker: "AMD", side: "long", stake: 100, leverage: 1, entryPrice: 100, units: 1, stopLoss: 90, openedAt: NOW.toISOString(), thesis: "" }],
    };
    const { deps, sent } = makeDeps(held);
    await runIntradayOpportunity(trigger, deps);
    expect(deps.researchRunner).not.toHaveBeenCalled();
    expect(deps.decideRunner).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("does not call any LLM when the intraday budget tier is used", async () => {
    const used: Portfolio = { ...freshPortfolio(1000), orders: [intradayOrder()] };
    const { deps, sent } = makeDeps(used);
    await runIntradayOpportunity(trigger, deps);
    expect(deps.researchRunner).not.toHaveBeenCalled();
    expect(deps.decideRunner).not.toHaveBeenCalled();
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
