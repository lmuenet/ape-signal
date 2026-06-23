// src/config/session.ts — die konfigurierbare Handelssession (A2). Eine reine,
// validierte Config; Quelle der Wahrheit für Timer-Generator, Doctor und die
// Laufzeit-Tick-Drossel. Zeitzone ist immer Europe/Berlin.
//
// Ein SESSION-Modus aktiviert einen oder mehrere Märkte (`xetra` | `us` |
// `xetra+us`). Jeder Markt hat eigene Zeiten + eine eigene Pre-Session-Kür.
// `loadSession` liefert weiterhin das KOMBINIERTE Fenster (Vereinigung) für
// Tick-Drossel/Anzeige — rückwärtskompatibel mit den Single-Market-Modi.
import type { MarketName } from "./marketCalendar";

export type { MarketName };

/** A single exchange the session trades: window, pre-session Kür + labels. */
export interface Market {
  name: MarketName;
  open: string; // "HH:MM" Europe/Berlin
  close: string; // "HH:MM"
  kuerScan: string; // "HH:MM" — pre-session Kür trigger
  scanLabel: string; // systemd instance + scan LABEL, e.g. "PreUS" / "PreXetra"
  display: string; // human label for Telegram/doctor
}

/** Combined view across the active markets (back-compat shape). */
export interface SessionConfig {
  open: string; // earliest market open
  close: string; // latest market close
  kuerScan: string; // earliest market kuerScan (legacy/display)
  tickIntervalMin: number; // runtime DEFAULT (not a timer input)
}

const MARKETS: Record<MarketName, Omit<Market, "name">> = {
  xetra: { open: "09:00", close: "17:30", kuerScan: "08:45", scanLabel: "PreXetra", display: "Xetra" },
  us: { open: "15:30", close: "22:00", kuerScan: "15:15", scanLabel: "PreUS", display: "US-Börse" },
};

/** SESSION value → ordered list of active markets. */
const SESSION_MODES: Record<string, MarketName[]> = {
  us: ["us"],
  xetra: ["xetra"],
  "xetra+us": ["xetra", "us"],
};

const DEFAULT_TICK_INTERVAL_MIN = 5;

export function isValidHHMM(s: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(s)) return false;
  const [h, m] = s.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isValidInterval(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 60;
}

/** Minutes since midnight for an "HH:MM" string. Caller must pass a valid time. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function validateMarket(m: Market): void {
  for (const [label, v] of [["SESSION_OPEN", m.open], ["SESSION_CLOSE", m.close], ["SESSION_KUER_SCAN", m.kuerScan]] as const) {
    if (!isValidHHMM(v)) throw new Error(`${label} must be HH:MM (00:00–23:59), got "${v}"`);
  }
  if (toMinutes(m.open) >= toMinutes(m.close)) {
    throw new Error(`SESSION_OPEN (${m.open}) must be before SESSION_CLOSE (${m.close})`);
  }
  if (toMinutes(m.kuerScan) > toMinutes(m.open)) {
    throw new Error(`SESSION_KUER_SCAN (${m.kuerScan}) must be at or before open (${m.open}) — Kür runs pre-session`);
  }
}

/**
 * The active markets for SESSION, in chronological order (earliest open first).
 * Single-market modes still honour the SESSION_OPEN/CLOSE/KUER_SCAN overrides;
 * in combined mode (`xetra+us`) those single-value overrides are ignored — the
 * two markets keep their preset windows (per-market overrides are a later step).
 */
export function activeMarkets(source: Record<string, string | undefined>): Market[] {
  const name = (source.SESSION ?? "us").trim().toLowerCase();
  const memberNames = SESSION_MODES[name];
  if (!memberNames) {
    throw new Error(`Invalid SESSION: "${source.SESSION}". Supported: ${Object.keys(SESSION_MODES).join(", ")}`);
  }
  const single = memberNames.length === 1;
  const markets = memberNames.map((mn): Market => {
    const m: Market = { name: mn, ...MARKETS[mn] };
    if (single) {
      if (source.SESSION_OPEN?.trim()) m.open = source.SESSION_OPEN.trim();
      if (source.SESSION_CLOSE?.trim()) m.close = source.SESSION_CLOSE.trim();
      if (source.SESSION_KUER_SCAN?.trim()) m.kuerScan = source.SESSION_KUER_SCAN.trim();
    }
    validateMarket(m);
    return m;
  });
  markets.sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
  return markets;
}

/** Reverse a scan/instance LABEL ("PreUS"/"PreXetra") to its market, else null. */
export function marketForScanLabel(label: string): MarketName | null {
  const l = label.trim().toLowerCase();
  for (const [name, m] of Object.entries(MARKETS) as [MarketName, Omit<Market, "name">][]) {
    if (m.scanLabel.toLowerCase() === l) return name;
  }
  return null;
}

/** Human display label for a market (Telegram/doctor). */
export function marketDisplay(name: MarketName): string {
  return MARKETS[name].display;
}

/**
 * Load + validate the COMBINED session window across the active markets. Throws
 * (fail-fast) on any invalid value. The shape is back-compat: single-market
 * modes return exactly the old preset/override values.
 */
export function loadSession(source: Record<string, string | undefined>): SessionConfig {
  const markets = activeMarkets(source); // throws on bad SESSION / times
  const tickIntervalMin = source.TICK_INTERVAL_MIN?.trim()
    ? Number(source.TICK_INTERVAL_MIN)
    : DEFAULT_TICK_INTERVAL_MIN;
  if (!isValidInterval(tickIntervalMin)) {
    throw new Error(`TICK_INTERVAL_MIN must be an integer 1–60, got "${source.TICK_INTERVAL_MIN}"`);
  }
  const open = markets[0].open; // earliest (sorted)
  const close = markets.reduce((max, m) => (toMinutes(m.close) > toMinutes(max) ? m.close : max), markets[0].close);
  const kuerScan = markets[0].kuerScan; // earliest market's Kür
  return { open, close, kuerScan, tickIntervalMin };
}
