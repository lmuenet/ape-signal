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

  it("applies a Sonnet stop adjustment after a band breach and posts the bundled note", async () => {
    // wakeAbove 109 < close 110 → breach wakes the manager (ADR 0003)
    const p: Portfolio = { ...freshPortfolio(800), positions: [position({ wakeAbove: 109, wakeBelow: 100 })], lastTick: { at: "x", day: "2026-06-09", quotes: { NVDA: { close: 108, changePct: 0, high: 109, low: 99 } } } };
    const raw = JSON.stringify({
      adjustments: [{ type: "set_stop", positionId: position().id, price: 102 }],
      journal: "Stop nachgezogen, Gewinn absichern.",
    });
    const { deps, saved, journal, sent } = makeDeps(p, { NVDA: { close: 110, changePct: 1, high: 111, low: 99 } }, raw);
    await runTick({ isClose: false }, deps);
    expect(saved.at(-1)?.positions[0].stopLoss).toBe(102);
    expect(journal.some(([, body]) => body.includes("Stop nachgezogen"))).toBe(true);
    const bundle = sent.find((m) => m.includes("Manager-Tick"));
    expect(bundle).toContain("Stop nachgezogen");
    expect(bundle).toContain("🔧 Stop von NVDA-2026-06-09-1 auf 102");
  });

  it("posts a Mr-Ape-initiated close to Telegram (inside the bundle)", async () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position({ wakeAbove: 109 })], lastTick: { at: "x", day: "2026-06-09", quotes: { NVDA: { close: 108, changePct: 0, high: 109, low: 99 } } } };
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

describe("monitor/manager split (ADR 0003)", () => {
  const NOW_ISO = NOW.toISOString();
  const prevTick = { at: "x", day: "2026-06-09", quotes: { NVDA: { close: 108, changePct: 0, high: 109, low: 99 } } };

  it("silent monitor tick: inside the band → no Sonnet call, no Telegram", async () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position({ wakeAbove: 120, wakeBelow: 90 })], lastTick: prevTick };
    const { deps, sent } = makeDeps(p, { NVDA: { close: 110, changePct: 1, high: 111, low: 99 } });
    await runTick({ isClose: false }, deps);
    expect(deps.claudeRunner).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("band breach wakes the manager, consumes the band and stamps the cooldown", async () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position({ wakeAbove: 109, wakeBelow: 90 })], lastTick: prevTick };
    const { deps, saved } = makeDeps(p, { NVDA: { close: 110, changePct: 1, high: 111, low: 99 } });
    await runTick({ isClose: false }, deps);
    expect(deps.claudeRunner).toHaveBeenCalledTimes(1);
    const final = saved.at(-1)!;
    expect(final.lastManagerCallAt).toBe(NOW_ISO);
  });

  it("band breach inside the cooldown does NOT wake the manager", async () => {
    const p: Portfolio = {
      ...freshPortfolio(800),
      positions: [position({ wakeAbove: 109, wakeBelow: 90 })],
      lastTick: prevTick,
      lastManagerCallAt: "2026-06-09T13:50:00.000Z", // 10 min ago < 15 min cooldown
    };
    const { deps } = makeDeps(p, { NVDA: { close: 110, changePct: 1, high: 111, low: 99 } });
    await runTick({ isClose: false }, deps);
    expect(deps.claudeRunner).not.toHaveBeenCalled();
  });

  it("a hard event (stop fill) wakes the manager even inside the cooldown", async () => {
    // P1 stops out at 95 (new day low); P2 (deep stop) survives, so there is
    // still something to manage — the event must bypass the band cooldown.
    const survivor = position({ id: "NVDA-2026-06-09-2", stopLoss: 70, wakeAbove: 200, wakeBelow: 75 });
    const p: Portfolio = {
      ...freshPortfolio(800),
      positions: [position(), survivor],
      lastTick: prevTick,
      lastManagerCallAt: "2026-06-09T13:59:00.000Z", // 1 min ago — inside the cooldown
    };
    const { deps, sent } = makeDeps(p, { NVDA: { close: 96, changePct: -2, high: 109, low: 94 } });
    await runTick({ isClose: false }, deps);
    expect(sent.some((m) => m.includes("Stop-Loss"))).toBe(true);
    expect(deps.claudeRunner).toHaveBeenCalledTimes(1);
  });

  it("derives fallback bands for positions without bands", async () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position()], lastTick: prevTick };
    const { deps, saved } = makeDeps(p, { NVDA: { close: 110, changePct: 1, high: 111, low: 99 } });
    await runTick({ isClose: false }, deps);
    const final = saved.at(-1)!;
    // stop 95, close 110, no TP → stopDist 15 → below 102.5, above 117.5
    expect(final.positions[0]?.wakeBelow).toBe(102.5);
    expect(final.positions[0]?.wakeAbove).toBe(117.5);
  });

  it("close tick always wakes the manager and posts the summary", async () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position({ wakeAbove: 120, wakeBelow: 90 })], lastTick: prevTick };
    const { deps, sent } = makeDeps(p, { NVDA: { close: 110, changePct: 1, high: 111, low: 99 } });
    await runTick({ isClose: true }, deps);
    expect(deps.claudeRunner).toHaveBeenCalledTimes(1);
    expect(sent.some((m) => m.includes("Tagesabschluss"))).toBe(true);
  });
});
