# A2 Handelsfenster-Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Handelsfenster konfigurierbar machen (Presets `us`/`xetra` + Overrides), die systemd-Timer daraus generieren, und das Tick-Intervall als live per Telegram (`/ticker N`) anpassbaren Laufzeit-Wert führen.

**Architecture:** Eine reine `loadSession()`-Config (env-getrieben, validiert) ist die Quelle der Wahrheit. Ein Generator (`buildTimerFiles`) erzeugt die drei session-getriebenen systemd-Timer (Kür-Scan, Tick, Close). Der Tick-Timer feuert fix jede Minute im Fenster; die `tickPipeline` drosselt auf das effektive Intervall (State-Datei → Config-Default), **bevor** TradingView abgefragt wird. `/ticker` schreibt die State-Datei.

**Tech Stack:** TypeScript, Node (tsx), vitest. Tests: `npm run test`; Einzeldatei: `npx vitest run <pfad>`; Typecheck: `npm run typecheck`.

**Zeitzone bleibt Europe/Berlin** (beide Presets in Berlin-Wall-Clock; `store.ts` unverändert). `isClose` bleibt label-getrieben.

**Spec:** `docs/superpowers/specs/2026-06-13-handelsfenster-setting-design.md`

---

### Task 1: Session-Config-Modell — `src/config/session.ts`

**Files:**
- Create: `src/config/session.ts`
- Test: `src/config/session.test.ts`

- [ ] **Step 1: Failing test schreiben** — `src/config/session.test.ts`:

```ts
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
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/config/session.test.ts`
Expected: FAIL — Modul `./session` existiert nicht.

- [ ] **Step 3: Implementieren** — `src/config/session.ts`:

```ts
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
```

- [ ] **Step 4: Test + Typecheck (grün)**

Run: `npx vitest run src/config/session.test.ts && npm run typecheck`
Expected: PASS, keine Typfehler.

- [ ] **Step 5: Commit**

```bash
git add src/config/session.ts src/config/session.test.ts
git commit -m "feat(session): konfigurierbare Handelssession (Presets us/xetra + Overrides)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Timer-Generator — `src/config/genTimers.ts`

**Files:**
- Create: `src/config/genTimers.ts`
- Test: `src/config/genTimers.test.ts`
- Modify: `package.json` (script `gen-timers`)

- [ ] **Step 1: Failing test schreiben** — `src/config/genTimers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTimerFiles } from "./genTimers";
import { loadSession } from "./session";

describe("buildTimerFiles (us)", () => {
  const files = buildTimerFiles(loadSession({ SESSION: "us" }));

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
    // first hour starts at :30
    expect(t).toContain("15:30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59:00 Europe/Berlin");
    // a full interior hour
    expect(t).toContain("17:00,01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59:00 Europe/Berlin");
    // last tick is 21:59, so hour 21 goes to :59 and there is no 22:xx tick line
    expect(t).toContain("21:00,01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59:00 Europe/Berlin");
    expect(t).not.toContain("22:00,");
    expect(t).toContain("Unit=ape-signal-tick@Tick.service");
    expect(t).not.toContain("Persistent");
  });
});

