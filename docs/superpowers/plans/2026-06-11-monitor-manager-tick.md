# Monitor-Tick + ereignisgesteuerter Manager-Tick (ADR 0003) — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministische Fill-Engine alle 5 Minuten (Monitor-Tick); Sonnet (Manager-Tick) nur noch bei hartem Ereignis, gerissenem Wake-Up-Band oder am Close — mit gebündelter Telegram-Nachricht für jede Manager-Entscheidung.

**Architecture:** `tickPipeline.ts` trennt Monitor-Pfad (Quotes → `applyTick` → Band-Check) vom Manager-Pfad (Sonnet → `applyAdjustments` → Telegram-Bündel). Neue pure Funktionen in `src/paper/wake.ts` (Bänder ableiten, prüfen, verbrauchen). Wake-Bänder leben als optionale Felder auf `Position`/`EntryOrder`; der Cooldown-Zeitstempel liegt im Portfolio (analog `lastTick`). systemd-Timer wechselt auf 5-Minuten-Raster.

**Tech Stack:** TypeScript (ESM), vitest, tsx, systemd-Timer. Keine neuen Dependencies.

**Referenzen:** `docs/adr/0003-event-driven-manager-wake-up-bands.md`, `CONTEXT.md` (Monitor-Tick, Manager-Tick, Wake-Up-Band).

**Konventionen:** Tests laufen mit `npx vitest run <datei>` (Windows/PowerShell wie Linux identisch). Vor jedem Commit: `npm run typecheck`. Commit-Messages auf Englisch, `feat(paper): …`-Stil wie bisher.

---

### Task 1: Typen erweitern (Wake-Felder, neues Adjustment, Cooldown-Feld, WAKE-Konstante)

**Files:**
- Modify: `src/paper/types.ts`

- [ ] **Step 1: Felder und Konstante ergänzen**

In `src/paper/types.ts`:

a) `Position` — nach `takeProfit?: number;` einfügen:

```ts
  /** Soft thresholds that wake the manager (never trade). See ADR 0003. */
  wakeAbove?: number;
  wakeBelow?: number;
```

b) `EntryOrder` — nach `takeProfit?: number;` einfügen:

```ts
  /** Wake-up band carried into the position on fill (ADR 0003). */
  wakeAbove?: number;
  wakeBelow?: number;
```

c) `TradeDecision` — nach `takeProfit?: number;` einfügen:

```ts
  wakeAbove?: number;
  wakeBelow?: number;
```

d) `Portfolio` — nach dem `lastTick`-Feld einfügen:

```ts
  /** Last manager (Sonnet) call — cooldown baseline for band wakes. */
  lastManagerCallAt?: string;
```

e) `Adjustment` — Union um eine Variante erweitern:

```ts
export type Adjustment =
  | { type: "set_stop"; positionId: string; price: number }
  | { type: "set_take_profit"; positionId: string; price: number | null }
  | { type: "set_wake_band"; positionId: string; above: number | null; below: number | null }
  | { type: "close_position"; positionId: string }
  | { type: "cancel_order"; orderId: string };
```

f) Nach dem `COSTS`-Block die neue Konstante:

```ts
/** Wake-up band policy (ADR 0003): fallback derivation + manager cooldown. */
export const WAKE = {
  /** Fraction of the distance to stop/TP at which the fallback band sits. */
  fallbackFraction: 0.5,
  /** Minimum minutes between two band-triggered manager calls. */
  cooldownMinutes: 15,
} as const;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: keine Fehler (nur additive Typen).

- [ ] **Step 3: Commit**

```bash
git add src/paper/types.ts
git commit -m "feat(paper): wake-band fields, set_wake_band adjustment, WAKE policy constants"
```

---

### Task 2: `wake.ts` — Bänder ableiten, prüfen, verbrauchen, auffüllen

**Files:**
- Create: `src/paper/wake.ts`
- Test: `src/paper/wake.test.ts`

- [ ] **Step 1: Failing Tests schreiben**

`src/paper/wake.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkWakeBands, consumeBands, deriveBands, ensureBands } from "./wake";
import type { Portfolio, Position, QuoteMap } from "./types";

const pos = (over: Partial<Position> = {}): Position => ({
  id: "P1",
  ticker: "AAPL",
  side: "long",
  stake: 200,
  leverage: 2,
  entryPrice: 100,
  units: 4,
  stopLoss: 90,
  openedAt: "2026-06-11T14:00:00.000Z",
  thesis: "",
  ...over,
});

const quote = (close: number): QuoteMap[string] => ({ close, changePct: 0, high: close, low: close });

const portfolio = (positions: Position[]): Portfolio => ({
  balance: 1000,
  positions,
  orders: [],
  history: [],
});

describe("deriveBands", () => {
  it("long with TP: below = half way to stop, above = half way to TP", () => {
    const p = pos({ stopLoss: 90, takeProfit: 120 });
    expect(deriveBands(p, 100)).toEqual({ below: 95, above: 110 });
  });

  it("long without TP mirrors the stop distance upwards", () => {
    const p = pos({ stopLoss: 90, takeProfit: undefined });
    expect(deriveBands(p, 100)).toEqual({ below: 95, above: 105 });
  });

  it("short: above = half way to stop, below = half way to TP", () => {
    const p = pos({ side: "short", stopLoss: 110, takeProfit: 80 });
    expect(deriveBands(p, 100)).toEqual({ above: 105, below: 90 });
  });
});

describe("checkWakeBands", () => {
  it("reports a breach when close is at/above wakeAbove", () => {
    const p = pos({ wakeAbove: 110, wakeBelow: 95 });
    const breaches = checkWakeBands([p], { AAPL: quote(111) });
    expect(breaches).toEqual([{ positionId: "P1", ticker: "AAPL", side: "above", level: 110, price: 111 }]);
  });

  it("reports a breach when close is at/below wakeBelow", () => {
    const p = pos({ wakeAbove: 110, wakeBelow: 95 });
    expect(checkWakeBands([p], { AAPL: quote(94) })[0]?.side).toBe("below");
  });

  it("no breach inside the band, no breach without quote, no breach without band", () => {
    expect(checkWakeBands([pos({ wakeAbove: 110, wakeBelow: 95 })], { AAPL: quote(100) })).toEqual([]);
    expect(checkWakeBands([pos({ wakeAbove: 110, wakeBelow: 95 })], {})).toEqual([]);
    expect(checkWakeBands([pos()], { AAPL: quote(150) })).toEqual([]);
  });
});

