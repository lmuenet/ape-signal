// src/paper/watchlist.ts — persistence for the intraday Setup-Radar watchlist
// (Stufe 2). One state per Berlin day, reseeded by the Kür; lives in DATA_DIR
// (gitignored) next to portfolio.json. Atomic save (temp + rename), like store.ts.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WatchlistEntry, WatchlistState } from "./types";

const WATCHLIST_FILE = "watchlist.json";

/** Load the watchlist state, or null if absent/corrupt (radar simply stays idle). */
export function loadWatchlist(dir: string): WatchlistState | null {
  const path = join(dir, WATCHLIST_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as WatchlistState;
    if (typeof parsed.day !== "string" || !Array.isArray(parsed.entries)) return null;
    return { ...parsed, entries: parsed.entries.map((e) => ({ ...e, firedKinds: e.firedKinds ?? [] })) };
  } catch {
    return null;
  }
}

/** Atomic save: write a temp file, then rename over the target. */
export function saveWatchlist(dir: string, state: WatchlistState): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, WATCHLIST_FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

/**
 * The entries to watch for `day`, or [] if the stored watchlist is from another
 * day (stale → ignored; the radar only acts on a watchlist seeded the same day).
 */
export function entriesForDay(state: WatchlistState | null, day: string): WatchlistEntry[] {
  return state && state.day === day ? state.entries : [];
}

/** Build a fresh watchlist state for `day` from seed entries (dedup by ticker). */
export function seedWatchlist(day: string, entries: WatchlistEntry[]): WatchlistState {
  const seen = new Set<string>();
  const deduped: WatchlistEntry[] = [];
  for (const e of entries) {
    const ticker = e.ticker.toUpperCase().trim();
    if (ticker === "" || seen.has(ticker)) continue;
    seen.add(ticker);
    deduped.push({ ...e, ticker, addedDay: day, firedKinds: [] });
  }
  return { day, entries: deduped };
}

/**
 * Merge new seed entries into an existing SAME-DAY state (Beschluss 2026-07-02,
 * Doppel-Kür): existing entries keep their firedKinds — a trigger that already
 * fired this morning must not re-arm on the second Kür — and the lastQuotes
 * cross-baseline stays continuous. Another day (or no state) starts fresh.
 */
export function mergeWatchlist(
  existing: WatchlistState | null,
  day: string,
  entries: WatchlistEntry[],
): WatchlistState {
  const fresh = seedWatchlist(day, entries);
  if (!existing || existing.day !== day) return fresh;
  const have = new Set(existing.entries.map((e) => e.ticker.toUpperCase()));
  const added = fresh.entries.filter((e) => !have.has(e.ticker));
  return { day, entries: [...existing.entries, ...added], lastQuotes: existing.lastQuotes };
}