describe("buildTimerFiles (xetra) trims the final hour", () => {
  const files = buildTimerFiles(loadSession({ SESSION: "xetra" }));
  it("last tick is 17:29 — hour 17 stops at :29, no :30", () => {
    const t = files["ape-signal-tick.timer"];
    expect(t).toContain("17:00,01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29:00 Europe/Berlin");
    expect(t).not.toContain("17:30");
    expect(t).toContain("09:00,01,02"); // first hour from :00
    expect(files["ape-signal-tick-close.timer"]).toContain("17:30:00");
    expect(files["ape-signal-scan-preus.timer"]).toContain("08:45:00");
  });
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/config/genTimers.test.ts`
Expected: FAIL — Modul `./genTimers` existiert nicht.

- [ ] **Step 3: Implementieren** — `src/config/genTimers.ts`:

```ts
// src/config/genTimers.ts — erzeugt die drei session-getriebenen systemd-Timer
// aus der SessionConfig (A2). Reiner Kern (buildTimerFiles) + ein dünner main,
// der nach --out=<dir> (Default /etc/systemd/system) schreibt. Der Tick-Timer
// feuert fix jede Minute im Fenster; das effektive Intervall drosselt zur Laufzeit.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSession, type SessionConfig } from "./session";

const pad = (n: number): string => String(n).padStart(2, "0");

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** OnCalendar lines for the per-minute tick raster, one line per hour. */
function tickOnCalendar(open: string, close: string): string {
  const openT = toMinutes(open);
  const closeT = toMinutes(close);
  const byHour = new Map<number, number[]>();
  for (let t = openT; t < closeT; t++) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(m);
  }
  return [...byHour.entries()]
    .map(([h, mins]) => `OnCalendar=Mon..Fri *-*-* ${pad(h)}:${mins.map(pad).join(",")}:00 Europe/Berlin`)
    .join("\n");
}

/** Filename → unit-file content for the three session-driven timers. */
export function buildTimerFiles(session: SessionConfig): Record<string, string> {
  return {
    "ape-signal-scan-preus.timer": [
      "[Unit]",
      `Description=Ape Signal pre-session scan (${session.kuerScan} Europe/Berlin, Kandidatenkuer-Trigger)`,
      "",
      "[Timer]",
      `OnCalendar=Mon..Fri *-*-* ${session.kuerScan}:00 Europe/Berlin`,
      "Persistent=true",
      "Unit=ape-signal-scan@PreUS.service",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n"),
    "ape-signal-tick.timer": [
      "[Unit]",
      `Description=Ape Signal paper-trading monitor tick (every minute ${session.open}-${session.close} Europe/Berlin; effektives Intervall drosselt zur Laufzeit)`,
      "",
      "[Timer]",
      tickOnCalendar(session.open, session.close),
      "Unit=ape-signal-tick@Tick.service",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n"),
    "ape-signal-tick-close.timer": [
      "[Unit]",
      `Description=Ape Signal paper-trading closing tick (${session.close} Europe/Berlin)`,
      "",
      "[Timer]",
      `OnCalendar=Mon..Fri *-*-* ${session.close}:00 Europe/Berlin`,
      "Persistent=true",
      "Unit=ape-signal-tick@Close.service",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n"),
  };
}

/** Read an env file (KEY=VALUE) into a record; missing file → empty. */
function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const out = args.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "/etc/systemd/system";
  const envFileArg = args.find((a) => a.startsWith("--env-file="))?.slice("--env-file=".length) ?? "/etc/ape-signal.env";

  const fileEnv = loadEnvFile(envFileArg);
  const source: Record<string, string | undefined> = { ...fileEnv, ...process.env };
  const session = loadSession(source);
  const files = buildTimerFiles(session);

  mkdirSync(out, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(out, name), content, "utf8");
  }
  console.log(`[gen-timers] wrote ${Object.keys(files).length} timers to ${out} for session ${session.open}-${session.close} (Kuer ${session.kuerScan}). Run: systemctl daemon-reload`);
}

if (process.argv[1] && process.argv[1].endsWith("genTimers.ts")) {
  main();
}
```

- [ ] **Step 4: npm-Script ergänzen** — in `package.json` unter `scripts` einfügen:

```json
    "gen-timers": "tsx src/config/genTimers.ts",
```

- [ ] **Step 5: Test + Typecheck (grün)**

Run: `npx vitest run src/config/genTimers.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/genTimers.ts src/config/genTimers.test.ts package.json
git commit -m "feat(session): Timer-Generator aus SessionConfig (gen-timers)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Tick-Intervall-State — `src/paper/tickInterval.ts`

**Files:**
- Create: `src/paper/tickInterval.ts`
- Test: `src/paper/tickInterval.test.ts`

- [ ] **Step 1: Failing test schreiben** — `src/paper/tickInterval.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTickInterval, writeTickInterval, resolveTickInterval } from "./tickInterval";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "tickint-")); });

describe("tickInterval state", () => {
  it("read returns null when no state file exists", () => {
    expect(readTickInterval(dir)).toBeNull();
  });

  it("write then read round-trips", () => {
    writeTickInterval(dir, 3);
    expect(readTickInterval(dir)).toBe(3);
  });

  it("read returns null on a corrupt file (no crash)", () => {
    writeFileSync(join(dir, "tickInterval.json"), "{ not json", "utf8");
    expect(readTickInterval(dir)).toBeNull();
  });

  it("read returns null on an out-of-range value", () => {
    writeFileSync(join(dir, "tickInterval.json"), JSON.stringify({ minutes: 0 }), "utf8");
    expect(readTickInterval(dir)).toBeNull();
  });

  it("resolve prefers the state file over the fallback", () => {
    writeTickInterval(dir, 2);
    expect(resolveTickInterval(dir, 5)).toBe(2);
  });

  it("resolve falls back when there is no state file", () => {
    expect(resolveTickInterval(dir, 5)).toBe(5);
  });
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/paper/tickInterval.test.ts`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: Implementieren** — `src/paper/tickInterval.ts`:

```ts
// src/paper/tickInterval.ts — Laufzeit-Persistenz des effektiven Tick-Intervalls
// (A2). Der Listener schreibt (via /ticker), der Tick-Prozess liest. Eine kaputte
// oder ungültige Datei degradiert still auf den Fallback (Config-Default).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { isValidInterval } from "../config/session";

const FILE = "tickInterval.json";

/** The persisted interval, or null if absent/corrupt/invalid. */
export function readTickInterval(dir: string): number | null {
  const path = join(dir, FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { minutes?: unknown };
    const m = parsed.minutes;
    if (typeof m === "number" && isValidInterval(m)) return m;
    console.warn(`[tickInterval] ignoring out-of-range value in ${path}: ${String(m)}`);
    return null;
  } catch (err) {
    console.warn(`[tickInterval] corrupt state file ${path}, falling back: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Atomically persist the interval. Caller must pass a valid 1–60 integer. */
export function writeTickInterval(dir: string, minutes: number): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ minutes }) + "\n", "utf8");
  renameSync(tmp, path);
}

