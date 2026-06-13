import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTickInterval, writeTickInterval, resolveTickInterval } from "./tickInterval";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "tickint-")); });

describe("tickInterval state", () => {
  it("read returns null when no state file exists", () => {
    expect(readTickInterval(dir)).toBeNull();
  });

  it("write then read round-trips", () => {
    writeTickInterval(dir, 3);
    expect(readTickInterval(dir)).toBe(3);
  });

  it("read returns null on a corrupt file (no crash)", () => {
    writeFileSync(join(dir, "tickInterval.json"), "{ not json", "utf8");
    expect(readTickInterval(dir)).toBeNull();
  });

  it("read returns null on an out-of-range value", () => {
    writeFileSync(join(dir, "tickInterval.json"), JSON.stringify({ minutes: 0 }), "utf8");
    expect(readTickInterval(dir)).toBeNull();
  });

  it("resolve prefers the state file over the fallback", () => {
    writeTickInterval(dir, 2);
    expect(resolveTickInterval(dir, 5)).toBe(2);
  });

  it("resolve falls back when there is no state file", () => {
    expect(resolveTickInterval(dir, 5)).toBe(5);
  });
});
