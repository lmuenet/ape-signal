import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entriesForDay, loadWatchlist, mergeWatchlist, saveWatchlist, seedWatchlist } from "./watchlist";
import type { WatchlistState } from "./types";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ape-watch-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("watchlist store", () => {
  it("returns null when there is no watchlist file", () => {
    expect(loadWatchlist(dir)).toBeNull();
  });

  it("round-trips a saved watchlist state", () => {
    const state = seedWatchlist("2026-06-09", [{ ticker: "AAPL", note: "a", addedDay: "x", firedKinds: [] }]);
    saveWatchlist(dir, state);
    expect(loadWatchlist(dir)).toEqual(state);
  });

  it("returns null on a corrupt file (radar stays idle, never throws)", () => {
    writeFileSync(join(dir, "watchlist.json"), "{ not json", "utf8");
    expect(loadWatchlist(dir)).toBeNull();
  });
});

describe("seedWatchlist", () => {
  it("dedupes by ticker, uppercases, resets day/firedKinds", () => {
    const s = seedWatchlist("2026-06-09", [
      { ticker: "aapl", note: "x", addedDay: "old", firedKinds: ["ema-cross-up"], side: "long" },
      { ticker: "AAPL", note: "dup", addedDay: "old", firedKinds: [] },
      { ticker: "", note: "junk", addedDay: "old", firedKinds: [] },
    ]);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ ticker: "AAPL", addedDay: "2026-06-09", firedKinds: [], side: "long" });
  });
});

describe("mergeWatchlist (Doppel-Kür, Beschluss 2026-07-02)", () => {
  const existing: WatchlistState = {
    day: "2026-07-02",
    entries: [{ ticker: "TSLA", note: "alt", addedDay: "2026-07-02", firedKinds: ["ema-cross-up"] }],
    lastQuotes: { TSLA: { close: 375, changePct: 0, high: 380, low: 370 } },
  };

  it("keeps same-day entries (with firedKinds + baseline) and appends only new tickers", () => {
    const merged = mergeWatchlist(existing, "2026-07-02", [
      { ticker: "tsla", note: "neu", addedDay: "", firedKinds: [] },
      { ticker: "RDDT", note: "n", addedDay: "", firedKinds: [] },
    ]);
    expect(merged.entries).toHaveLength(2);
    expect(merged.entries[0]).toMatchObject({ ticker: "TSLA", note: "alt", firedKinds: ["ema-cross-up"] });
    expect(merged.entries[1]).toMatchObject({ ticker: "RDDT", firedKinds: [] });
    expect(merged.lastQuotes).toEqual(existing.lastQuotes);
  });

  it("starts fresh for another day or without state", () => {
    const merged = mergeWatchlist(existing, "2026-07-03", [{ ticker: "NEW", note: "", addedDay: "", firedKinds: [] }]);
    expect(merged.entries.map((e) => e.ticker)).toEqual(["NEW"]);
    expect(merged.lastQuotes).toBeUndefined();
    expect(mergeWatchlist(null, "2026-07-03", []).entries).toEqual([]);
  });
});

describe("entriesForDay", () => {
  it("returns entries only for the matching day, [] otherwise", () => {
    const state = seedWatchlist("2026-06-09", [{ ticker: "AAPL", note: "", addedDay: "", firedKinds: [] }]);
    expect(entriesForDay(state, "2026-06-09")).toHaveLength(1);
    expect(entriesForDay(state, "2026-06-10")).toEqual([]); // stale
    expect(entriesForDay(null, "2026-06-09")).toEqual([]);
  });
});