/** Effective interval: state file → fallback (the session config default). */
export function resolveTickInterval(dir: string, fallback: number): number {
  return readTickInterval(dir) ?? fallback;
}
```

- [ ] **Step 4: Test + Typecheck (grün)**

Run: `npx vitest run src/paper/tickInterval.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/tickInterval.ts src/paper/tickInterval.test.ts
git commit -m "feat(paper): Tick-Intervall-State (read/write/resolve) mit Fallback

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Tick-Drossel in der Pipeline

**Files:**
- Modify: `src/paper/types.ts` (`Portfolio.lastTickAt`)
- Modify: `src/paper/tickPipeline.ts` (`TickDeps.tickIntervalMin` + Drossel)
- Test: `src/paper/tickPipeline.test.ts`

- [ ] **Step 1: Failing tests ergänzen** — in `src/paper/tickPipeline.test.ts` ans Ende des `describe("runTick", …)`-Blocks (an die dort vorhandene `deps`-Konstruktion anpassen; der Block nutzt `berlinDay`/`berlinStamp` und eine Portfolio-Fixture). Muster mit eigenständigen Deps:

```ts
  it("throttles a monitor tick before fetching quotes when the interval has not elapsed", async () => {
    const fetchQuotes = vi.fn(async () => ({ AAPL: { close: 100, changePct: 0, high: 100, low: 100 } }));
    const saved: Portfolio[] = [];
    const now = new Date("2026-06-09T13:32:00Z"); // 2 min after lastTickAt below
    const portfolio: Portfolio = {
      ...freshPortfolio(1000),
      positions: [{ id: "p1", ticker: "AAPL", side: "long", stake: 100, leverage: 1, entryPrice: 100, units: 1, stopLoss: 90, openedAt: "x", thesis: "t" }],
      lastTickAt: "2026-06-09T13:30:00Z",
    };
    await runTick({ isClose: false }, {
      loadPortfolio: () => portfolio,
      savePortfolio: (p) => saved.push(p),
      appendJournal: () => {},
      readJournalTail: () => "",
      fetchQuotes,
      loadHealth: () => ({} as never),
      saveHealth: () => {},
      claudeRunner: async () => "",
      send: async () => {},
      now: () => now,
      berlinDay, berlinStamp,
      tickIntervalMin: 5,
    });
    expect(fetchQuotes).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("runs the tick (and stamps lastTickAt) once the interval has elapsed", async () => {
    const fetchQuotes = vi.fn(async () => ({ AAPL: { close: 100, changePct: 0, high: 100, low: 100 } }));
    const saved: Portfolio[] = [];
    const now = new Date("2026-06-09T13:40:00Z"); // 10 min after lastTickAt
    const portfolio: Portfolio = {
      ...freshPortfolio(1000),
      positions: [{ id: "p1", ticker: "AAPL", side: "long", stake: 100, leverage: 1, entryPrice: 100, units: 1, stopLoss: 90, openedAt: "x", thesis: "t" }],
      lastTickAt: "2026-06-09T13:30:00Z",
    };
    await runTick({ isClose: false }, {
      loadPortfolio: () => portfolio,
      savePortfolio: (p) => saved.push(p),
      appendJournal: () => {},
      readJournalTail: () => "",
      fetchQuotes,
      loadHealth: () => ({ consecutiveQuoteFailures: 0 } as never),
      saveHealth: () => {},
      claudeRunner: async () => "",
      send: async () => {},
      now: () => now,
      berlinDay, berlinStamp,
      tickIntervalMin: 5,
    });
    expect(fetchQuotes).toHaveBeenCalled();
    expect(saved.at(-1)?.lastTickAt).toBe(now.toISOString());
  });
```

