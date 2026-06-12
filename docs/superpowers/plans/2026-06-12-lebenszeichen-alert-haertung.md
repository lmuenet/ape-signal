# Lebenszeichen & Alert-Härtung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stille Degradation des Monitor-/Manager-Systems sichtbar machen: Telegram-Alert nach 3 Quote-Fetch-Fehlern in Folge (mit Entwarnung), Sofort-Alert bei Manager-Call-Fehlern, unbedingter Tagesabschluss mit Gesundheitszeile.

**Architecture:** Neues pures Modul `src/paper/health.ts` hält Betriebszustand in `DATA_DIR/health.json` (getrennt vom Depot). `runTick` bekommt zwei neue injizierte Deps (`loadHealth`, `saveHealth`) und drei neue Verhaltenspfade: Fehlerzähler+Alert beim Fetch, Sofort-Alert beim Manager-Fehler, Stale-Close-Pfad (Summary mit letzten bekannten Kursen, Expiry über neue Engine-Funktion `expireDayOrders`, kein applyTick/Manager/Band-Check). Spec: `docs/superpowers/specs/2026-06-12-lebenszeichen-alert-haertung-design.md`.

**Tech Stack:** TypeScript (ESM, tsx), vitest, deps-injizierte Tests wie in `src/paper/tickPipeline.test.ts`.

---

## Wichtige Codebase-Fakten (für Kontextlose)

- Tests laufen mit `npx vitest run <datei>` aus dem Repo-Root (`C:\Users\lmueller\ape-signal`).
- `runTick` (in `src/paper/tickPipeline.ts`) ist der eine Monitor-/Manager-Tick; alle Seiteneffekte kommen als `TickDeps` rein — Tests injizieren In-Memory-Fakes (siehe `makeDeps` in `tickPipeline.test.ts`).
- `portfolio.lastTick` ist die **Fill-Beweis-Baseline** (ADR 0001): `applyTick` vergleicht aktuelle Quotes gegen `lastTick.quotes`. Deshalb darf der Stale-Close-Pfad `applyTick` NICHT aufrufen und `lastTick` NICHT anfassen.
- `savePortfolio` schreibt atomar (tmp + rename) — `saveHealth` macht es genauso.
- Telegram-Texte und Journal sind Deutsch; Code-Kommentare Englisch (bestehender Stil).

---

### Task 1: Health-Modul (`health.ts`)

**Files:**
- Create: `src/paper/health.ts`
- Test: `src/paper/health.test.ts`

- [ ] **Step 1: Failing Tests schreiben**

`src/paper/health.test.ts`:

```typescript
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
    let h = freshHealth("2026-06-12");
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
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/health.test.ts`
Expected: FAIL — `Cannot find module './health'` (o.ä.)

- [ ] **Step 3: Implementierung**

`src/paper/health.ts`:

