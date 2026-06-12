import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HEALTH,
  freshHealth,
  healthLine,
  loadHealth,
  recordQuoteFailure,
  recordQuoteSuccess,
  saveHealth,
} from "./health";

describe("health state transitions (pure)", () => {
  it("alerts exactly when the consecutive-failure threshold is crossed", () => {
    const h = freshHealth("2026-06-12");
    const r1 = recordQuoteFailure(h);
    const r2 = recordQuoteFailure(r1.health);
    const r3 = recordQuoteFailure(r2.health);
    expect([r1.alert, r2.alert, r3.alert]).toEqual([false, false, true]);
    expect(r3.health.consecutiveQuoteFailures).toBe(HEALTH.quoteFailureThreshold);
    expect(r3.health.quoteAlertActive).toBe(true);
  });

  it("does not alert again while the alert is active (4th failure)", () => {
    let h = freshHealth("2026-06-12");
    for (let i = 0; i < 3; i++) h = recordQuoteFailure(h).health;
    const r4 = recordQuoteFailure(h);
    expect(r4.alert).toBe(false);
    expect(r4.health.consecutiveQuoteFailures).toBe(4);
  });

  it("a success resets the streak and resolves an active alert (all-clear)", () => {
    let h = freshHealth("2026-06-12");
    for (let i = 0; i < 3; i++) h = recordQuoteFailure(h).health;
    const ok = recordQuoteSuccess(h);
    expect(ok.allClear).toBe(true);
    expect(ok.health.consecutiveQuoteFailures).toBe(0);
    expect(ok.health.quoteAlertActive).toBe(false);
    expect(ok.health.ticksOk).toBe(1);
  });

  it("a success without active alert is silent (no all-clear)", () => {
    const ok = recordQuoteSuccess(freshHealth("2026-06-12"));
    expect(ok.allClear).toBe(false);
  });

  it("renders the daily-summary health line", () => {
    let h = freshHealth("2026-06-12");
    h = recordQuoteSuccess(h).health;
    h = recordQuoteSuccess(h).health;
    h = recordQuoteFailure(h).health;
    expect(healthLine(h)).toBe("Monitor: 2 Ticks ok, 1 Quote-Fehler");
  });
});

describe("health persistence", () => {
  it("round-trips through health.json and resets per-day stats on a day change, keeping the outage state", () => {
    const dir = mkdtempSync(join(tmpdir(), "ape-health-"));
    try {
      let h = freshHealth("2026-06-11");
      h = recordQuoteSuccess(h).health;
      for (let i = 0; i < 3; i++) h = recordQuoteFailure(h).health; // alert active
      saveHealth(dir, h);

      const sameDay = loadHealth(dir, "2026-06-11");
      expect(sameDay).toEqual(h);

      const nextDay = loadHealth(dir, "2026-06-12");
      expect(nextDay.day).toBe("2026-06-12");
      expect(nextDay.ticksOk).toBe(0); // per-day stats reset
      expect(nextDay.quoteFailures).toBe(0);
      expect(nextDay.consecutiveQuoteFailures).toBe(3); // outage survives the night
      expect(nextDay.quoteAlertActive).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns fresh state when no file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "ape-health-"));
    try {
      expect(loadHealth(dir, "2026-06-12")).toEqual(freshHealth("2026-06-12"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