Imports am Dateikopf ggf. ergänzen: `freshPortfolio`, `type Portfolio` aus `./types`, `vi` aus `vitest`.

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/paper/tickPipeline.test.ts`
Expected: FAIL — `tickIntervalMin` ist kein `TickDeps`-Feld; Drossel greift nicht; `lastTickAt` wird nicht gesetzt.

- [ ] **Step 3: Implementieren**

`src/paper/types.ts` — `Portfolio` um Feld erweitern:
```ts
  /** Last manager (Sonnet) call — cooldown baseline for band wakes. */
  lastManagerCallAt?: string;
  /** Last monitor tick that actually ran — baseline for the interval throttle (A2). */
  lastTickAt?: string;
}
```

`src/paper/tickPipeline.ts` — in `TickDeps` ergänzen (nach `berlinStamp`):
```ts
  berlinStamp: (d: Date) => string;
  language?: Language;
  /** Effektives Tick-Intervall in Minuten (A2). Fehlt → keine Drossel. */
  tickIntervalMin?: number;
}
```

In `runTick`, direkt **nach** dem „nothing to do"-Early-Return (dem Block, der bei leerem Depot `return`t) und **vor** `let health = deps.loadHealth(day);` einfügen:
```ts
  // --- Tick-Intervall-Drossel (A2): einen zu frühen Monitor-Tick überspringen,
  // BEVOR wir TradingView nach Kursen fragen. Der Close-Tick drosselt nie. ---
  if (!opts.isClose && deps.tickIntervalMin !== undefined && portfolio.lastTickAt) {
    const elapsedMs = now.getTime() - Date.parse(portfolio.lastTickAt);
    if (elapsedMs < deps.tickIntervalMin * 60_000) {
      console.log(`[tick] throttled (interval ${deps.tickIntervalMin}min not elapsed).`);
      return;
    }
  }
  // Diesen Tick als "echten" Tick markieren; reist in den nächsten savePortfolio mit.
  portfolio = { ...portfolio, lastTickAt: now.toISOString() };
