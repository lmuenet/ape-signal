import { describe, expect, it } from "vitest";
import { berlinChartTime, berlinOffsetSeconds } from "./public/time.js";

describe("berlinOffsetSeconds", () => {
  it("is +2h during CEST (summer)", () => {
    expect(berlinOffsetSeconds("2026-06-24T13:20:00Z")).toBe(2 * 3600);
  });
  it("is +1h during CET (winter)", () => {
    expect(berlinOffsetSeconds("2026-01-15T12:00:00Z")).toBe(1 * 3600);
  });
});

describe("berlinChartTime", () => {
  it("shifts a 15:20 Berlin tick (13:20Z) onto the 15:20 axis slot", () => {
    const base = Math.floor(Date.parse("2026-06-24T13:20:00Z") / 1000);
    expect(berlinChartTime("2026-06-24T13:20:00Z")).toBe(base + 2 * 3600);
  });
});
