import { describe, expect, it, vi } from "vitest";
import { runTick, type TickDeps } from "./tickPipeline";
import { berlinDay, berlinStamp } from "./store";
import { freshPortfolio, type EntryOrder, type Portfolio, type Position, type QuoteMap } from "./types";

const NOW = new Date("2026-06-09T14:00:00Z"); // 16:00 Berlin, US session

function position(over: Partial<Position> = {}): Position {
  return {
    id: "NVDA-2026-06-09-1",
    ticker: "NVDA",
    side: "long",
    stake: 200,
    leverage: 3,
    entryPrice: 100,
    units: 6,
    stopLoss: 95,
    openedAt: "2026-06-08T15:30:00.000Z",
    thesis: "t",
    ...over,
  };
}

function order(over: Partial<EntryOrder> = {}): EntryOrder {
  return {
    id: "TSLA-2026-06-09-1",
    ticker: "TSLA",
    side: "long",
    stake: 100,
    leverage: 2,
    entryType: "market",
    stopLoss: 180,
    thesis: "t",
    createdAt: NOW.toISOString(),
    day: "2026-06-09",
    ...over,
  };
}

function makeDeps(p: Portfolio, quotes: QuoteMap, claudeRaw = '{"adjustments": [], "journal": null}') {
  const saved: Portfolio[] = [];
  const journal: Array<[string, string]> = [];
  const sent: string[] = [];
  const deps: TickDeps = {
    loadPortfolio: () => p,
    savePortfolio: (x) => saved.push(x),
    appendJournal: (title, body) => journal.push([title, body]),
    readJournalTail: () => "",
    fetchQuotes: vi.fn(async () => quotes),
    claudeRunner: vi.fn(async () => claudeRaw),
    send: vi.fn(async (t: string) => {
      sent.push(t);
    }),
    now: () => NOW,
    berlinDay,
    berlinStamp,
  };
  return { deps, saved, journal, sent };
}

describe("runTick", () => {
  it("does nothing on an empty depot (no fetch, no save, no telegram)", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), {});
    await runTick({ isClose: false }, deps);
    expect(deps.fetchQuotes).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("fills a market order, posts the event, journals it and saves", async () => {
    const p: Portfolio = { ...freshPortfolio(900), orders: [order()] };
    const { deps, saved, journal, sent } = makeDeps(p, { TSLA: { close: 200, changePct: 0, high: 201, low: 199 } });
    await runTick({ isClose: false }, deps);
    expect(saved.at(-1)?.positions).toHaveLength(1);
    expect(sent[0]).toContain("Eröffnet: TSLA");
    expect(journal[0][1]).toContain("TSLA");
  });

  it("applies a valid Sonnet stop adjustment and journals Mr Ape's note", async () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position()], lastTick: { at: "x", day: "2026-06-09", quotes: { NVDA: { close: 108, changePct: 0, high: 109, low: 99 } } } };
    const raw = JSON.stringify({
      adjustments: [{ type: "set_stop", positionId: position().id, price: 102 }],
      journal: "Stop nachgezogen, Gewinn absichern.",
    });
    const { deps, saved, journal, sent } = makeDeps(p, { NVDA: { close: 110, changePct: 1, high: 111, low: 99 } }, raw);
    await runTick({ isClose: false }, deps);
    expect(saved.at(-1)?.positions[0].stopLoss).toBe(102);
    expect(journal.some(([, body]) => body.includes("Stop nachgezogen"))).toBe(true);
    expect(sent).toHaveLength(0); // stop adjustments are journal-only
  });

  it("posts a Mr-Ape-initiated close to Telegram", async () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position()], lastTick: { at: "x", day: "2026-06-09", quotes: { NVDA: { close: 108, changePct: 0, high: 109, low: 99 } } } };
    const raw = JSON.stringify({
      adjustments: [{ type: "close_position", positionId: position().id }],
      journal: "These tot, raus hier.",
    });
    const { deps, saved, sent } = makeDeps(p, { NVDA: { close: 110, changePct: 1, high: 111, low: 99 } }, raw);
    await runTick({ isClose: false }, deps);
    expect(saved.at(-1)?.positions).toHaveLength(0);
    expect(sent.some((m) => m.includes("Geschlossen"))).toBe(true);
  });

  it("survives a Claude failure — fills are already saved, stops untouched", async () => {
    const p: Portfolio = { ...freshPortfolio(900), orders: [order()] };
    const { deps, saved, sent } = makeDeps(p, { TSLA: { close: 200, changePct: 0, high: 201, low: 199 } });
    (deps.claudeRunner as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    await runTick({ isClose: false }, deps);
    expect(saved.at(-1)?.positions).toHaveLength(1);
    expect(sent.some((m) => m.includes("Eröffnet"))).toBe(true);
  });

  it("skips the tick entirely when quotes fail (state untouched)", async () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position()] };
    const { deps, saved, sent } = makeDeps(p, {});
    (deps.fetchQuotes as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("429"));
    await runTick({ isClose: false }, deps);
    expect(saved).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("posts the daily summary on the closing tick when there was activity", async () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position()] };
    const { deps, sent } = makeDeps(p, { NVDA: { close: 110, changePct: 1, high: 111, low: 99 } });
    await runTick({ isClose: true }, deps);
    expect(sent.some((m) => m.includes("Tagesabschluss"))).toBe(true);
  });

  it("expires day orders on the closing tick", async () => {
    const p: Portfolio = {
      ...freshPortfolio(900),
      orders: [order({ entryType: "limit", limitPrice: 150 })],
      lastTick: { at: "x", day: "2026-06-09", quotes: { TSLA: { close: 200, changePct: 0, high: 201, low: 199 } } },
    };
    const { deps, saved, sent } = makeDeps(p, { TSLA: { close: 200, changePct: 0, high: 201, low: 199 } });
    await runTick({ isClose: true }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(0);
    expect(saved.at(-1)?.balance).toBe(1000);
    expect(sent.some((m) => m.includes("Order verfallen"))).toBe(true);
  });
});