```typescript
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
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/health.test.ts`
Expected: PASS (7 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/paper/health.ts src/paper/health.test.ts
git commit -m "feat(paper): health state module — failure counters, one-shot alert flag, health line"
```

---

### Task 2: `expireDayOrders` in der Engine

**Files:**
- Modify: `src/paper/engine.ts` (neue Funktion nach `applyTick`, vor `isWorse`)
- Test: `src/paper/engine.test.ts` (neuen describe-Block ans Ende anhängen)

- [ ] **Step 1: Failing Test schreiben**

Ans Ende von `src/paper/engine.test.ts` anhängen (Imports oben um `expireDayOrders` ergänzen — die Datei importiert bereits aus `./engine`; Hilfs-Factories für Order/Portfolio existieren dort vermutlich schon, sonst Inline-Objekte wie unten verwenden):

```typescript
describe("expireDayOrders (stale-close path, Lebenszeichen spec)", () => {
  const order = {
    id: "TSLA-2026-06-12-1",
    ticker: "TSLA",
    side: "long" as const,
    stake: 100,
    leverage: 2,
    entryType: "limit" as const,
    limitPrice: 150,
    stopLoss: 140,
    thesis: "t",
    createdAt: "2026-06-12T13:30:00.000Z",
    day: "2026-06-12",
  };

  it("expires due day orders, releases the stake and leaves lastTick untouched", () => {
    const lastTick = { at: "2026-06-12T13:30:00.000Z", day: "2026-06-12", quotes: {} };
    const p = { balance: 900, positions: [], orders: [order], history: [], lastTick };
    const { portfolio, events } = expireDayOrders(p, "2026-06-12");
    expect(portfolio.orders).toHaveLength(0);
    expect(portfolio.balance).toBe(1000);
    expect(portfolio.lastTick).toBe(lastTick); // evidence baseline untouched
    expect(events).toEqual([{ kind: "order-expired", order }]);
  });

  it("keeps orders from a future day", () => {
    const p = { balance: 900, positions: [], orders: [{ ...order, day: "2026-06-13" }], history: [] };
    const { portfolio, events } = expireDayOrders(p, "2026-06-12");
    expect(portfolio.orders).toHaveLength(1);
    expect(portfolio.balance).toBe(900);
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run src/paper/engine.test.ts`
Expected: FAIL — `expireDayOrders` is not exported

- [ ] **Step 3: Implementierung**

In `src/paper/engine.ts` nach dem Ende von `applyTick` (nach Zeile ~238) einfügen:

```typescript
/**
 * Expire due day orders WITHOUT processing quotes — for the stale-close path
 * (Lebenszeichen spec): when the closing tick has no fresh quotes, fills,
 * stops and band checks must not run, but the time-based expiry still must.
 * lastTick (the fill-evidence baseline) is deliberately left untouched.
 */
export function expireDayOrders(p: Portfolio, day: string): TickOutcome {
  const events: TickEvent[] = [];
  let balance = p.balance;
  const orders = p.orders.filter((order) => {
    if (order.day <= day) {
      balance += order.stake; // release the reserved margin
      events.push({ kind: "order-expired", order });
      return false;
    }
    return true;
  });
  return { portfolio: { ...p, balance, orders }, events };
}
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/engine.test.ts`
Expected: PASS (alle, inkl. 2 neue)

- [ ] **Step 5: Commit**

```bash
git add src/paper/engine.ts src/paper/engine.test.ts
git commit -m "feat(paper): expireDayOrders — time-based expiry without quote processing"
```

---

### Task 3: `formatDailySummary` — Stale-Markierung + Gesundheitszeile

**Files:**
- Modify: `src/paper/format.ts:135-147` (`formatDailySummary`)
- Test: `src/paper/format.test.ts` (neuen describe-Block anhängen)

- [ ] **Step 1: Failing Test schreiben**

Ans Ende von `src/paper/format.test.ts` anhängen (`formatDailySummary` ist dort ggf. schon importiert; sonst Import ergänzen):

```typescript
describe("formatDailySummary extras (Lebenszeichen spec)", () => {
  const p = { balance: 800, positions: [], orders: [], history: [] };

  it("marks stale quotes and appends the health line when given", () => {
    const s = formatDailySummary(p, {}, "2026-06-12", {
      staleQuotesFrom: "15:30",
      healthLine: "Monitor: 5 Ticks ok, 3 Quote-Fehler",
    });
    expect(s).toContain("(Kurse von 15:30)");
    expect(s.trimEnd().endsWith("Monitor: 5 Ticks ok, 3 Quote-Fehler")).toBe(true);
  });

  it("stays byte-identical to the old output without opts", () => {
    const s = formatDailySummary(p, {}, "2026-06-12");
    expect(s).not.toContain("Kurse von");
    expect(s).not.toContain("Monitor:");
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run src/paper/format.test.ts`
Expected: FAIL — opts-Parameter existiert nicht / Assertions schlagen fehl

- [ ] **Step 3: Implementierung**

`formatDailySummary` in `src/paper/format.ts` ersetzen durch:

```typescript
/** The after-close Telegram daily summary. */
export function formatDailySummary(
  p: Portfolio,
  quotes: QuoteMap,
  day: string,
  opts: { staleQuotesFrom?: string; healthLine?: string } = {},
): string {
  const todayTrades = p.history.filter((t) => t.closedAt.startsWith(day));
  const dayPnl = todayTrades.reduce((s, t) => s + t.pnl, 0);
  const stale = opts.staleQuotesFrom !== undefined ? ` (Kurse von ${opts.staleQuotesFrom})` : "";
  const lines = [
    `🦍 Mr Ape — Tagesabschluss ${day}`,
    "",
    `Equity: ${usd(equity(p, quotes))} · Guthaben frei: ${usd(p.balance)}${stale}`,
    `Heute realisiert: ${usd(dayPnl)} (${todayTrades.length} Trade${todayTrades.length === 1 ? "" : "s"})`,
    "",
    renderPortfolio(p, quotes).split("\n").slice(2).join("\n"),
  ];
  if (opts.healthLine !== undefined) lines.push("", opts.healthLine);
  return lines.join("\n");
}
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/format.test.ts`
Expected: PASS (alle, inkl. 2 neue)

- [ ] **Step 5: Commit**

```bash
git add src/paper/format.ts src/paper/format.test.ts
git commit -m "feat(paper): daily summary takes stale-quote marker and health line"
```

---

### Task 4: Quote-Fetch-Härtung in `runTick`

**Files:**
- Modify: `src/paper/tickPipeline.ts` (TickDeps + Fetch-Block)
- Test: `src/paper/tickPipeline.test.ts` (`makeDeps` erweitern, neuer describe-Block)

- [ ] **Step 1: `makeDeps` erweitern + Failing Tests schreiben**

In `src/paper/tickPipeline.test.ts`:

Import oben ergänzen:

```typescript
import { freshHealth, type HealthState } from "./health";
```

`makeDeps` ersetzen durch (zwei neue Deps + `healthSaves`-Capture; Rest identisch):

```typescript
function makeDeps(p: Portfolio, quotes: QuoteMap, claudeRaw = '{"adjustments": [], "journal": null}') {
  const saved: Portfolio[] = [];
  const journal: Array<[string, string]> = [];
  const sent: string[] = [];
  const healthSaves: HealthState[] = [];
  const deps: TickDeps = {
    loadPortfolio: () => p,
    savePortfolio: (x) => saved.push(x),
    appendJournal: (title, body) => journal.push([title, body]),
    readJournalTail: () => "",
    fetchQuotes: vi.fn(async () => quotes),
    claudeRunner: vi.fn(async () => claudeRaw),
    send: vi.fn(async (t: string) => {
      sent.push(t);
    }),
    loadHealth: (day) => healthSaves.at(-1) ?? freshHealth(day),
    saveHealth: (h) => healthSaves.push(h),
    now: () => NOW,
    berlinDay,
    berlinStamp,
  };
  return { deps, saved, journal, sent, healthSaves };
}
```

Neuen describe-Block ans Dateiende:

```typescript
describe("quote-failure hardening (Lebenszeichen spec)", () => {
  function failingDeps() {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position()] };
    const made = makeDeps(p, {});
    (made.deps.fetchQuotes as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("429"));
    return made;
  }

  it("stays silent on the first two failures, alerts exactly on the third, not on the fourth", async () => {
    const { deps, sent } = failingDeps();
    await runTick({ isClose: false }, deps);
    await runTick({ isClose: false }, deps);
    expect(sent).toEqual([]);
    await runTick({ isClose: false }, deps);
    expect(sent).toEqual(["⚠️ Monitor blind: 3 Ticks ohne Kurse — Stops werden nicht geprüft."]);
    await runTick({ isClose: false }, deps);
    expect(sent).toHaveLength(1); // one-shot: no repeat
  });

  it("sends the all-clear on the first successful tick after an active alert", async () => {
    const { deps, sent } = failingDeps();
    for (let i = 0; i < 3; i++) await runTick({ isClose: false }, deps);
    (deps.fetchQuotes as ReturnType<typeof vi.fn>).mockResolvedValue({
      NVDA: { close: 110, changePct: 1, high: 111, low: 99 },
    });
    await runTick({ isClose: false }, deps);
    expect(sent.some((m) => m.includes("✅ Monitor wieder ok"))).toBe(true);
  });

  it("counts only quote-fetching ticks as ticksOk (no-op ticks don't count)", async () => {
    const { deps, healthSaves } = makeDeps(freshPortfolio(1000), {});
    await runTick({ isClose: false }, deps); // empty depot → early return
    expect(healthSaves).toHaveLength(0);
  });

  it("a saveHealth failure never breaks the tick", async () => {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position({ wakeAbove: 120, wakeBelow: 90 })], lastTick: { at: "x", day: "2026-06-09", quotes: { NVDA: { close: 108, changePct: 0, high: 109, low: 99 } } } };
    const { deps, saved } = makeDeps(p, { NVDA: { close: 110, changePct: 1, high: 111, low: 99 } });
    deps.saveHealth = () => {
      throw new Error("disk full");
    };
    await runTick({ isClose: false }, deps);
    expect(saved.length).toBeGreaterThan(0); // portfolio still saved
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/tickPipeline.test.ts`
Expected: FAIL — `loadHealth`/`saveHealth` existieren nicht auf `TickDeps` (TS-Fehler) bzw. neue Tests schlagen fehl

- [ ] **Step 3: Implementierung in `tickPipeline.ts`**

Import oben ergänzen:

```typescript
import { healthLine, recordQuoteFailure, recordQuoteSuccess, type HealthState } from "./health";
```

In `TickDeps` nach `recordTick` einfügen:

```typescript
  /** Operational health for `day` (Lebenszeichen spec): stats + failure counters. */
  loadHealth: (day: string) => HealthState;
  /** Persist health. Failures are caught by the pipeline (never break a tick). */
  saveHealth: (h: HealthState) => void;
```

Hilfsfunktion auf Modulebene (neben `describeBreach`):

```typescript
function trySaveHealth(deps: TickDeps, h: HealthState): void {
  try {
    deps.saveHealth(h);
  } catch (err) {
    console.error(`[tick] saving health failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

Den Quote-Fetch-Block in `runTick` (bisher Zeilen 61–76) ersetzen durch:

```typescript
  let health = deps.loadHealth(day);
  let quotes: QuoteMap = {};
  // The close tick must never skip (it is the daily lifesign): on a fetch
  // failure it falls back to the last known quotes for VALUATION ONLY.
  let staleClose = false;
  if (tickers.length > 0) {
    try {
      quotes = await deps.fetchQuotes(tickers);
    } catch (err) {
      console.error(`[tick] quote fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      const failed = recordQuoteFailure(health);
      health = failed.health;
      trySaveHealth(deps, health);
      if (failed.alert) {
        await deps.send(`⚠️ Monitor blind: ${health.consecutiveQuoteFailures} Ticks ohne Kurse — Stops werden nicht geprüft.`);
      }
      // No quotes → no evidence → skipping the monitor tick is the safe move
      // (state untouched; the next tick's day-extreme rule catches up).
      if (!opts.isClose) return;
      staleClose = true;
      quotes = portfolio.lastTick?.quotes ?? {};
    }
    if (!staleClose) {
      const ok = recordQuoteSuccess(health);
      health = ok.health;
      trySaveHealth(deps, health);
      if (ok.allClear) await deps.send("✅ Monitor wieder ok — Kurse kommen wieder durch.");
      try {
        deps.recordTick?.(day, now.toISOString(), quotes);
      } catch (err) {
        console.error(`[tick] recording tick history failed (charts lose one point): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
```

(`staleClose` bleibt in diesem Task immer wirkungslos hinter dem Fetch-Block — der Stale-Pfad durch Monitor/Manager/Summary kommt in Task 6. Der Code kompiliert, weil `staleClose` erst dort gelesen wird; bis dahin die Variable mit `void staleClose;` direkt nach dem Block als gelesen markieren, falls der Linter `noUnusedLocals` meckert — in Task 6 wird das wieder entfernt.)

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run src/paper/tickPipeline.test.ts`
Expected: PASS — bis auf die zwei Stale-Close-Erwartungen gibt es hier noch keine; alle Alt-Tests und die 4 neuen müssen grün sein. Hinweis: Der Alt-Test „skips the tick entirely when quotes fail (state untouched)" bleibt grün (1. Fehler < Schwelle → kein send, kein savePortfolio).

- [ ] **Step 5: Commit**

```bash
git add src/paper/tickPipeline.ts src/paper/tickPipeline.test.ts
git commit -m "feat(paper): quote-failure counter with one-shot alert and all-clear (ADR 0003 hardening)"
```

---

### Task 5: Manager-Call-Sofort-Alert

**Files:**
- Modify: `src/paper/tickPipeline.ts` (catch des `claudeRunner`-Blocks)
- Test: `src/paper/tickPipeline.test.ts`

- [ ] **Step 1: Failing Test schreiben**

In den describe-Block `"quote-failure hardening (Lebenszeichen spec)"` (oder als eigener Block daneben):

```typescript
  it("alerts immediately when the manager call fails (stops stay)", async () => {
    const p: Portfolio = { ...freshPortfolio(900), orders: [order()] };
    const { deps, sent } = makeDeps(p, { TSLA: { close: 200, changePct: 0, high: 201, low: 199 } });
    (deps.claudeRunner as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    await runTick({ isClose: false }, deps);
    expect(sent.some((m) => m.includes("⚠️ Mr Ape nicht erreichbar"))).toBe(true);
  });
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run src/paper/tickPipeline.test.ts`
Expected: FAIL — Alert wird nicht gesendet

- [ ] **Step 3: Implementierung**

Den catch-Block des Manager-Pfads in `runTick` ersetzen:

```typescript
    } catch (err) {
      // Stops stay where they are — the deterministic engine keeps protecting.
      console.error(`[tick] manager call failed, keeping current stops: ${err instanceof Error ? err.message : String(err)}`);
      try {
        await deps.send("⚠️ Mr Ape nicht erreichbar (Manager-Call fehlgeschlagen) — Stops bleiben unverändert.");
      } catch (sendErr) {
        console.error(`[tick] failed to send manager-failure alert: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
      }
    }
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/tickPipeline.test.ts`
Expected: PASS. Hinweis: Der Alt-Test „survives a Claude failure" prüft nur Fills/Save und bleibt grün.

- [ ] **Step 5: Commit**

```bash
git add src/paper/tickPipeline.ts src/paper/tickPipeline.test.ts
git commit -m "feat(paper): immediate Telegram alert when the manager call fails"
```

---

### Task 6: Unbedingter Tagesabschluss (Stale-Close-Pfad) + Gesundheitszeile

**Files:**
- Modify: `src/paper/tickPipeline.ts` (Monitor-Pfad, Manager-Wake-Bedingung, ensureBands, Summary)
- Test: `src/paper/tickPipeline.test.ts`

- [ ] **Step 1: Failing Tests schreiben**

Neuer describe-Block ans Dateiende:

```typescript
describe("unconditional close (stale quotes, Lebenszeichen spec)", () => {
  const realLastTick = {
    at: "2026-06-09T13:30:00.000Z", // 15:30 Berlin
    day: "2026-06-09",
    quotes: { NVDA: { close: 108, changePct: 0, high: 109, low: 99 } },
  };

  function staleCloseDeps(extra: Partial<Portfolio> = {}) {
    const p: Portfolio = { ...freshPortfolio(800), positions: [position()], lastTick: realLastTick, ...extra };
    const made = makeDeps(p, {});
    (made.deps.fetchQuotes as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("429"));
    return made;
  }

  it("still posts the daily summary with stale marker and health line", async () => {
    const { deps, sent } = staleCloseDeps();
    await runTick({ isClose: true }, deps);
    const summary = sent.find((m) => m.includes("Tagesabschluss"));
    expect(summary).toBeDefined();
    expect(summary).toContain("(Kurse von 15:30)");
    expect(summary).toContain("Monitor:");
  });

  it("expires day orders but never fills, never calls the manager, never touches lastTick", async () => {
    const { deps, saved, sent } = staleCloseDeps({
      orders: [order({ entryType: "market" })], // would fill instantly with ANY quote
    });
    await runTick({ isClose: true }, deps);
    const final = saved.at(-1)!;
    expect(final.orders).toHaveLength(0); // expired
    expect(final.positions).toHaveLength(1); // NOT filled into a second position
    expect(final.balance).toBe(900); // stake released
    expect(final.lastTick).toEqual(realLastTick); // evidence baseline untouched
    expect(deps.claudeRunner).not.toHaveBeenCalled();
    expect(sent.some((m) => m.includes("Order verfallen"))).toBe(true);
  });

  it("does not derive new bands from stale quotes", async () => {
    const { deps, saved } = staleCloseDeps(); // position() has no bands
    await runTick({ isClose: true }, deps);
    expect(saved.at(-1)!.positions[0]?.wakeAbove).toBeUndefined();
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/tickPipeline.test.ts`
Expected: FAIL — Summary kommt nicht (early return) bzw. Order würde gefüllt

- [ ] **Step 3: Implementierung in `tickPipeline.ts`**

Import um `expireDayOrders` ergänzen:

```typescript
import { applyAdjustments, applyTick, expireDayOrders } from "./engine";
```

Den Monitor-Pfad (bisher `applyTick` + Band-Check + save + events) ersetzen durch:

```typescript
  // --- Monitor path: deterministic engine + wake-band check. ---
  // Stale quotes never drive fills, stops or band checks (they are the
  // evidence baseline itself); only the time-based expiry still runs.
  let events: TickEvent[];
  let breaches: WakeBreach[] = [];
  if (staleClose) {
    const expired = expireDayOrders(portfolio, day);
    portfolio = expired.portfolio;
    events = expired.events;
  } else {
    const afterTick = applyTick(portfolio, quotes, {
      now: now.toISOString(),
      day,
      isClose: opts.isClose,
    });
    portfolio = afterTick.portfolio;
    events = afterTick.events;
    breaches = checkWakeBands(portfolio.positions, quotes);
    if (breaches.length > 0) portfolio = consumeBands(portfolio, breaches);
  }
  deps.savePortfolio(portfolio);
```

(Das in Task 4 ggf. eingefügte `void staleClose;` entfernen. Der Import von `WakeBreach` als Typ existiert bereits.)

Die Manager-Wake-Bedingung ersetzen (Stale-Close weckt nie — ein `close_position` würde zu stalen Kursen ausgeführt):

```typescript
  const wake =
    !staleClose && hasOpen && (events.length > 0 || opts.isClose || (breaches.length > 0 && cooldownOver));
```

Den `ensureBands`-Block bedingen:

```typescript
  // --- Fallback bands: every quoted position always carries a band. ---
  if (!staleClose) {
    const ensured = ensureBands(portfolio, quotes);
    if (ensured.changed) {
      portfolio = ensured.portfolio;
      deps.savePortfolio(portfolio);
    }
  }
```

Den Summary-Block ersetzen:

```typescript
  if (opts.isClose && hadActivity) {
    const staleQuotesFrom =
      staleClose && portfolio.lastTick !== undefined
        ? deps.berlinStamp(new Date(portfolio.lastTick.at)).slice(11)
        : undefined;
    const summary = formatDailySummary(portfolio, quotes, day, {
      staleQuotesFrom,
      healthLine: healthLine(health),
    });
    deps.appendJournal("Tagesabschluss", summary);
    await deps.send(summary);
  }
```

- [ ] **Step 4: Alle Paper-Tests laufen lassen**

Run: `npx vitest run src/paper/`
Expected: PASS — alle. Hinweis: „close tick always wakes the manager" (Alt-Test) bleibt grün, weil er mit frischen Quotes läuft.

- [ ] **Step 5: Commit**

```bash
git add src/paper/tickPipeline.ts src/paper/tickPipeline.test.ts
git commit -m "feat(paper): unconditional daily summary — stale-quote close path with health line"
```

---

### Task 7: Verdrahtung in `tick.ts`, Glossar, Gesamtlauf

**Files:**
- Modify: `src/paper/tick.ts` (deps-Verdrahtung)
- Modify: `CONTEXT.md` (Glossar „Monitor-Tick" + „Tagesabschluss")

- [ ] **Step 1: `tick.ts` verdrahten**

Import ergänzen:

```typescript
import { loadHealth, saveHealth } from "./health";
```

Im `runTick`-Aufruf nach `recordTick` einfügen:

```typescript
      loadHealth: (day) => loadHealth(dir, day),
      saveHealth: (h) => saveHealth(dir, h),
```

- [ ] **Step 2: Typprüfung + kompletter Testlauf**

Run: `npx tsc --noEmit` und `npx vitest run`
Expected: beide ohne Fehler (die stderr-Warnungen degradierter Quellen in Scan-Tests sind bekannt und ok)

- [ ] **Step 3: Glossar aktualisieren**

In `CONTEXT.md` den Absatz „Monitor-Tick" um diesen Satz ergänzen (ans Ende des Absatzes):

```
Bleiben die Kurse mehrere Ticks in Folge aus, meldet der Monitor das einmalig
per Telegram (mit Entwarnung, sobald sie wieder da sind) — Stille heißt immer
„ruhiger Markt", nie „System tot".
```

Den Absatz „Tagesabschluss" ersetzen durch:

```
### Tagesabschluss
Kurzbilanz nach US-Close auf Telegram: Equity, Tages-P&L, offene Positionen und
eine Monitor-Gesundheitszeile (Ticks ok / Quote-Fehler). Der Tagesabschluss ist
unbedingt: Fehlen frische Kurse, bilanziert er mit den letzten bekannten (als
solche markiert) — bleibt er um 22:00 ganz aus, ist das System tot. Neben Kür,
Fills und Manager-Tick-Notizen das einzige proaktive Posting — stille
Monitor-Ticks posten nichts.
```

- [ ] **Step 4: Commit**

```bash
git add src/paper/tick.ts CONTEXT.md
git commit -m "feat(paper): wire health state into the tick entrypoint; document the lifesign contract"
```

---

## Self-Review-Notizen

- Spec-Abdeckung: §1 health.json → Task 1; §2 Schwelle/Alert/Entwarnung/ticksOk-Regel → Task 4; §3 Manager-Sofort-Alert → Task 5; §4 unbedingter Tagesabschluss + expireDayOrders + Manager-Skip + Gesundheitszeile → Tasks 2, 3, 6; §5 Fehlerpfade → trySaveHealth (Task 4) + nested catch (Task 5); Glossar → Task 7.
- Typkonsistenz: `HealthState`, `loadHealth(day)`, `saveHealth(h)`, `recordQuoteFailure/Success`, `healthLine`, `expireDayOrders` — Namen in allen Tasks identisch.
- `engine.test.ts`/`format.test.ts` habe ich nicht gelesen — die neuen describe-Blöcke sind in sich geschlossen (eigene Fixtures); beim Anhängen vorhandene Importe prüfen und nur fehlende ergänzen.