describe("consumeBands", () => {
  it("clears both band sides of breached positions only", () => {
    const a = pos({ id: "P1", wakeAbove: 110, wakeBelow: 95 });
    const b = pos({ id: "P2", ticker: "TSLA", wakeAbove: 300, wakeBelow: 250 });
    const out = consumeBands(portfolio([a, b]), [
      { positionId: "P1", ticker: "AAPL", side: "above", level: 110, price: 111 },
    ]);
    expect(out.positions[0]).not.toHaveProperty("wakeAbove");
    expect(out.positions[0]).not.toHaveProperty("wakeBelow");
    expect(out.positions[1]?.wakeAbove).toBe(300);
  });
});

describe("ensureBands", () => {
  it("derives bands for positions without any, leaves existing bands alone", () => {
    const bare = pos({ id: "P1", stopLoss: 90, takeProfit: 120 });
    const set = pos({ id: "P2", ticker: "TSLA", wakeAbove: 300, wakeBelow: 250 });
    const { portfolio: out, changed } = ensureBands(portfolio([bare, set]), { AAPL: quote(100), TSLA: quote(280) });
    expect(changed).toBe(true);
    expect(out.positions[0]?.wakeBelow).toBe(95);
    expect(out.positions[0]?.wakeAbove).toBe(110);
    expect(out.positions[1]?.wakeAbove).toBe(300);
  });

  it("does nothing without quotes and reports changed=false", () => {
    const { changed } = ensureBands(portfolio([pos()]), {});
    expect(changed).toBe(false);
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/wake.test.ts`
Expected: FAIL — `Cannot find module './wake'`.

- [ ] **Step 3: `wake.ts` implementieren**

`src/paper/wake.ts`:

```ts
// src/paper/wake.ts — wake-up bands (ADR 0003): soft thresholds that wake the
// manager (Sonnet) without ever trading. Pure functions only.
import { WAKE, type Portfolio, type Position, type QuoteMap } from "./types";

export interface WakeBreach {
  positionId: string;
  ticker: string;
  side: "above" | "below";
  level: number;
  price: number;
}

/**
 * Fallback bands when Mr Ape set none: half the distance to the stop on the
 * losing side; half the distance to the take-profit on the winning side
 * (mirroring the stop distance when there is no TP).
 */
export function deriveBands(pos: Position, price: number): { above: number; below: number } {
  const stopDist = Math.abs(price - pos.stopLoss);
  const tpDist = pos.takeProfit !== undefined ? Math.abs(pos.takeProfit - price) : stopDist;
  return pos.side === "long"
    ? { below: price - stopDist * WAKE.fallbackFraction, above: price + tpDist * WAKE.fallbackFraction }
    : { above: price + stopDist * WAKE.fallbackFraction, below: price - tpDist * WAKE.fallbackFraction };
}

/** Breaches at the current close. Positions without quote or band are silent. */
export function checkWakeBands(positions: Position[], quotes: QuoteMap): WakeBreach[] {
  const breaches: WakeBreach[] = [];
  for (const pos of positions) {
    const q = quotes[pos.ticker];
    if (!q) continue;
    if (pos.wakeAbove !== undefined && q.close >= pos.wakeAbove) {
      breaches.push({ positionId: pos.id, ticker: pos.ticker, side: "above", level: pos.wakeAbove, price: q.close });
    } else if (pos.wakeBelow !== undefined && q.close <= pos.wakeBelow) {
      breaches.push({ positionId: pos.id, ticker: pos.ticker, side: "below", level: pos.wakeBelow, price: q.close });
    }
  }
  return breaches;
}

/** A breached band is consumed: both sides are cleared (it never wakes twice). */
export function consumeBands(p: Portfolio, breaches: WakeBreach[]): Portfolio {
  const breached = new Set(breaches.map((b) => b.positionId));
  return {
    ...p,
    positions: p.positions.map((pos) => {
      if (!breached.has(pos.id)) return pos;
      const { wakeAbove: _a, wakeBelow: _b, ...rest } = pos;
      return rest;
    }),
  };
}

/** Give every quoted position missing BOTH band sides a derived band. */
export function ensureBands(p: Portfolio, quotes: QuoteMap): { portfolio: Portfolio; changed: boolean } {
  let changed = false;
  const positions = p.positions.map((pos) => {
    if (pos.wakeAbove !== undefined || pos.wakeBelow !== undefined) return pos;
    const q = quotes[pos.ticker];
    if (!q) return pos;
    changed = true;
    const bands = deriveBands(pos, q.close);
    return { ...pos, wakeAbove: bands.above, wakeBelow: bands.below };
  });
  return { portfolio: changed ? { ...p, positions } : p, changed };
}
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/wake.test.ts`
Expected: PASS (alle describe-Blöcke).

- [ ] **Step 5: Commit**

```bash
git add src/paper/wake.ts src/paper/wake.test.ts
git commit -m "feat(paper): wake-band derivation, breach check, consumption (ADR 0003)"
```

---

### Task 3: Parser — `set_wake_band` im Tick-Response, Wake-Felder in der Kür-Decision

**Files:**
- Modify: `src/paper/decision.ts`
- Test: `src/paper/decision.test.ts` (ergänzen, Datei existiert)

- [ ] **Step 1: Failing Tests ergänzen**

Am Ende von `src/paper/decision.test.ts` anhängen:

```ts
import { parseDecision as parseDecisionWake, parseTickResponse as parseTickWake } from "./decision";

describe("wake bands (ADR 0003)", () => {
  it("parses set_wake_band with numbers and nulls", () => {
    const raw = JSON.stringify({
      adjustments: [
        { type: "set_wake_band", positionId: "P1", above: 110.5, below: 95 },
        { type: "set_wake_band", positionId: "P2", above: null, below: 250 },
      ],
      journal: "",
    });
    expect(parseTickWake(raw)?.adjustments).toEqual([
      { type: "set_wake_band", positionId: "P1", above: 110.5, below: 95 },
      { type: "set_wake_band", positionId: "P2", above: null, below: 250 },
    ]);
  });

  it("drops a set_wake_band with a malformed side", () => {
    const raw = JSON.stringify({
      adjustments: [{ type: "set_wake_band", positionId: "P1", above: "high", below: 95 }],
      journal: "",
    });
    expect(parseTickWake(raw)?.adjustments).toEqual([]);
  });

  it("parses optional wakeAbove/wakeBelow on Kür trades", () => {
    const raw = JSON.stringify({
      trades: [
        { ticker: "AAPL", side: "long", stake: 200, leverage: 2, entry: "market", stopLoss: 90, wakeAbove: 110, wakeBelow: 95 },
      ],
      journal: "",
    });
    const d = parseDecisionWake(raw);
    expect(d?.trades[0]?.wakeAbove).toBe(110);
    expect(d?.trades[0]?.wakeBelow).toBe(95);
  });
});
```

(Die `describe`/`it`/`expect`-Importe existieren in der Datei bereits; die Funktions-Re-Importe oben vermeiden Namenskollisionen mit bestehenden Test-Helfern — falls die Datei `parseDecision`/`parseTickResponse` schon direkt importiert, stattdessen die bestehenden Importe verwenden und die Alias-Zeile weglassen.)

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/decision.test.ts`
Expected: FAIL — `set_wake_band` wird zu `null` gefiltert bzw. `wakeAbove` ist `undefined`.

- [ ] **Step 3: Parser erweitern**

a) In `parseTickResponse` (in `src/paper/decision.ts`), vor dem `if (o.type === "close_position")`-Block:

```ts
      if (o.type === "set_wake_band") {
        const above = o.above === null ? null : numOr(o.above);
        const below = o.below === null ? null : numOr(o.below);
        return positionId && above !== undefined && below !== undefined
          ? { type: "set_wake_band", positionId, above, below }
          : null;
      }
```

b) In `parseDecision`, im zurückgegebenen Trade-Objekt nach `takeProfit: numOr(o.takeProfit),`:

```ts
        wakeAbove: numOr(o.wakeAbove),
        wakeBelow: numOr(o.wakeBelow),
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/decision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/decision.ts src/paper/decision.test.ts
git commit -m "feat(paper): parse set_wake_band adjustments and Kuer wake fields"
```

---

### Task 4: Engine — `set_wake_band` in `applyAdjustments`

**Files:**
- Modify: `src/paper/engine.ts` (Funktion `applyAdjustments`, ca. Zeile 334–416)
- Test: `src/paper/engine.test.ts` (ergänzen)

- [ ] **Step 1: Failing Tests ergänzen**

Am Ende von `src/paper/engine.test.ts` anhängen (Fixture-Stil an vorhandene Tests der Datei anpassen, falls dort Helfer existieren):

```ts
describe("applyAdjustments: set_wake_band", () => {
  const wakePos: Position = {
    id: "P1", ticker: "AAPL", side: "long", stake: 200, leverage: 2,
    entryPrice: 100, units: 4, stopLoss: 90, openedAt: "2026-06-11T14:00:00.000Z", thesis: "",
  };
  const base: Portfolio = { balance: 1000, positions: [wakePos], orders: [], history: [] };
  const quotes: QuoteMap = { AAPL: { close: 100, changePct: 0, high: 101, low: 99 } };
  const at = "2026-06-11T15:00:00.000Z";

  it("sets both sides when they straddle the current price", () => {
    const r = applyAdjustments(base, [{ type: "set_wake_band", positionId: "P1", above: 110, below: 95 }], quotes, at);
    expect(r.applied).toHaveLength(1);
    expect(r.portfolio.positions[0]?.wakeAbove).toBe(110);
    expect(r.portfolio.positions[0]?.wakeBelow).toBe(95);
  });

  it("clears a side via null", () => {
    const withBands: Portfolio = { ...base, positions: [{ ...wakePos, wakeAbove: 110, wakeBelow: 95 }] };
    const r = applyAdjustments(withBands, [{ type: "set_wake_band", positionId: "P1", above: null, below: 95 }], quotes, at);
    expect(r.portfolio.positions[0]?.wakeAbove).toBeUndefined();
    expect(r.portfolio.positions[0]?.wakeBelow).toBe(95);
  });

  it("rejects a band on the wrong side of the current price", () => {
    const r = applyAdjustments(base, [{ type: "set_wake_band", positionId: "P1", above: 99, below: 95 }], quotes, at);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected[0]?.reason).toContain("Wake-Band");
  });

  it("rejects without a current quote", () => {
    const r = applyAdjustments(base, [{ type: "set_wake_band", positionId: "P1", above: 110, below: 95 }], {}, at);
    expect(r.rejected).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/engine.test.ts`
Expected: FAIL — die neue Adjustment-Art fällt in den `close_position`-else-Zweig bzw. wird abgelehnt.

- [ ] **Step 3: Engine erweitern**

In `applyAdjustments` (`src/paper/engine.ts`), nach dem `set_take_profit`-Zweig und **vor** dem abschließenden `else { // close_position }` einfügen:

```ts
    } else if (adj.type === "set_wake_band") {
      if (!q) {
        reject("kein aktueller Kurs — Wake-Band unverändert");
        continue;
      }
      if (adj.above !== null && !(adj.above > q.close)) {
        reject("Wake-Band oben muss über dem aktuellen Kurs liegen");
        continue;
      }
      if (adj.below !== null && !(adj.below > 0 && adj.below < q.close)) {
        reject("Wake-Band unten muss unter dem aktuellen Kurs liegen");
        continue;
      }
      portfolio = replacePosition(portfolio, {
        ...pos,
        wakeAbove: adj.above ?? undefined,
        wakeBelow: adj.below ?? undefined,
      });
      applied.push(adj);
```

(Der bestehende `else`-Zweig für `close_position` bleibt unverändert dahinter.)

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/engine.test.ts`
Expected: PASS (alte und neue Tests).

- [ ] **Step 5: Commit**

```bash
git add src/paper/engine.ts src/paper/engine.test.ts
git commit -m "feat(paper): apply/validate set_wake_band adjustments in the engine"
```

---

### Task 5: Kür-Durchreichung — Wake-Felder in `placeOrders` und beim Fill

**Files:**
- Modify: `src/paper/engine.ts` (`placeOrders` ca. Zeile 263–319; Fill-Block in `applyTick` ca. Zeile 150–170)
- Test: `src/paper/engine.test.ts` (ergänzen)

- [ ] **Step 1: Failing Tests ergänzen**

Am Ende von `src/paper/engine.test.ts`:

```ts
describe("wake bands through placeOrders and fill", () => {
  const empty: Portfolio = { balance: 1000, positions: [], orders: [], history: [] };
  const q: QuoteMap = { AAPL: { close: 100, changePct: 0, high: 101, low: 99 } };
  const opts = { now: "2026-06-11T13:00:00.000Z", day: "2026-06-11" };

  const decision = (over: Partial<TradeDecision> = {}): TradeDecision => ({
    ticker: "AAPL", side: "long", stake: 100, leverage: 1, entry: "market",
    stopLoss: 90, thesis: "", ...over,
  });

  it("carries valid bands onto the order", () => {
    const r = placeOrders(empty, [decision({ wakeAbove: 110, wakeBelow: 95 })], q, opts);
    expect(r.accepted[0]?.wakeAbove).toBe(110);
    expect(r.accepted[0]?.wakeBelow).toBe(95);
  });

  it("silently drops a band on the wrong side (band is soft, trade stays)", () => {
    const r = placeOrders(empty, [decision({ wakeAbove: 99, wakeBelow: 95 })], q, opts);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]?.wakeAbove).toBeUndefined();
    expect(r.accepted[0]?.wakeBelow).toBe(95);
  });

  it("copies bands from order to position on fill", () => {
    const placed = placeOrders(empty, [decision({ wakeAbove: 110, wakeBelow: 95 })], q, opts);
    const ticked = applyTick(placed.portfolio, q, { now: "2026-06-11T13:35:00.000Z", day: "2026-06-11", isClose: false });
    expect(ticked.portfolio.positions[0]?.wakeAbove).toBe(110);
    expect(ticked.portfolio.positions[0]?.wakeBelow).toBe(95);
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/engine.test.ts`
Expected: FAIL — `wakeAbove` ist auf Order/Position `undefined`.

- [ ] **Step 3: Implementieren**

a) In `placeOrders`, direkt vor der `const order: EntryOrder = {`-Zeile:

```ts
    // Wake bands are soft: an invalid side is dropped, never a trade rejection.
    const wakeAbove = typeof d.wakeAbove === "number" && d.wakeAbove > reference ? d.wakeAbove : undefined;
    const wakeBelow = typeof d.wakeBelow === "number" && d.wakeBelow > 0 && d.wakeBelow < reference ? d.wakeBelow : undefined;
```

und im Order-Literal nach `takeProfit: d.takeProfit,`:

```ts
      wakeAbove,
      wakeBelow,
```

b) In `applyTick`, im `position: Position = { … }`-Literal des Fill-Blocks nach `takeProfit: order.takeProfit,`:

```ts
          wakeAbove: order.wakeAbove,
          wakeBelow: order.wakeBelow,
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/engine.ts src/paper/engine.test.ts
git commit -m "feat(paper): carry wake bands from Kuer decision through order into position"
```

---

### Task 6: Format — Bänder anzeigen, `describeAdjustment` zentralisieren, Telegram-Bündelnachricht

**Files:**
- Modify: `src/paper/format.ts`
- Modify: `src/paper/tickPipeline.ts` (nur: lokale `describeAdjustment`-Funktion am Dateiende **löschen** — der Import kommt in Task 8)
- Test: `src/paper/format.test.ts` (neu)

- [ ] **Step 1: Failing Tests schreiben**

`src/paper/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeAdjustment, formatManagerNote, renderPortfolio } from "./format";
import type { Adjustment, Portfolio, Position, QuoteMap, TickEvent } from "./types";

const pos: Position = {
  id: "P1", ticker: "AAPL", side: "long", stake: 200, leverage: 2,
  entryPrice: 100, units: 4, stopLoss: 90, takeProfit: 120,
  wakeAbove: 110, wakeBelow: 95,
  openedAt: "2026-06-11T14:00:00.000Z", thesis: "",
};
const quotes: QuoteMap = { AAPL: { close: 105, changePct: 1, high: 106, low: 99 } };
const p: Portfolio = { balance: 800, positions: [pos], orders: [], history: [] };

describe("renderPortfolio", () => {
  it("shows the wake band on the position line", () => {
    expect(renderPortfolio(p, quotes)).toContain("Wake 95/110");
  });
});

describe("describeAdjustment", () => {
  it("describes set_wake_band including cleared sides", () => {
    const adj: Adjustment = { type: "set_wake_band", positionId: "P1", above: 112, below: null };
    expect(describeAdjustment(adj)).toBe("Wake-Band von P1: oben 112, unten —");
  });
});

describe("formatManagerNote", () => {
  const applied: Adjustment[] = [{ type: "set_stop", positionId: "P1", price: 98 }];
  const rejected = [{ adjustment: { type: "set_take_profit", positionId: "P1", price: 90 } as Adjustment, reason: "falsche Seite" }];

  it("bundles journal, applied, rejected and close events into one message", () => {
    const closeEvent: TickEvent = {
      kind: "position-closed",
      trade: {
        id: "P2", ticker: "TSLA", side: "long", stake: 100, leverage: 1,
        entryPrice: 200, exitPrice: 210, pnl: 5, reason: "manual",
        openedAt: "2026-06-10T14:00:00.000Z", closedAt: "2026-06-11T15:00:00.000Z",
      },
    };
    const msg = formatManagerNote("15:35", "Stop nachgezogen, Trend intakt.", applied, rejected, [closeEvent]);
    expect(msg).toContain("Mr Ape — Manager-Tick 15:35");
    expect(msg).toContain("Stop nachgezogen");
    expect(msg).toContain("🔧 Stop von P1 auf 98");
    expect(msg).toContain("✗ abgelehnt (falsche Seite)");
    expect(msg).toContain("TSLA");
  });

  it("returns \"\" when there is nothing to say", () => {
    expect(formatManagerNote("15:35", "", [], [], [])).toBe("");
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/format.test.ts`
Expected: FAIL — `describeAdjustment`/`formatManagerNote` existieren in `format.ts` nicht.

- [ ] **Step 3: Implementieren**

a) In `src/paper/format.ts`, `positionLine` — die `tp`-Zeile ergänzen um Bänder (nach `const tp = …`):

```ts
  const wake =
    pos.wakeAbove !== undefined || pos.wakeBelow !== undefined
      ? `, Wake ${pos.wakeBelow ?? "—"}/${pos.wakeAbove ?? "—"}`
      : "";
```

und im Template-String `…, SL ${pos.stopLoss}${tp}, ` zu `…, SL ${pos.stopLoss}${tp}${wake}, ` erweitern.

b) Am Ende von `format.ts` (Import von `Adjustment` in die Typimport-Zeile aufnehmen):

```ts
/** One human line per manager adjustment (journal + Telegram). */
export function describeAdjustment(a: Adjustment): string {
  switch (a.type) {
    case "set_stop":
      return `Stop von ${a.positionId} auf ${a.price}`;
    case "set_take_profit":
      return `Take-Profit von ${a.positionId} auf ${a.price === null ? "entfernt" : a.price}`;
    case "set_wake_band":
      return `Wake-Band von ${a.positionId}: oben ${a.above ?? "—"}, unten ${a.below ?? "—"}`;
    case "close_position":
      return `Position ${a.positionId} schließen`;
    case "cancel_order":
      return `Order ${a.orderId} streichen`;
  }
}

/**
 * The bundled Telegram message for one manager tick (ADR 0003): the why
 * (journal note), every applied adjustment, rejections with reason, and
 * manager-initiated closes. "" when there is nothing to say.
 */
export function formatManagerNote(
  time: string,
  journal: string,
  applied: Adjustment[],
  rejected: Array<{ adjustment: Adjustment; reason: string }>,
  closeEvents: TickEvent[],
): string {
  if (journal.trim() === "" && applied.length === 0 && rejected.length === 0 && closeEvents.length === 0) {
    return "";
  }
  const lines = [`🦍 Mr Ape — Manager-Tick ${time}`];
  if (journal.trim() !== "") lines.push("", journal.trim());
  const closes = closeEvents.map(formatEvent);
  if (closes.length > 0) lines.push("", ...closes);
  const nonClose = applied.filter((a) => a.type !== "close_position");
  if (nonClose.length > 0) lines.push("", ...nonClose.map((a) => `🔧 ${describeAdjustment(a)}`));
  if (rejected.length > 0) lines.push("", ...rejected.map((r) => `✗ abgelehnt (${r.reason}): ${describeAdjustment(r.adjustment)}`));
  return lines.join("\n");
}
```

c) In `src/paper/tickPipeline.ts` die lokale Funktion `describeAdjustment` (am Dateiende, Zeile 114–125) **ersatzlos löschen**. Die Aufrufer in der Datei brechen dadurch kurzzeitig — Task 8 ersetzt die Pipeline komplett; bis dahin den Import ergänzen:

```ts
import { describeAdjustment } from "./format";
```

(in die bestehende `format`-Importzeile aufnehmen).

- [ ] **Step 4: Tests + Typecheck**

Run: `npx vitest run src/paper/format.test.ts; npm run typecheck`
Expected: PASS und keine Typfehler.

- [ ] **Step 5: Commit**

```bash
git add src/paper/format.ts src/paper/format.test.ts src/paper/tickPipeline.ts
git commit -m "feat(paper): wake bands in portfolio rendering + bundled manager Telegram note"
```

---

### Task 7: Prompts — Wake-Bänder erklären (Tick) und anbieten (Kür)

**Files:**
- Modify: `src/paper/prompts.ts`
- Test: `src/paper/prompts.test.ts` (neu, leichtgewichtig)

- [ ] **Step 1: Failing Tests schreiben**

`src/paper/prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDecisionPrompt, buildTickPrompt } from "./prompts";

describe("buildTickPrompt", () => {
  const base = {
    stamp: "2026-06-11 15:35",
    portfolioBlock: "(depot)",
    quotesBlock: "(quotes)",
    eventsBlock: "",
    wakeBlock: "⚡ AAPL: Kurs 111 riss Wake-Band oben (110)",
    journalTail: "",
    isClose: false,
  };

  it("includes the wake reason block and the set_wake_band contract", () => {
    const p = buildTickPrompt(base);
    expect(p).toContain("## Weckgrund");
    expect(p).toContain("riss Wake-Band oben");
    expect(p).toContain("set_wake_band");
  });

  it("omits the wake section when there is no breach", () => {
    expect(buildTickPrompt({ ...base, wakeBlock: "" })).not.toContain("## Weckgrund");
  });
});

describe("buildDecisionPrompt", () => {
  it("offers wakeAbove/wakeBelow in the trade contract", () => {
    const p = buildDecisionPrompt({
      day: "2026-06-11", dossierBlock: "", debateBlock: "", quotesBlock: "",
      portfolioBlock: "", journalTail: "",
    });
    expect(p).toContain("wakeAbove");
    expect(p).toContain("Wake-Up-Band");
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/prompts.test.ts`
Expected: FAIL — `wakeBlock` ist kein Feld von `TickPromptInput`, Texte fehlen.

- [ ] **Step 3: Prompts erweitern**

a) `TickPromptInput` um ein Feld ergänzen:

```ts
  wakeBlock: string; // breached wake bands that triggered this call ("" if none)
```

b) In `buildTickPrompt` nach der `eventsBlock`-Zeile einfügen:

```ts
    input.wakeBlock.trim() === "" ? "" : `## Weckgrund\n${input.wakeBlock}\n`,
```

c) In `buildTickPrompt`, den `## Regeln`-Block um zwei Punkte erweitern (nach der Stop-Regel):

```ts
    "- Wake-Up-Bänder (wakeBelow/wakeAbove) sind WEICHE Schwellen: Sie handeln nicht,",
    "  sie wecken dich nur. Ein gerissenes Band ist verbraucht — setze nach einem Weckruf",
    "  neue Bänder dort, wo du den nächsten Blick brauchst; sonst leitet das System",
    "  automatisch welche ab (halbe Distanz zu Stop bzw. Take-Profit).",
```

und im JSON-Beispiel der adjustments eine Zeile ergänzen:

```ts
    '    { "type": "set_wake_band", "positionId": "...", "above": 112.5, "below": 98 },',
```

d) In `buildDecisionPrompt`, im `## Regeln`-Block einen Punkt ergänzen:

```ts
    "- Optional pro Trade: wakeAbove/wakeBelow — ein Wake-Up-Band (weiche Schwellen, die",
    "  dich im Tagesverlauf wecken, ohne zu handeln). Ohne Angabe leitet das System",
    "  Bänder automatisch ab.",
```

und im JSON-Beispiel des Trades `"takeProfit": 120,` erweitern zu:

```ts
'    { "ticker": "XYZ", "side": "long", "stake": 200, "leverage": 2, "entry": "market", "stopLoss": 95.5, "takeProfit": 120, "wakeAbove": 115, "wakeBelow": 100, "thesis": "1-2 Sätze: warum dieser Trade, warum jetzt" }',
```

- [ ] **Step 4: Tests + Typecheck**

Run: `npx vitest run src/paper/prompts.test.ts; npm run typecheck`
Expected: prompts.test PASS; Typecheck meldet `tickPipeline.ts` (fehlendes `wakeBlock`) — das ist erwartet und wird in Task 8 behoben. Falls der Typecheck-Fehler stört: in `tickPipeline.ts` provisorisch `wakeBlock: "",` in den `buildTickPrompt`-Aufruf einfügen.

- [ ] **Step 5: Commit**

```bash
git add src/paper/prompts.ts src/paper/prompts.test.ts src/paper/tickPipeline.ts
git commit -m "feat(paper): teach tick and Kuer prompts about wake-up bands"
```

---

### Task 8: `tickPipeline.ts` — Monitor-/Manager-Trennung, Cooldown, Bündelnachricht

**Files:**
- Modify: `src/paper/tickPipeline.ts` (kompletter Umbau von `runTick`)
- Test: `src/paper/tickPipeline.test.ts` (bestehende Tests anpassen + neue)

- [ ] **Step 1: Failing Tests schreiben**

Die bestehenden Tests in `src/paper/tickPipeline.test.ts` sichten: Tests, die erwarten, dass Sonnet bei **jedem** Tick mit Positionen gerufen wird, auf das neue Verhalten umschreiben. Dann diese Fälle ergänzen (Fixture-Helfer an den Stil der Datei anpassen):

```ts
describe("monitor/manager split (ADR 0003)", () => {
  const wakePos: Position = {
    id: "P1", ticker: "AAPL", side: "long", stake: 200, leverage: 2,
    entryPrice: 100, units: 4, stopLoss: 90, wakeAbove: 110, wakeBelow: 95,
    openedAt: "2026-06-10T14:00:00.000Z", thesis: "",
  };

  function makeDeps(portfolio: Portfolio, close: number) {
    const saved: Portfolio[] = [];
    const sent: string[] = [];
    const journal: string[] = [];
    let claudeCalls = 0;
    const deps = {
      loadPortfolio: () => portfolio,
      savePortfolio: (p: Portfolio) => { saved.push(p); portfolio = p; },
      appendJournal: (t: string, b: string) => { journal.push(`${t}\n${b}`); },
      readJournalTail: () => "",
      fetchQuotes: async () => ({ AAPL: { close, changePct: 0, high: close, low: close } }),
      claudeRunner: async () => { claudeCalls++; return JSON.stringify({ adjustments: [], journal: null }); },
      send: async (t: string) => { sent.push(t); },
      now: () => new Date("2026-06-11T15:35:00.000Z"),
      berlinDay: () => "2026-06-11",
      berlinStamp: () => "2026-06-11 17:35",
    };
    return { deps, saved, sent, journal, calls: () => claudeCalls };
  }

  it("silent monitor tick: inside the band → no Sonnet call, no Telegram", async () => {
    const { deps, sent, calls } = makeDeps(
      { balance: 800, positions: [wakePos], orders: [], history: [], lastTick: { at: "x", day: "2026-06-11", quotes: {} } },
      100,
    );
    await runTick({ isClose: false }, deps);
    expect(calls()).toBe(0);
    expect(sent).toEqual([]);
  });

  it("band breach wakes the manager and consumes the band", async () => {
    const { deps, saved, calls } = makeDeps(
      { balance: 800, positions: [wakePos], orders: [], history: [], lastTick: { at: "x", day: "2026-06-11", quotes: {} } },
      111,
    );
    await runTick({ isClose: false }, deps);
    expect(calls()).toBe(1);
    const final = saved[saved.length - 1]!;
    expect(final.lastManagerCallAt).toBe("2026-06-11T15:35:00.000Z");
  });

  it("band breach inside the cooldown does NOT wake the manager", async () => {
    const { deps, calls } = makeDeps(
      {
        balance: 800, positions: [wakePos], orders: [], history: [],
        lastTick: { at: "x", day: "2026-06-11", quotes: {} },
        lastManagerCallAt: "2026-06-11T15:25:00.000Z", // 10 min ago < 15 min cooldown
      },
      111,
    );
    await runTick({ isClose: false }, deps);
    expect(calls()).toBe(0);
  });

  it("a hard event (stop fill) wakes the manager even inside the cooldown", async () => {
    // P1 stops out at 90; P2 (deep stop) survives, so there is still
    // something to manage — the event must bypass the band cooldown.
    const survivor: Position = { ...wakePos, id: "P2", stopLoss: 60, wakeAbove: undefined, wakeBelow: undefined };
    const { deps, calls, sent } = makeDeps(
      {
        balance: 800,
        positions: [{ ...wakePos, wakeAbove: undefined, wakeBelow: undefined }, survivor],
        orders: [],
        history: [],
        lastTick: { at: "x", day: "2026-06-11", quotes: { AAPL: { close: 100, changePct: 0, high: 101, low: 99 } } },
        lastManagerCallAt: "2026-06-11T15:34:00.000Z", // 1 min ago — inside the 15-min cooldown
      },
      89, // crosses P1's stop at 90, stays above P2's stop/liquidation
    );
    await runTick({ isClose: false }, deps);
    expect(sent.some((m) => m.includes("Stop-Loss"))).toBe(true);
    expect(calls()).toBe(1);
  });

  it("derives fallback bands for positions without bands", async () => {
    const bare = { ...wakePos, wakeAbove: undefined, wakeBelow: undefined };
    const { deps, saved } = makeDeps(
      { balance: 800, positions: [bare], orders: [], history: [], lastTick: { at: "x", day: "2026-06-11", quotes: {} } },
      100,
    );
    await runTick({ isClose: false }, deps);
    const final = saved[saved.length - 1]!;
    expect(final.positions[0]?.wakeBelow).toBe(95);
    expect(final.positions[0]?.wakeAbove).toBe(105);
  });

  it("close tick always wakes the manager and posts the summary", async () => {
    const { deps, sent, calls } = makeDeps(
      { balance: 800, positions: [wakePos], orders: [], history: [], lastTick: { at: "x", day: "2026-06-11", quotes: {} } },
      100,
    );
    await runTick({ isClose: true }, deps);
    expect(calls()).toBe(1);
    expect(sent.some((m) => m.includes("Tagesabschluss"))).toBe(true);
  });

  it("manager adjustments produce ONE bundled Telegram message", async () => {
    const { deps, sent } = makeDeps(
      { balance: 800, positions: [wakePos], orders: [], history: [], lastTick: { at: "x", day: "2026-06-11", quotes: {} } },
      111,
    );
    deps.claudeRunner = async () =>
      JSON.stringify({
        adjustments: [{ type: "set_stop", positionId: "P1", price: 99 }],
        journal: "Stop nachgezogen.",
      });
    await runTick({ isClose: false }, deps);
    const bundle = sent.find((m) => m.includes("Manager-Tick"));
    expect(bundle).toBeDefined();
    expect(bundle).toContain("Stop nachgezogen.");
    expect(bundle).toContain("🔧 Stop von P1 auf 99");
  });
});
```

**Wichtig — bestehende Tests:** Der alte Test „Sonnet wird bei offenen Positionen gerufen" (falls vorhanden) ist nach ADR 0003 falsch und wird gelöscht bzw. zum „silent monitor tick"-Fall. Events-Verhalten (Fill → Telegram + Journal) bleibt unverändert gültig.

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/tickPipeline.test.ts`
Expected: FAIL — alte Pipeline ruft Sonnet immer, kennt weder Bänder noch Cooldown.

- [ ] **Step 3: `runTick` neu schreiben**

Kompletter neuer Inhalt von `src/paper/tickPipeline.ts`:

```ts
// src/paper/tickPipeline.ts — one MONITOR tick of Mr Ape's depot (ADR 0003):
// deterministic fill check every run; the MANAGER (one Sonnet call) is woken
// only by a hard event, a breached wake band (cooldown-limited) or the close.
// Telegram hears events, the bundled manager note and the daily summary;
// silent monitor ticks post nothing.
import { applyAdjustments, applyTick } from "./engine";
import { checkWakeBands, consumeBands, ensureBands, type WakeBreach } from "./wake";
import {
  describeAdjustment,
  formatDailySummary,
  formatEvent,
  formatManagerNote,
  renderPortfolio,
  renderQuotes,
} from "./format";
import { buildTickPrompt } from "./prompts";
import { parseTickResponse } from "./decision";
import { WAKE, type Portfolio, type QuoteMap, type TickEvent } from "./types";

export interface TickDeps {
  loadPortfolio: () => Portfolio;
  savePortfolio: (p: Portfolio) => void;
  appendJournal: (title: string, body: string) => void;
  readJournalTail: () => string;
  fetchQuotes: (tickers: string[]) => Promise<QuoteMap>;
  /** Sonnet runner (the manager role). */
  claudeRunner: (prompt: string) => Promise<string>;
  send: (text: string) => Promise<void>;
  now?: () => Date;
  berlinDay: (d: Date) => string;
  berlinStamp: (d: Date) => string;
}

export interface TickOptions {
  isClose: boolean;
}

function describeBreach(b: WakeBreach): string {
  return `⚡ ${b.ticker}: Kurs ${b.price} riss Wake-Band ${b.side === "above" ? "oben" : "unten"} (${b.level})`;
}

export async function runTick(opts: TickOptions, deps: TickDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const day = deps.berlinDay(now);
  const stamp = deps.berlinStamp(now);

  let portfolio = deps.loadPortfolio();
  const tickers = [...new Set([...portfolio.positions, ...portfolio.orders].map((x) => x.ticker))];
  const hadActivity =
    portfolio.positions.length > 0 ||
    portfolio.orders.length > 0 ||
    portfolio.history.some((t) => t.closedAt.startsWith(day));

  if (tickers.length === 0 && !(opts.isClose && hadActivity)) {
    console.log("[tick] nothing to do (no open positions/orders).");
    return;
  }

  let quotes: QuoteMap = {};
  if (tickers.length > 0) {
    try {
      quotes = await deps.fetchQuotes(tickers);
    } catch (err) {
      // No quotes → no evidence → skipping the whole tick is the safe move
      // (state untouched; the next tick's day-extreme rule catches up).
      console.error(`[tick] quote fetch failed, skipping tick: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  // --- Monitor path: deterministic engine + wake-band check. ---
  const { portfolio: afterFills, events } = applyTick(portfolio, quotes, {
    now: now.toISOString(),
    day,
    isClose: opts.isClose,
  });
  portfolio = afterFills;

  const breaches = checkWakeBands(portfolio.positions, quotes);
  if (breaches.length > 0) portfolio = consumeBands(portfolio, breaches);
  deps.savePortfolio(portfolio);

  if (events.length > 0) {
    const lines = events.map(formatEvent);
    deps.appendJournal(`Tick ${stamp.slice(11)}`, lines.join("\n"));
    await deps.send(lines.join("\n"));
  }

  // --- Manager path: wake Sonnet only with a reason (ADR 0003). ---
  const hasOpen = portfolio.positions.length > 0 || portfolio.orders.length > 0;
  const cooldownOver =
    portfolio.lastManagerCallAt === undefined ||
    now.getTime() - Date.parse(portfolio.lastManagerCallAt) >= WAKE.cooldownMinutes * 60_000;
  const wake = hasOpen && (events.length > 0 || opts.isClose || (breaches.length > 0 && cooldownOver));

  if (wake) {
    try {
      const raw = await deps.claudeRunner(
        buildTickPrompt({
          stamp,
          portfolioBlock: renderPortfolio(portfolio, quotes),
          quotesBlock: renderQuotes(quotes),
          eventsBlock: events.map(formatEvent).join("\n"),
          wakeBlock: breaches.map(describeBreach).join("\n"),
          journalTail: deps.readJournalTail(),
          isClose: opts.isClose,
        }),
      );
      portfolio = { ...portfolio, lastManagerCallAt: now.toISOString() };

      const response = parseTickResponse(raw);
      if (response && (response.adjustments.length > 0 || response.journal.trim() !== "")) {
        const result = applyAdjustments(portfolio, response.adjustments, quotes, now.toISOString());
        portfolio = result.portfolio;

        const noteLines: string[] = [];
        if (response.journal.trim() !== "") noteLines.push(response.journal.trim());
        for (const a of result.applied) noteLines.push(`→ ${describeAdjustment(a)}`);
        for (const r of result.rejected) noteLines.push(`✗ abgelehnt (${r.reason}): ${describeAdjustment(r.adjustment)}`);
        if (noteLines.length > 0) deps.appendJournal(`Tick ${stamp.slice(11)} — Mr Ape`, noteLines.join("\n"));

        const closeEvents = result.events.filter((e: TickEvent) => e.kind === "position-closed");
        const bundle = formatManagerNote(stamp.slice(11), response.journal, result.applied, result.rejected, closeEvents);
        if (bundle !== "") await deps.send(bundle);
      }
      deps.savePortfolio(portfolio);
    } catch (err) {
      // Stops stay where they are — the deterministic engine keeps protecting.
      console.error(`[tick] manager call failed, keeping current stops: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Fallback bands: every quoted position always carries a band. ---
  const ensured = ensureBands(portfolio, quotes);
  if (ensured.changed) {
    portfolio = ensured.portfolio;
    deps.savePortfolio(portfolio);
  }

  if (opts.isClose && hadActivity) {
    const summary = formatDailySummary(portfolio, quotes, day);
    deps.appendJournal("Tagesabschluss", summary);
    await deps.send(summary);
  }
}
```

- [ ] **Step 4: Alle Tests + Typecheck**

Run: `npx vitest run; npm run typecheck`
Expected: alle Tests PASS, keine Typfehler. (Falls `tick.ts` o. ä. bricht: dort ändert sich nichts — `TickDeps` ist unverändert.)

- [ ] **Step 5: Commit**

```bash
git add src/paper/tickPipeline.ts src/paper/tickPipeline.test.ts
git commit -m "feat(paper): split monitor/manager tick - event-driven Sonnet with wake bands (ADR 0003)"
```

---

### Task 9: systemd-Timer auf 5 Minuten + Doku nachziehen

**Files:**
- Modify: `systemd/ape-signal-tick.timer`
- Modify: `systemd/README.md` (Tick-Beschreibung)
- Modify: `README.md` (Paper-Trading-Bullet)

- [ ] **Step 1: Timer umstellen**

Neuer Inhalt von `systemd/ape-signal-tick.timer`:

```ini
[Unit]
Description=Ape Signal paper-trading monitor tick (every 5 min 15:30-21:55 Europe/Berlin)

[Timer]
# US session in Berlin wall-clock, 5-minute monitor raster (ADR 0003). The
# 22:00 closing tick is a separate timer (ape-signal-tick-close.timer).
# No Persistent: a missed tick is stale; the next one is at most 5 minutes away.
OnCalendar=Mon..Fri *-*-* 15:30/5:00 Europe/Berlin
OnCalendar=Mon..Fri *-*-* 16..21:00/5:00 Europe/Berlin
Unit=ape-signal-tick@Tick.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 2: Timer-Syntax lokal validieren (falls auf Linux/WSL verfügbar)**

Run (auf dem VPS bzw. unter WSL): `systemd-analyze calendar "Mon..Fri *-*-* 15:30/5:00 Europe/Berlin"`
Expected: gültige Ausgabe mit „Next elapse". Ohne Linux-Umgebung: Schritt überspringen und beim Deploy auf dem VPS prüfen.

- [ ] **Step 3: Doku anpassen**

a) In `systemd/README.md` die Beschreibung des Tick-Timers von „halbstündlich" auf „alle 5 Minuten (Monitor-Tick, ADR 0003)" ändern; erwähnen, dass Sonnet nur bei Ereignis/Band-Riss/Close läuft.

b) In `README.md` das Paper-Trading-Bullet ersetzen durch:

```markdown
- **Paper trading "Mr Ape"** (opt-in, `ENABLE_PAPER_TRADING=1`) — a simulated
  CFD-style depot. After the PreUS scan the LLM picks up to 3 trade candidates;
  a 5-minute monitor tick checks fills/stops deterministically against
  TradingView quotes, and the LLM manager is woken only by fills, breached
  wake-up bands or the close (ADR 0003). Every manager decision is posted to
  Telegram; a daily close summary and an append-only trading journal complete
  the picture (`/journal` to read or talk to it). No real orders, ever.
```

- [ ] **Step 4: Voller Testlauf**

Run: `npx vitest run; npm run typecheck`
Expected: PASS / keine Fehler.

- [ ] **Step 5: Commit**

```bash
git add systemd/ape-signal-tick.timer systemd/README.md README.md
git commit -m "feat(paper): 5-minute monitor tick timer + docs for event-driven manager"
```

---

## Deploy-Hinweis (manuell, nach Merge)

Auf dem VPS: `sudo ./scripts/setup.sh` erneut ausführen (installiert die geänderte Timer-Unit), dann `systemctl list-timers 'ape-signal-*'` prüfen. Bestehende `portfolio.json` ist kompatibel — alle neuen Felder sind optional; Positionen ohne Bänder bekommen beim ersten Monitor-Tick automatisch welche.

## Self-Review-Notizen

- ADR 0003 Punkt 1–5 sind abgedeckt durch Task 9 (Timer), Task 8 (ereignisgesteuerter Manager, Cooldown), Task 2+5 (Bänder + Fallback), Task 2 (Re-Arming via consume/ensure), Task 6+8 (Telegram-Bündel).
- Typen-Konsistenz: `set_wake_band` verwendet überall `above/below` (`number | null`); Positions-/Order-Felder heißen überall `wakeAbove`/`wakeBelow`.
- Die Tick-Historie (ADR 0004) ist bewusst NICHT hier — sie kommt im Depot-UI-Plan (`2026-06-11-depot-ui-stufe1.md`), Task 1.
