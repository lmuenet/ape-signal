// src/config/marketCalendar.ts — exchange trading-day calendar (NYSE + Xetra).
// Pure, no deps. Source of truth for "is market X open on day D?", so the
// pre-session Kür and the paper-tick can skip a day an exchange is closed (e.g.
// US Juneteenth while Xetra still trades). Holiday tables are STATIC and must be
// verified + extended once a year (see HOLIDAYS). Timezone is always Europe/Berlin.
export type MarketName = "xetra" | "us";

/**
 * Full-closure trading holidays per market as "YYYY-MM-DD" (Europe/Berlin civil
 * date), from the published NYSE and Deutsche-Börse/Xetra calendars. Half-day
 * early closes are intentionally ignored (we don't trade the tape directly).
 *
 * VERIFY + EXTEND every year — an outdated table silently trades a closed market.
 * Last reviewed for 2026 + 2027.
 */
export const HOLIDAYS: Record<MarketName, ReadonlySet<string>> = {
  // NYSE / Nasdaq (US listings)
  us: new Set([
    // 2026: New Year, MLK, Washington, Good Friday, Memorial, Juneteenth,
    //       Independence (obs. Fri), Labor, Thanksgiving, Christmas.
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    // 2027: Juneteenth obs. Fri 06-18, Independence obs. Mon 07-05, Christmas obs. Fri 12-24.
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
    "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  ]),
  // Deutsche Börse / Xetra (Frankfurt)
  xetra: new Set([
    // 2026: New Year, Good Friday, Easter Monday, Labour Day, Dec 24–26, Dec 31.
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01",
    "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31",
    // 2027
    "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-01",
    "2027-12-24", "2027-12-25", "2027-12-26", "2027-12-31",
  ]),
};

/** The civil date ("YYYY-MM-DD") and weekday (0=Sun … 6=Sat) in Europe/Berlin. */
export function berlinParts(now: Date): { day: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: `${get("year")}-${get("month")}-${get("day")}`, weekday: WEEKDAYS[get("weekday")] ?? -1 };
}

/** True if `day` ("YYYY-MM-DD") is a listed full-closure holiday for the market. */
export function isMarketHoliday(market: MarketName, day: string): boolean {
  return HOLIDAYS[market].has(day);
}

/**
 * True if the market trades on the Europe/Berlin civil day of `now` — i.e. not a
 * weekend and not a listed holiday. Early closes still count as open.
 */
export function marketIsOpen(market: MarketName, now: Date): boolean {
  const { day, weekday } = berlinParts(now);
  if (weekday === 0 || weekday === 6) return false; // Sunday / Saturday
  return !isMarketHoliday(market, day);
}
