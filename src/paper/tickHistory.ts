// src/paper/tickHistory.ts — the depot's own price source (ADR 0004): the
// monitor tick appends its 5-minute quotes as NDJSON day files under
// DATA_DIR/ticks/; the depot UI reads them back as per-ticker series.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { QuoteMap } from "./types";

export interface TickPoint {
  at: string; // ISO timestamp of the monitor tick
  close: number;
  high: number;
  low: number;
}

interface TickRecord {
  at: string;
  quotes: QuoteMap;
}

const ticksDir = (dir: string) => join(dir, "ticks");

/** Append one monitor tick (all quotes) to the day's NDJSON file. */
export function appendTickHistory(dir: string, day: string, atIso: string, quotes: QuoteMap): void {
  if (Object.keys(quotes).length === 0) return;
  mkdirSync(ticksDir(dir), { recursive: true });
  const record: TickRecord = { at: atIso, quotes };
  appendFileSync(join(ticksDir(dir), `${day}.ndjson`), JSON.stringify(record) + "\n", "utf8");
}

/** Per-ticker series across the most recent `maxDays` day files, oldest first. */
export function readTickSeries(dir: string, ticker: string, maxDays = 30): TickPoint[] {
  const tdir = ticksDir(dir);
  if (!existsSync(tdir)) return [];
  const files = readdirSync(tdir)
    .filter((f) => f.endsWith(".ndjson"))
    .sort()
    .slice(-maxDays);
  const upper = ticker.toUpperCase();
  const out: TickPoint[] = [];
  for (const file of files) {
    for (const line of readFileSync(join(tdir, file), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const rec = JSON.parse(line) as TickRecord;
        const q = rec.quotes?.[upper];
        if (q && typeof q.close === "number") out.push({ at: rec.at, close: q.close, high: q.high, low: q.low });
      } catch {
        // a torn line (e.g. crash mid-append) is data loss for one tick, not an error
      }
    }
  }
  return out;
}
