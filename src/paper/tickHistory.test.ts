import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendTickHistory, readTickSeries } from "./tickHistory";
import type { QuoteMap } from "./types";

const q = (close: number): QuoteMap[string] => ({ close, changePct: 0, high: close + 1, low: close - 1 });

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("tick history", () => {
  it("appends one NDJSON line per tick into a day file and reads it back per ticker", () => {
    dir = mkdtempSync(join(tmpdir(), "ape-ticks-"));
    appendTickHistory(dir, "2026-06-11", "2026-06-11T13:35:00.000Z", { AAPL: q(100), TSLA: q(300) });
    appendTickHistory(dir, "2026-06-11", "2026-06-11T13:40:00.000Z", { AAPL: q(101) });
    const series = readTickSeries(dir, "AAPL");
    expect(series).toEqual([
      { at: "2026-06-11T13:35:00.000Z", close: 100, high: 101, low: 99 },
      { at: "2026-06-11T13:40:00.000Z", close: 101, high: 102, low: 100 },
    ]);
    expect(readTickSeries(dir, "TSLA")).toHaveLength(1);
  });

  it("merges multiple day files in date order and skips corrupt lines", () => {
    dir = mkdtempSync(join(tmpdir(), "ape-ticks-"));
    appendTickHistory(dir, "2026-06-10", "2026-06-10T13:35:00.000Z", { AAPL: q(95) });
    appendTickHistory(dir, "2026-06-11", "2026-06-11T13:35:00.000Z", { AAPL: q(100) });
    expect(readTickSeries(dir, "AAPL").map((p) => p.close)).toEqual([95, 100]);
  });

  it("returns [] for unknown tickers or a missing directory", () => {
    dir = mkdtempSync(join(tmpdir(), "ape-ticks-"));
    expect(readTickSeries(dir, "NOPE")).toEqual([]);
    expect(readTickSeries(join(dir, "missing"), "AAPL")).toEqual([]);
  });
});
