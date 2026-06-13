// src/paper/tickInterval.ts — Laufzeit-Persistenz des effektiven Tick-Intervalls
// (A2). Der Listener schreibt (via /ticker), der Tick-Prozess liest. Eine kaputte
// oder ungültige Datei degradiert still auf den Fallback (Config-Default).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { isValidInterval } from "../config/session";

const FILE = "tickInterval.json";

/** The persisted interval, or null if absent/corrupt/invalid. */
export function readTickInterval(dir: string): number | null {
  const path = join(dir, FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { minutes?: unknown };
    const m = parsed.minutes;
    if (typeof m === "number" && isValidInterval(m)) return m;
    console.warn(`[tickInterval] ignoring out-of-range value in ${path}: ${String(m)}`);
    return null;
  } catch (err) {
    console.warn(`[tickInterval] corrupt state file ${path}, falling back: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Atomically persist the interval. Caller must pass a valid 1–60 integer. */
export function writeTickInterval(dir: string, minutes: number): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ minutes }) + "\n", "utf8");
  renameSync(tmp, path);
}

/** Effective interval: state file → fallback (the session config default). */
export function resolveTickInterval(dir: string, fallback: number): number {
  return readTickInterval(dir) ?? fallback;
}