```

- [ ] **Step 4: Test + Typecheck + Gesamt-Suite (grün)**

Run: `npx vitest run src/paper/tickPipeline.test.ts && npm run typecheck && npm run test`
Expected: PASS. Bestehende Tick-Tests ohne `tickIntervalMin` bleiben grün (keine Drossel; `lastTickAt` wird gesetzt, reist nur in vorhandene Saves mit — `.at(-1)`-Assertions unberührt).

- [ ] **Step 5: Commit**

```bash
git add src/paper/types.ts src/paper/tickPipeline.ts src/paper/tickPipeline.test.ts
git commit -m "feat(paper): Tick-Intervall-Drossel vor dem Quote-Abruf (A2)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Intervall am Tick-Entrypoint auflösen

**Files:**
- Modify: `src/paper/tick.ts`

> `main()`-Entrypoint ohne Unit-Test; verifiziert per `npm run typecheck`.

- [ ] **Step 1: Implementieren** — `src/paper/tick.ts` anpassen.

Imports ergänzen:
```ts
import { loadSession } from "../config/session";
import { resolveTickInterval } from "./tickInterval";
```
In `main()`, nach `const dir = dataDir();` das Intervall auflösen:
```ts
  const tickIntervalMin = resolveTickInterval(dir, loadSession(process.env).tickIntervalMin);
```
Im `runTick(...)`-Deps-Objekt (nach `language: env.language,`) ergänzen:
```ts
      tickIntervalMin,
```

- [ ] **Step 2: Typecheck (grün)**

Run: `npm run typecheck`
Expected: keine Typfehler.

- [ ] **Step 3: Commit**

```bash
git add src/paper/tick.ts
git commit -m "feat(paper): Tick-Intervall am Entrypoint aufloesen + injizieren

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: `/ticker`-Command-Parser

**Files:**
- Modify: `src/telegram/commands.ts`
- Test: `src/telegram/commands.test.ts`

- [ ] **Step 1: Failing tests ergänzen** — in `src/telegram/commands.test.ts` (Muster an die dort vorhandenen `parseCommand`-Tests anlehnen):

```ts
import { parseCommand } from "./commands";

describe("parseCommand /ticker", () => {
  it("parses a valid integer", () => {
    expect(parseCommand("/ticker 3")).toEqual({ kind: "ticker", minutes: 3 });
  });
  it("treats a bare /ticker as a query", () => {
    expect(parseCommand("/ticker")).toEqual({ kind: "ticker" });
  });
  it("flags a non-integer / out-of-range arg as badArg", () => {
    expect(parseCommand("/ticker abc")).toEqual({ kind: "ticker", badArg: "abc" });
    expect(parseCommand("/ticker 2.5")).toEqual({ kind: "ticker", badArg: "2.5" });
    expect(parseCommand("/ticker 0")).toEqual({ kind: "ticker", badArg: "0" });
    expect(parseCommand("/ticker 61")).toEqual({ kind: "ticker", badArg: "61" });
  });
  it("ignores a bot @suffix on the command", () => {
    expect(parseCommand("/ticker@apebot 5")).toEqual({ kind: "ticker", minutes: 5 });
  });
});
```

(Falls die Datei noch keinen `import { parseCommand }` am Kopf hat, den vorhandenen Import nutzen statt neu zu importieren.)

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/telegram/commands.test.ts`
Expected: FAIL — `/ticker` wird als `unknown` geparst.

- [ ] **Step 3: Implementieren** — `src/telegram/commands.ts`:

`Command`-Union erweitern:
```ts
export type Command =
  | { kind: "strategie"; ticker: string; profile: TradingProfile }
  | { kind: "scan" }
  | { kind: "journal"; text?: string }
  | { kind: "ticker"; minutes?: number; badArg?: string }
  | { kind: "unknown"; text: string };
```
In `parseCommand`, vor dem abschließenden `return { kind: "unknown", … }` einfügen:
```ts
  if (head === "/ticker") {
    if (rest.length === 0) return { kind: "ticker" };
    const raw = rest[0];
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 60) return { kind: "ticker", minutes: n };
    return { kind: "ticker", badArg: raw };
  }
```

- [ ] **Step 4: Test + Typecheck (grün)**

