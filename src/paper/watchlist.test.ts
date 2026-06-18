import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entriesForDay, loadWatchlist, saveWatchlist, seedWatchlist } from "./watchlist";

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

describe("entriesForDay", () => {
  it("returns entries only for the matching day, [] otherwise", () => {
    const state = seedWatchlist("2026-06-09", [{ ticker: "AAPL", note: "", addedDay: "", firedKinds: [] }]);
    expect(entriesForDay(state, "2026-06-09")).toHaveLength(1);
    expect(entriesForDay(state, "2026-06-10")).toEqual([]); // stale
    expect(entriesForDay(null, "2026-06-09")).toEqual([]);
  });
});
