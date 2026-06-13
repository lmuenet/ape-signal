import { describe, it, expect } from "vitest";
import { loadSession, isValidHHMM, isValidInterval } from "./session";

describe("loadSession presets", () => {
  it("defaults to the US session", () => {
    expect(loadSession({})).toEqual({
      open: "15:30", close: "22:00", kuerScan: "15:15", tickIntervalMin: 5,
    });
  });

  it("loads the xetra preset", () => {
    expect(loadSession({ SESSION: "xetra" })).toEqual({
      open: "09:00", close: "17:30", kuerScan: "08:45", tickIntervalMin: 5,
    });
  });

  it("is case-insensitive on the preset name", () => {
    expect(loadSession({ SESSION: "XETRA" }).open).toBe("09:00");
  });

  it("throws on an unknown session, listing the presets", () => {
    expect(() => loadSession({ SESSION: "tokyo" })).toThrowError(/SESSION.*us.*xetra/s);
  });
});

describe("loadSession overrides", () => {
  it("overrides individual fields on top of the preset", () => {
    const s = loadSession({ SESSION: "us", SESSION_OPEN: "16:00", TICK_INTERVAL_MIN: "3" });
    expect(s.open).toBe("16:00");
    expect(s.close).toBe("22:00");
    expect(s.tickIntervalMin).toBe(3);
  });
});

describe("loadSession validation", () => {
  it("rejects a malformed time", () => {
    expect(() => loadSession({ SESSION_OPEN: "9:5" })).toThrowError(/HH:MM/);
  });
  it("rejects open >= close", () => {
    expect(() => loadSession({ SESSION_OPEN: "22:00", SESSION_CLOSE: "15:30" })).toThrowError(/open.*close/i);
  });
  it("rejects kuerScan after open", () => {
    expect(() => loadSession({ SESSION_KUER_SCAN: "16:00" })).toThrowError(/k[üu]r/i);
  });
  it("rejects a non-integer or out-of-range interval", () => {
    expect(() => loadSession({ TICK_INTERVAL_MIN: "0" })).toThrowError(/1.*60/);
    expect(() => loadSession({ TICK_INTERVAL_MIN: "2.5" })).toThrowError(/1.*60/);
    expect(() => loadSession({ TICK_INTERVAL_MIN: "61" })).toThrowError(/1.*60/);
  });
});

describe("validators", () => {
  it("isValidHHMM", () => {
    expect(isValidHHMM("00:00")).toBe(true);
    expect(isValidHHMM("23:59")).toBe(true);
    expect(isValidHHMM("24:00")).toBe(false);
    expect(isValidHHMM("9:05")).toBe(false);
    expect(isValidHHMM("12:60")).toBe(false);
  });
  it("isValidInterval", () => {
    expect(isValidInterval(1)).toBe(true);
    expect(isValidInterval(60)).toBe(true);
    expect(isValidInterval(0)).toBe(false);
    expect(isValidInterval(2.5)).toBe(false);
    expect(isValidInterval(61)).toBe(false);
  });
});