Run: `npx vitest run src/telegram/commands.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/commands.ts src/telegram/commands.test.ts
git commit -m "feat(telegram): /ticker-Command parsen (Wert/Query/Edge-Cases)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: `/ticker` im Listener verdrahten

**Files:**
- Modify: `src/telegram/listener.ts`

> `main()`-Entrypoint ohne Unit-Test; verifiziert per `npm run typecheck`.

- [ ] **Step 1: Implementieren** — `src/telegram/listener.ts`.

Imports ergänzen:
```ts
import { resolveTickInterval, writeTickInterval } from "../paper/tickInterval";
import { loadSession } from "../config/session";
```
In `handle(...)` einen Zweig ergänzen (vor dem `else`-Zweig mit der Befehlsübersicht). `paperDir` ist im `main()`-Scope definiert; reiche ihn in `handle` durch ODER nutze `dataDir()` direkt. Da `handle` `paperDir` nicht als Parameter hat, verwende hier `dataDir()`:
```ts
    } else if (cmd.kind === "ticker") {
      const dir = dataDir();
      if (cmd.badArg !== undefined) {
        await telegram.sendMessage("⚠️ /ticker braucht eine ganze Zahl 1–60 (Minuten). Beispiel: /ticker 3");
      } else if (cmd.minutes === undefined) {
        const cur = resolveTickInterval(dir, loadSession(process.env).tickIntervalMin);
        await telegram.sendMessage(`⏱️ Aktuelles Tick-Intervall: ${cur} min.`);
      } else {
        writeTickInterval(dir, cmd.minutes);
        await telegram.sendMessage(`⏱️ Tick-Intervall jetzt ${cmd.minutes} min (ab dem nächsten Tick).`);
      }
```
`dataDir` ist bereits importiert (`import { appendJournal, dataDir, … } from "../paper/store";`). Ergänze die Befehlsübersicht im finalen `else`-Zweig um `/ticker`:
```ts
      await telegram.sendMessage("Befehle: /strategie TICKER [conservative|balanced|aggressive] [intraday|swing|position] · /scan · /journal [z.B. \"setz dein Guthaben auf 500\"] · /ticker [1–60]");
```

- [ ] **Step 2: Typecheck (grün)**

Run: `npm run typecheck`
Expected: keine Typfehler.

- [ ] **Step 3: Commit**

```bash
git add src/telegram/listener.ts
git commit -m "feat(telegram): /ticker-Handler (setzen/anzeigen/Fehler)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Prompts session-neutral

**Files:**
- Modify: `src/paper/prompts.ts`
- Test: `src/paper/prompts.test.ts`

- [ ] **Step 1: Failing tests ergänzen** — in `src/paper/prompts.test.ts` im `describe("prompt language label", …)` ODER einem neuen Block:

```ts
describe("session-neutral wording", () => {
  it("decision prompt says 'Handelsstart' not 'US-Open'", () => {
    const p = buildDecisionPrompt({
      day: "2026-06-11", dossierBlock: "", debateBlock: "", quotesBlock: "",
      portfolioBlock: "", journalTail: "",
    });
    expect(p).toContain("kurz vor Handelsstart");
    expect(p).not.toContain("US-Open");
  });

  it("tick prompt uses session-neutral session/close wording", () => {
    const base = {
      stamp: "2026-06-11 15:35", portfolioBlock: "(d)", quotesBlock: "(q)",
      eventsBlock: "", wakeBlock: "", journalTail: "", isClose: false,
    };
    expect(buildTickPrompt(base)).toContain("Handelssession läuft");
    expect(buildTickPrompt({ ...base, isClose: true })).toContain("Handelsschluss");
    expect(buildTickPrompt(base)).not.toContain("US-Session");
  });
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/paper/prompts.test.ts`
Expected: FAIL — Prompts enthalten noch „US-Open"/„US-Session"/„US-Close".

- [ ] **Step 3: Implementieren** — `src/paper/prompts.ts`:

In `buildDecisionPrompt` die Zeile:
```ts
    `Heute ist ${input.day}, kurz vor US-Open. Du bist in der ENTSCHEIDER-Rolle:`,
```
ersetzen durch:
```ts
    `Heute ist ${input.day}, kurz vor Handelsstart. Du bist in der ENTSCHEIDER-Rolle:`,
```
In `buildTickPrompt` die Zeile:
```ts
    `Tick ${input.stamp} (${input.isClose ? "LETZTER Tick des Tages, US-Close" : "US-Session läuft"}).`,
```
ersetzen durch:
```ts
    `Tick ${input.stamp} (${input.isClose ? "LETZTER Tick des Tages, Handelsschluss" : "Handelssession läuft"}).`,
```

- [ ] **Step 4: Test + Typecheck (grün)**

Run: `npx vitest run src/paper/prompts.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/prompts.ts src/paper/prompts.test.ts
git commit -m "feat(prompts): session-neutrale Formulierungen (statt US-spezifisch)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Doctor zeigt die Session

**Files:**
- Modify: `src/config/doctor.ts`
- Test: `src/config/doctor.test.ts`

- [ ] **Step 1: Failing tests ergänzen** — in `src/config/doctor.test.ts` (Import `checkSession` am Kopf ergänzen):

```ts
import { checkSession } from "./doctor";

describe("checkSession", () => {
  it("reports the active window (default US)", () => {
    const r = checkSession({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("15:30");
    expect(r.detail).toContain("22:00");
    expect(r.detail).toContain("5min");
  });
  it("reports the xetra window", () => {
    expect(checkSession({ SESSION: "xetra" }).detail).toContain("09:00");
  });
  it("fails on an invalid session config", () => {
    const r = checkSession({ SESSION: "tokyo" });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/SESSION/);
  });
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/config/doctor.test.ts`
Expected: FAIL — `checkSession` existiert nicht.

- [ ] **Step 3: Implementieren** — `src/config/doctor.ts`:

Import ergänzen:
```ts
import { loadSession } from "./session";
```
Neue Check-Funktion (z.B. direkt nach `checkRequiredEnv`):
```ts
/** Aktive Handelssession (A2): Fenster + Default-Tick-Intervall. Hard-fail bei Config-Fehler. */
export function checkSession(source: Record<string, string | undefined>): CheckResult {
  try {
    const s = loadSession(source);
    return {
      name: "Session",
      status: "ok",
      detail: `${s.open}–${s.close}, Kür-Scan ${s.kuerScan}, Tick ${s.tickIntervalMin}min`,
    };
  } catch (err) {
    return { name: "Session", status: "fail", detail: err instanceof Error ? err.message : String(err) };
  }
}
```
In `runDoctor` direkt nach `results.push(checkRequiredEnv(source));` ergänzen:
```ts
  results.push(checkSession(source));
```

- [ ] **Step 4: Test + Typecheck + Gesamt-Suite (grün)**

Run: `npx vitest run src/config/doctor.test.ts && npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/doctor.ts src/config/doctor.test.ts
git commit -m "feat(doctor): aktive Handelssession ausweisen

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Dokumentation

**Files:**
- Modify: `.env.example`
- Modify: `systemd/README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/BACKLOG.md`

> Docs gehen direkt auf master (Projektkonvention). Kein Test.

- [ ] **Step 1: `.env.example`** — nach dem `# Tuning (optional)`-Block (vor oder nach `SCAN_LIMIT`) ergänzen:

```bash
# Handelssession (A2). Preset us (Default) oder xetra; Einzelwerte überschreibbar.
#   us    = 15:30–22:00, Kür-Scan 15:15 (Europe/Berlin)
#   xetra = 09:00–17:30, Kür-Scan 08:45
# Nach Änderung: `npm run gen-timers && systemctl daemon-reload`.
SESSION=us
#SESSION_OPEN=15:30
#SESSION_CLOSE=22:00
#SESSION_KUER_SCAN=15:15
# Effektives Tick-Intervall in Minuten (1–60, Default 5). Empfehlung: >= 5,
# um TradingView nicht zu belagern. Live änderbar per Telegram: /ticker N.
TICK_INTERVAL_MIN=5
```

- [ ] **Step 2: `systemd/README.md`** — einen Notes-Bullet ergänzen:

```markdown
- `SESSION` (`us` | `xetra`, Default `us`) plus optionale Overrides
  (`SESSION_OPEN`/`SESSION_CLOSE`/`SESSION_KUER_SCAN`, `TICK_INTERVAL_MIN`) in
  `/etc/ape-signal.env` definieren das Handelsfenster. Die drei
  session-getriebenen Timer (`ape-signal-scan-preus`, `ape-signal-tick`,
  `ape-signal-tick-close`) werden daraus generiert: `npm run gen-timers`
  (schreibt nach `/etc/systemd/system`, `--out=<dir>` für Tests) → danach
  `systemctl daemon-reload`. Ohne Generator-Lauf gelten die committeten
  US-Baseline-Timer. Der Tick-Timer feuert jede Minute im Fenster; das effektive
  Intervall drosselt zur Laufzeit (live per Telegram `/ticker N`). Der
  PreOpen-Scan (08:45) ist nicht session-getrieben und bleibt fix.
```

- [ ] **Step 3: `CONTEXT.md`** — die Zeile, die die Session als fest beschreibt (≈ „der US-Session (alle 5 Minuten, Mo–Fr 15:30–22:00 Europe/Berlin)"), so anpassen, dass die Session konfigurierbar ist:

> „… der Handelssession (Default US 15:30–22:00 Europe/Berlin, konfigurierbar via `SESSION`/Overrides, siehe Spec A2; Tick-Intervall live per `/ticker`) …"

(Wortlaut an den vorhandenen Satz anpassen; Kernaussage: Fenster ist nicht mehr fix US.)

- [ ] **Step 4: `docs/BACKLOG.md`** — A2 als erledigt markieren: in der „Reihenfolge"-Liste Punkt 2 durchstreichen (`~~**A2 Handelsfenster-Setting**~~ — erledigt 2026-06-13`) und in der Kategorie A den A2-Eintrag mit „**erledigt 2026-06-13**" + kurzem Verweis auf Spec/Plan versehen.

- [ ] **Step 5: Commit**

```bash
git add .env.example systemd/README.md CONTEXT.md docs/BACKLOG.md
git commit -m "docs: Handelssession (SESSION/gen-timers//ticker) dokumentieren + A2 erledigt

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review (vom Plan-Autor durchgeführt)

**Spec-Abdeckung:**
- Config-Modell `session.ts` (Presets, Overrides, Validierung, throw) → Task 1. ✓
- Timer-Generator (`buildTimerFiles`, 1-min-Raster, Trim, Persistent/Unit, main + npm-Script, /etc-Out) → Task 2. ✓
- Laufzeit-Drossel: State-Datei (`tickInterval.ts`) → Task 3; Pipeline-Drossel + `lastTickAt` + `TickDeps.tickIntervalMin` → Task 4; Auflösung am Entrypoint → Task 5. ✓
- `/ticker`: Parser + Edge-Cases → Task 6; Listener-Handler (setzen/anzeigen/Fehler) → Task 7. ✓
- Prompts session-neutral → Task 8. ✓
- Doctor-Session-Zeile → Task 9. ✓
- Zeitzone bleibt Berlin / `isClose` label-getrieben → keine Änderung nötig (in Task 4 respektiert: Close drosselt nie). ✓
- Doku (.env.example, systemd, CONTEXT, BACKLOG A2) → Task 10. ✓

**Platzhalter-Scan:** kein TBD/TODO; jeder Code-Schritt zeigt konkreten Code. ✓

**Typ-Konsistenz:** `SessionConfig`/`loadSession`/`isValidHHMM`/`isValidInterval` (Task 1) konsistent in genTimers (Task 2), tickInterval (Task 3), tick.ts (Task 5), doctor (Task 9) verwendet. `Command` `{ kind:"ticker"; minutes?; badArg? }` (Task 6) deckt sich mit dem Handler (Task 7). `Portfolio.lastTickAt` + `TickDeps.tickIntervalMin` (Task 4) deckt sich mit der Injektion (Task 5). `resolveTickInterval(dir, fallback)`/`writeTickInterval(dir, n)` durchgängig gleich. ✓
