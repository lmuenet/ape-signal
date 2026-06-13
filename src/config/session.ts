// src/config/session.ts — die konfigurierbare Handelssession (A2). Eine reine,
// validierte Config; Quelle der Wahrheit für Timer-Generator, Doctor und die
// Laufzeit-Tick-Drossel. Zeitzone ist immer Europe/Berlin.

export interface SessionConfig {
  open: string; // "HH:MM" Europe/Berlin
  close: string; // "HH:MM"
  kuerScan: string; // "HH:MM" — wann der PreUS-Scan (Kür-Trigger) feuert
  tickIntervalMin: number; // Laufzeit-DEFAULT (nicht Timer-Input)
}

const PRESETS: Record<string, SessionConfig> = {
  us: { open: "15:30", close: "22:00", kuerScan: "15:15", tickIntervalMin: 5 },
  xetra: { open: "09:00", close: "17:30", kuerScan: "08:45", tickIntervalMin: 5 },
};

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

/** Load + validate the session config. Throws (fail-fast) on any invalid value. */
export function loadSession(source: Record<string, string | undefined>): SessionConfig {
  const name = (source.SESSION ?? "us").trim().toLowerCase();
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`Invalid SESSION: "${source.SESSION}". Supported: ${Object.keys(PRESETS).join(", ")}`);
  }
  const cfg: SessionConfig = { ...preset };
  if (source.SESSION_OPEN?.trim()) cfg.open = source.SESSION_OPEN.trim();
  if (source.SESSION_CLOSE?.trim()) cfg.close = source.SESSION_CLOSE.trim();
  if (source.SESSION_KUER_SCAN?.trim()) cfg.kuerScan = source.SESSION_KUER_SCAN.trim();
  if (source.TICK_INTERVAL_MIN?.trim()) cfg.tickIntervalMin = Number(source.TICK_INTERVAL_MIN);

  for (const [label, v] of [["SESSION_OPEN", cfg.open], ["SESSION_CLOSE", cfg.close], ["SESSION_KUER_SCAN", cfg.kuerScan]] as const) {
    if (!isValidHHMM(v)) throw new Error(`${label} must be HH:MM (00:00–23:59), got "${v}"`);
  }
  if (toMinutes(cfg.open) >= toMinutes(cfg.close)) {
    throw new Error(`SESSION_OPEN (${cfg.open}) must be before SESSION_CLOSE (${cfg.close})`);
  }
  if (toMinutes(cfg.kuerScan) > toMinutes(cfg.open)) {
    throw new Error(`SESSION_KUER_SCAN (${cfg.kuerScan}) must be at or before open (${cfg.open}) — Kür runs pre-session`);
  }
  if (!isValidInterval(cfg.tickIntervalMin)) {
    throw new Error(`TICK_INTERVAL_MIN must be an integer 1–60, got "${source.TICK_INTERVAL_MIN}"`);
  }
  return cfg;
}
