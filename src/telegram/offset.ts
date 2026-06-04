import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Read the persisted update offset; 0 if missing or unparseable. */
export function readOffset(path: string): number {
  try {
    const n = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Persist the next update offset (only valid positive integers are written). */
export function writeOffset(path: string, offset: number): void {
  if (!Number.isFinite(offset) || offset <= 0) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(Math.trunc(offset)), "utf8");
}
