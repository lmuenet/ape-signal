// src/ui/public/time.js — Europe/Berlin wall-clock for the depot charts.
//
// LightweightCharts has no timezone support: it renders a numeric (UTC) time on
// the axis exactly as given. So a 15:20 Berlin tick — stored as 13:20Z — would
// show at 13:20. We shift each point by its Berlin UTC offset (DST-aware: +2h in
// summer, +1h in winter) so the axis reads Berlin wall-clock. Browser-native ESM
// (no DOM), imported by app.js and exercised by vitest.

/** Europe/Berlin UTC offset in seconds for the instant `iso` (DST-aware). */
export function berlinOffsetSeconds(iso) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  // Treat the Berlin wall-clock as if it were UTC; the gap to the real instant is
  // the offset. Date.UTC avoids any dependence on the runner's own local zone.
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 1000);
}

/** Unix timestamp (s) shifted so LightweightCharts shows Berlin wall-clock. */
export function berlinChartTime(iso) {
  return Math.floor(Date.parse(iso) / 1000) + berlinOffsetSeconds(iso);
}
