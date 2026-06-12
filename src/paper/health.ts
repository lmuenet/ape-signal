// src/paper/health.ts — operational health of the monitor loop (Lebenszeichen
// spec 2026-06-12): per-day tick statistics for the daily summary's health
// line plus a consecutive quote-failure counter with a one-shot alert flag.
// Lives in DATA_DIR/health.json — portfolio.json stays pure depot truth.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface HealthState {
  /** Berlin trading day the per-day stats belong to. */
  day: string;
  /** Ticks that actually fetched quotes today (no-op ticks don't count). */
  ticksOk: number;
  /** Failed quote fetches today. */
  quoteFailures: number;
  /** Crosses day boundaries on purpose: an outage over night stays an outage. */
  consecutiveQuoteFailures: number;
  /** One-shot flag: alert sent, all-clear pending. */
  quoteAlertActive: boolean;
}

export const HEALTH = {
  /** Consecutive failed quote fetches before the one-shot Telegram alert. */
  quoteFailureThreshold: 3,
} as const;

const HEALTH_FILE = "health.json";

export function freshHealth(day: string): HealthState {
  return { day, ticksOk: 0, quoteFailures: 0, consecutiveQuoteFailures: 0, quoteAlertActive: false };
}

/** Load health, rolling per-day stats over on a day change (outage state stays). */
export function loadHealth(dir: string, day: string): HealthState {
  const path = join(dir, HEALTH_FILE);
  if (!existsSync(path)) return freshHealth(day);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as HealthState;
  if (parsed.day === day) return parsed;
  return {
    ...freshHealth(day),
    consecutiveQuoteFailures: parsed.consecutiveQuoteFailures ?? 0,
    quoteAlertActive: parsed.quoteAlertActive ?? false,
  };
}

/** Atomic save, mirroring savePortfolio (tmp + rename). */
export function saveHealth(dir: string, h: HealthState): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, HEALTH_FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(h, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

/** One failed fetch. `alert` is true exactly when the threshold is crossed. */
export function recordQuoteFailure(h: HealthState): { health: HealthState; alert: boolean } {
  const consecutive = h.consecutiveQuoteFailures + 1;
  const alert = consecutive >= HEALTH.quoteFailureThreshold && !h.quoteAlertActive;
  return {
    health: {
      ...h,
      quoteFailures: h.quoteFailures + 1,
      consecutiveQuoteFailures: consecutive,
      quoteAlertActive: h.quoteAlertActive || alert,
    },
    alert,
  };
}

/** One successful fetch. `allClear` is true when an active alert resolves. */
export function recordQuoteSuccess(h: HealthState): { health: HealthState; allClear: boolean } {
  return {
    health: { ...h, ticksOk: h.ticksOk + 1, consecutiveQuoteFailures: 0, quoteAlertActive: false },
    allClear: h.quoteAlertActive,
  };
}

/** The daily summary's health line. */
export function healthLine(h: HealthState): string {
  return `Monitor: ${h.ticksOk} Ticks ok, ${h.quoteFailures} Quote-Fehler`;
}
