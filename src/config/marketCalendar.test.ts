import { describe, it, expect } from "vitest";
import { marketIsOpen, isMarketHoliday, berlinParts } from "./marketCalendar";

// Noon UTC keeps the Europe/Berlin civil date equal to the UTC date year-round
// (Berlin is UTC+1/+2), so these fixtures read as the intended calendar day.
const at = (isoDay: string): Date => new Date(`${isoDay}T12:00:00Z`);

describe("berlinParts", () => {
  it("maps a date to its Europe/Berlin civil day + weekday", () => {
    expect(berlinParts(at("2026-06-19"))).toEqual({ day: "2026-06-19", weekday: 5 }); // Friday
    expect(berlinParts(at("2026-06-20")).weekday).toBe(6); // Saturday
    expect(berlinParts(at("2026-06-22")).weekday).toBe(1); // Monday
  });
});

describe("marketIsOpen — Juneteenth 2026-06-19 (US closed, Xetra open)", () => {
  it("US is closed", () => expect(marketIsOpen("us", at("2026-06-19"))).toBe(false));
  it("Xetra is open", () => expect(marketIsOpen("xetra", at("2026-06-19"))).toBe(true));
});

describe("marketIsOpen — Labour Day 2026-05-01 (Xetra closed, US open)", () => {
  it("Xetra is closed", () => expect(marketIsOpen("xetra", at("2026-05-01"))).toBe(false));
  it("US is open", () => expect(marketIsOpen("us", at("2026-05-01"))).toBe(true));
});

describe("marketIsOpen — weekends closed for both", () => {
  it("Saturday 2026-06-20", () => {
    expect(marketIsOpen("us", at("2026-06-20"))).toBe(false);
    expect(marketIsOpen("xetra", at("2026-06-20"))).toBe(false);
  });
});

describe("marketIsOpen — a normal trading Monday is open", () => {
  it("Monday 2026-06-22", () => {
    expect(marketIsOpen("us", at("2026-06-22"))).toBe(true);
    expect(marketIsOpen("xetra", at("2026-06-22"))).toBe(true);
  });
});

describe("isMarketHoliday — knows the 2026 + 2027 tables", () => {
  it("US", () => {
    expect(isMarketHoliday("us", "2026-06-19")).toBe(true);
    expect(isMarketHoliday("us", "2027-06-18")).toBe(true); // observed (Jun 19 2027 = Sat)
    expect(isMarketHoliday("us", "2026-12-26")).toBe(false);
  });
  it("Xetra", () => {
    expect(isMarketHoliday("xetra", "2026-12-26")).toBe(true);
    expect(isMarketHoliday("xetra", "2026-06-19")).toBe(false);
  });
});
