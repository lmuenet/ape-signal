import { describe, it, expect } from "vitest";
import { buildTimerFiles } from "./genTimers";
import { activeMarkets } from "./session";

const FULL_HOUR_21 =
  "21:00,01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59:00 Europe/Berlin";

describe("buildTimerFiles (us)", () => {
  const files = buildTimerFiles(activeMarkets({ SESSION: "us" }));

  it("emits exactly the three session-driven timers", () => {
    expect(Object.keys(files).sort()).toEqual([
      "ape-signal-scan-preus.timer",
      "ape-signal-tick-close.timer",
      "ape-signal-tick.timer",
    ]);
  });

  it("preus timer fires at the Kür-scan time and triggers the PreUS scan", () => {
    const t = files["ape-signal-scan-preus.timer"];
    expect(t).toContain("OnCalendar=Mon..Fri *-*-* 15:15:00 Europe/Berlin");
    expect(t).toContain("Persistent=true");
    expect(t).toContain("Unit=ape-signal-scan@PreUS.service");
  });

  it("close timer fires at close and is persistent", () => {
    const t = files["ape-signal-tick-close.timer"];
    expect(t).toContain("OnCalendar=Mon..Fri *-*-* 22:00:00 Europe/Berlin");
    expect(t).toContain("Persistent=true");
    expect(t).toContain("Unit=ape-signal-tick@Close.service");
  });

  it("tick timer fires every minute from open to close-1, grouped per hour", () => {
    const t = files["ape-signal-tick.timer"];
    expect(t).toContain("15:30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59:00 Europe/Berlin");
    expect(t).toContain(FULL_HOUR_21);
    expect(t).not.toContain("22:00,");
    expect(t).toContain("Unit=ape-signal-tick@Tick.service");
    expect(t).not.toContain("Persistent");
  });
});

describe("buildTimerFiles (xetra) uses the PreXetra label + trims the final hour", () => {
  const files = buildTimerFiles(activeMarkets({ SESSION: "xetra" }));

  it("emits the prexetra Kür timer (not preus)", () => {
    expect(files["ape-signal-scan-prexetra.timer"]).toContain("OnCalendar=Mon..Fri *-*-* 08:45:00 Europe/Berlin");
    expect(files["ape-signal-scan-prexetra.timer"]).toContain("Unit=ape-signal-scan@PreXetra.service");
    expect(files["ape-signal-scan-preus.timer"]).toBeUndefined();
  });

  it("last tick is 17:29 — hour 17 stops at :29, no :30", () => {
    const t = files["ape-signal-tick.timer"];
    expect(t).toContain("17:00,01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29:00 Europe/Berlin");
    expect(t).not.toContain("17:30:00"); // kein Tick um 17:30 (das ist der Close)
    expect(t).toContain("09:00,01,02");
    expect(files["ape-signal-tick-close.timer"]).toContain("17:30:00");
  });
});

describe("buildTimerFiles (xetra+us) emits two Kür timers over the union window", () => {
  const files = buildTimerFiles(activeMarkets({ SESSION: "xetra+us" }));

  it("emits four timers: two pre-session Kürs + tick + close", () => {
    expect(Object.keys(files).sort()).toEqual([
      "ape-signal-scan-preus.timer",
      "ape-signal-scan-prexetra.timer",
      "ape-signal-tick-close.timer",
      "ape-signal-tick.timer",
    ]);
  });

  it("Xetra Kür at 08:45, US Kür at 15:15", () => {
    expect(files["ape-signal-scan-prexetra.timer"]).toContain("OnCalendar=Mon..Fri *-*-* 08:45:00 Europe/Berlin");
    expect(files["ape-signal-scan-prexetra.timer"]).toContain("Unit=ape-signal-scan@PreXetra.service");
    expect(files["ape-signal-scan-preus.timer"]).toContain("OnCalendar=Mon..Fri *-*-* 15:15:00 Europe/Berlin");
    expect(files["ape-signal-scan-preus.timer"]).toContain("Unit=ape-signal-scan@PreUS.service");
  });

  it("tick spans 09:00 → 21:59, close at 22:00", () => {
    const t = files["ape-signal-tick.timer"];
    expect(t).toContain("09:00,01,02");
    expect(t).toContain(FULL_HOUR_21);
    expect(t).not.toContain("22:00,");
    expect(files["ape-signal-tick-close.timer"]).toContain("OnCalendar=Mon..Fri *-*-* 22:00:00 Europe/Berlin");
  });
});
