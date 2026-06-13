# C1 Baseline — Feste Kennzahlen-Legende Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Über jedem Positions-Chart im Depot-UI eine immer sichtbare Legende mit aktuellem Kurs, Schwellen (Entry/TP/Wake↑/Wake↓/SL) und vorzeichenbehaftetem Abstand zum Kurs anzeigen.

**Architecture:** Reine Frontend-Arbeit im `ape-ui`-Container. Die riskante, reine Logik (Abstands-% + Legenden-Modell) lebt in einem neuen browser-nativen ESM-Modul `src/ui/public/legend.js`, das `app.js` (Browser) und ein vitest-Test (`src/ui/legend.test.ts`) gemeinsam importieren — `"type": "module"` macht `.js` überall zu ESM, kein Bundler nötig. `server.ts` bekommt nur einen Static-Route-Eintrag, damit der Browser `/legend.js` laden kann; `/api/*` bleibt unverändert. `app.js` bleibt dünner DOM-Kleber.

**Tech Stack:** TypeScript (Node, vitest), vanilla Browser-ESM, node:http, lightweight-charts (unverändert).

**Spec:** `docs/superpowers/specs/2026-06-13-c1-kennzahlen-legende-design.md`

---

## File Structure

- **Create** `src/ui/public/legend.js` — reines ESM-Modul: `distancePct(price, threshold)` + `buildLegend(pos, price)` → Legenden-Modell. Keine DOM-/Browser-Globals.
- **Create** `src/ui/legend.test.ts` — vitest-Test für `legend.js` (wird von `tsc` via `**/*.test.ts`-exclude nicht typgeprüft; von vitest via `src/**/*.test.ts` gesammelt).
- **Modify** `src/ui/server.ts` — einen Eintrag in der `STATIC`-Map: `/legend.js` ausliefern.
- **Modify** `src/ui/server.test.ts` — Test, dass `/legend.js` mit JS-MIME ausgeliefert wird.
- **Modify** `src/ui/public/app.js` — `buildLegend` importieren, `legendBar()` bauen, in `positionCard` einhängen, alte `Entry · SL · TP · Wake`-Meta-Zeile entfernen.
- **Modify** `src/ui/public/style.css` — Styles für `.legend` / `.leg-cell` / Tönungen.

Datenherkunft (alles schon im `/api/state`-Payload): `pos.entryPrice`, `pos.stopLoss`, `pos.takeProfit`, `pos.wakeAbove`, `pos.wakeBelow`; aktueller Kurs `portfolio.lastTick.quotes[ticker].close` (in `app.js` als `quotes` an `positionCard` durchgereicht).

---

## Task 1: Reines Legenden-Modul (`legend.js`) — TDD

**Files:**
- Create: `src/ui/public/legend.js`
- Test: `src/ui/legend.test.ts`

- [ ] **Step 1: Failing test schreiben**

`src/ui/legend.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { distancePct, buildLegend } from "./public/legend.js";

const pos = {
  ticker: "GME", side: "long", leverage: 3, stake: 100,
  entryPrice: 24.1, stopLoss: 22.5, takeProfit: 28, wakeAbove: 26.5, wakeBelow: 23,
};

describe("distancePct", () => {
  it("computes a signed percent distance from price to threshold", () => {
    // (28 - 25.3) / 25.3 * 100 = 10.671...
    expect(distancePct(25.3, 28)).toBeCloseTo(10.6719, 3);
    expect(distancePct(25.3, 22.5)).toBeCloseTo(-11.067, 3);
  });
  it("returns null when price is missing, zero, or negative", () => {
    expect(distancePct(undefined, 28)).toBeNull();
    expect(distancePct(0, 28)).toBeNull();
    expect(distancePct(-5, 28)).toBeNull();
  });
  it("returns null when the threshold is missing", () => {
    expect(distancePct(25.3, undefined)).toBeNull();
  });
});

describe("buildLegend", () => {
  it("builds price + five rows in fixed order with pct on the thresholds", () => {
    const m = buildLegend(pos, 25.3);
    expect(m.price).toBe(25.3);
    expect(m.rows.map((r) => r.key)).toEqual(["entry", "tp", "wakeUp", "wakeDown", "sl"]);
    const tp = m.rows.find((r) => r.key === "tp");
    expect(tp).toMatchObject({ label: "TP", price: 28, tone: "pos" });
    expect(tp.pct).toBeCloseTo(10.6719, 3);
    // Entry is a reference point: shown without a pct.
    expect(m.rows.find((r) => r.key === "entry")).toMatchObject({ price: 24.1, pct: null, tone: "muted" });
  });

  it("uses null price and drops all pct when the current price is missing", () => {
    const m = buildLegend(pos, undefined);
    expect(m.price).toBeNull();
    for (const r of m.rows) expect(r.pct).toBeNull();
    // Threshold prices stay visible.
    expect(m.rows.find((r) => r.key === "sl").price).toBe(22.5);
  });

  it("shows null price and null pct for unset thresholds (no TP, no wake bands)", () => {
    const bare = { ...pos, takeProfit: undefined, wakeAbove: undefined, wakeBelow: undefined };
    const m = buildLegend(bare, 25.3);
    expect(m.rows.find((r) => r.key === "tp")).toMatchObject({ price: null, pct: null });
    expect(m.rows.find((r) => r.key === "wakeUp")).toMatchObject({ price: null, pct: null });
  });

  it("computes the same positional pct for short positions", () => {
    const short = { ...pos, side: "short" };
    expect(buildLegend(short, 25.3).rows.find((r) => r.key === "tp").pct).toBeCloseTo(10.6719, 3);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npx vitest run src/ui/legend.test.ts`
Expected: FAIL — `Failed to resolve import "./public/legend.js"` (Datei existiert noch nicht).

- [ ] **Step 3: Minimal-Implementierung**

`src/ui/public/legend.js`:

```js
// src/ui/public/legend.js — pure legend model for the depot UI position charts.
// Browser-native ESM (no DOM access here); imported by app.js and by vitest.
// "Schwellen" (TP/SL/Wake) carry a signed distance to the current price; Entry
// is a reference point shown without a percent. Missing values degrade to null.

export function distancePct(price, threshold) {
  if (typeof price !== "number" || price <= 0) return null;
  if (typeof threshold !== "number") return null;
  return ((threshold - price) / price) * 100;
}

export function buildLegend(pos, price) {
  const p = typeof price === "number" ? price : null;
  const row = (key, label, value, tone, withPct) => ({
    key,
    label,
    tone,
    price: typeof value === "number" ? value : null,
    pct: withPct ? distancePct(p, value) : null,
  });
  return {
    price: p,
    rows: [
      row("entry", "Entry", pos.entryPrice, "muted", false),
      row("tp", "TP", pos.takeProfit, "pos", true),
      row("wakeUp", "Wake↑", pos.wakeAbove, "wake", true),
      row("wakeDown", "Wake↓", pos.wakeBelow, "wake", true),
      row("sl", "SL", pos.stopLoss, "neg", true),
    ],
  };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npx vitest run src/ui/legend.test.ts`
Expected: PASS (alle 7 it-Blöcke grün).

- [ ] **Step 5: Commit**

```bash
git add src/ui/public/legend.js src/ui/legend.test.ts
git commit -m "feat(ui): reines Legenden-Modell (Kurs/Schwellen/Abstand-%)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: `/legend.js` als Static ausliefern — TDD

**Files:**
- Modify: `src/ui/server.ts` (STATIC-Map, ~Zeile 26–35)
- Test: `src/ui/server.test.ts`

- [ ] **Step 1: Failing test schreiben**

In `src/ui/server.test.ts`, innerhalb des `describe("ui server", …)`-Blocks (z. B. nach dem „serves the equity series and the index page"-Test) einfügen:

```ts
  it("serves the legend module as javascript", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/legend.js`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("buildLegend");
  });
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npx vitest run src/ui/server.test.ts -t "serves the legend module"`
Expected: FAIL — `expected 404 to be 200` (Route fehlt noch).

- [ ] **Step 3: Static-Route ergänzen**

In `src/ui/server.ts` die `STATIC`-Map um einen Eintrag erweitern (nach `"/app.js"`):

```ts
  "/app.js": { file: join(PUBLIC_DIR, "app.js"), type: "text/javascript; charset=utf-8" },
  "/legend.js": { file: join(PUBLIC_DIR, "legend.js"), type: "text/javascript; charset=utf-8" },
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npx vitest run src/ui/server.test.ts`
Expected: PASS (neuer Test grün, bestehende Server-Tests weiterhin grün).

- [ ] **Step 5: Commit**

```bash
git add src/ui/server.ts src/ui/server.test.ts
git commit -m "feat(ui): /legend.js als Static ausliefern

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Legende in `app.js` einhängen + Styles

Kein vitest-Test (DOM-Glue) — die Logik ist in Task 1 abgedeckt. Verifikation visuell in Task 4. Trotzdem in einem Commit gebündelt.

**Files:**
- Modify: `src/ui/public/app.js` (Import oben; `legendBar()` neu; `positionCard` ~Zeile 26–39)
- Modify: `src/ui/public/style.css`

- [ ] **Step 1: `buildLegend` importieren**

Ganz oben in `src/ui/public/app.js` (vor `const $ = …`) einfügen:

```js
import { buildLegend } from "./legend.js";
```

- [ ] **Step 2: `legendBar()` ergänzen**

In `src/ui/public/app.js` direkt nach der `priceLine`-Funktion (vor `async function api`) einfügen:

```js
function legendBar(pos, quotes) {
  const model = buildLegend(pos, quotes[pos.ticker]?.close);
  const fmtPx = (n) => (n === null ? "—" : n.toFixed(2));
  const fmtPct = (p) => (p === null ? "" : ` (${p >= 0 ? "+" : ""}${p.toFixed(1)}%)`);
  const cell = (label, px, pct, tone) =>
    `<span class="leg-cell leg-${tone}"><span class="leg-k">${label}</span> ${fmtPx(px)}${fmtPct(pct)}</span>`;
  const cells = [
    cell("Kurs", model.price, null, "px"),
    ...model.rows.map((r) => cell(r.label, r.price, r.pct, r.tone)),
  ];
  return `<div class="legend">${cells.join("")}</div>`;
}
```

- [ ] **Step 3: `positionCard` umbauen (alte Meta-Zeile raus, Legende über den Chart)**

In `src/ui/public/app.js` den `el.innerHTML`-Block in `positionCard` ersetzen.

Vorher:

```js
  el.innerHTML = `
    <b>${pos.ticker}</b> ${pos.side} ${pos.leverage}x — Einsatz ${usd(pos.stake)}
    ${pnl === null ? "" : `<span class="${pnl >= 0 ? "pnl-pos" : "pnl-neg"}">P&amp;L ${usd(pnl)}</span>`}
    <div class="meta">Entry ${pos.entryPrice} · SL ${pos.stopLoss}${pos.takeProfit ? ` · TP ${pos.takeProfit}` : ""}
      · Wake ${pos.wakeBelow ?? "—"}/${pos.wakeAbove ?? "—"}</div>
    <div class="meta">${pos.thesis ?? ""}</div>
    <div class="chart"></div>`;
```

Nachher:

```js
  el.innerHTML = `
    <b>${pos.ticker}</b> ${pos.side} ${pos.leverage}x — Einsatz ${usd(pos.stake)}
    ${pnl === null ? "" : `<span class="${pnl >= 0 ? "pnl-pos" : "pnl-neg"}">P&amp;L ${usd(pnl)}</span>`}
    <div class="meta">${pos.thesis ?? ""}</div>
    ${legendBar(pos, quotes)}
    <div class="chart"></div>`;
```

- [ ] **Step 4: Styles ergänzen**

Ans Ende von `src/ui/public/style.css` anhängen:

```css
/* Kennzahlen-Legende über dem Positions-Chart (C1) */
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 6px 0;
  padding-bottom: 6px;
  border-bottom: 1px solid #2a3342;
  font-size: 12px;
  line-height: 1.5;
}
.leg-cell { white-space: nowrap; }
.leg-k { color: #8b96a8; }
.leg-px { color: #e6e9ef; font-weight: 700; }
.leg-muted { color: #c2c8d2; }
.leg-pos { color: #3fb68b; }
.leg-neg { color: #e0556a; }
.leg-wake { color: #caa75c; }
```

- [ ] **Step 5: Typecheck + volle Suite (Regression)**

Run: `npm run typecheck && npm run test`
Expected: `tsc` ohne Fehler; vitest komplett grün (inkl. Task-1- und Task-2-Tests). `app.js`/`legend.js`/`style.css` werden von `tsc` nicht erfasst — der Typecheck bestätigt nur, dass nichts anderes brach.

- [ ] **Step 6: Commit**

```bash
git add src/ui/public/app.js src/ui/public/style.css
git commit -m "feat(ui): feste Kennzahlen-Legende ueber dem Positions-Chart

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Visuelle Verifikation lokal

Kein Code — Augenschein im echten UI, bevor wir mergen/deployen.

- [ ] **Step 1: UI lokal mit Fixture starten**

```bash
mkdir -p /tmp/ape-ui-demo
cat > /tmp/ape-ui-demo/portfolio.json <<'JSON'
{
  "balance": 800,
  "positions": [
    { "id": "P1", "ticker": "GME", "side": "long", "stake": 100, "leverage": 3,
      "entryPrice": 24.1, "units": 12, "stopLoss": 22.5, "takeProfit": 28,
      "wakeAbove": 26.5, "wakeBelow": 23, "openedAt": "2026-06-11T14:00:00.000Z", "thesis": "Demo-These" },
    { "id": "P2", "ticker": "AMC", "side": "short", "stake": 50, "leverage": 2,
      "entryPrice": 5, "units": 20, "stopLoss": 5.6, "openedAt": "2026-06-11T14:00:00.000Z", "thesis": "Ohne TP/Wake" }
  ],
  "orders": [], "history": [],
  "lastTick": { "at": "2026-06-11T15:35:00.000Z", "day": "2026-06-11",
    "quotes": { "GME": { "close": 25.3, "changePct": 1, "high": 26, "low": 24 } } }
}
JSON
DATA_DIR=/tmp/ape-ui-demo UI_USER=ape UI_PASS=secret npm run ui
```

(Im Git-Bash-Terminal; `DATA_DIR` wird von `dataDir()` gelesen. AMC hat absichtlich keinen Kurs/kein TP/keine Wake-Bänder, GME hat alles.)

- [ ] **Step 2: Im Browser prüfen**

`http://localhost:8744` öffnen, Basic-Auth `ape`/`secret`. Checkliste:
- GME-Card: Legenden-Leiste über dem Chart zeigt `Kurs 25.30 · Entry 24.10 · TP 28.00 (+10.7%) · Wake↑ 26.50 (+4.7%) · Wake↓ 23.00 (−9.1%) · SL 22.50 (−11.1%)`, Farben TP grün / SL rot / Wake bernstein.
- AMC-Card (kein Kurs in `quotes`, kein TP/Wake): `Kurs —`, `TP —`, `Wake↑ —`, `Wake↓ —`, keine %-Werte; `Entry 5.00`, `SL 5.60` sichtbar.
- Die alte `Entry · SL · TP · Wake`-Textzeile ist weg; Thesis-Zeile bleibt.
- Leiste bricht bei schmalem Fenster sauber um.

- [ ] **Step 3: Server stoppen**

`Ctrl+C` im UI-Terminal.

- [ ] **Step 4 (optional): Auffälligkeiten notieren**

Falls etwas hakt → zurück zu Task 3, sonst weiter zum Branch-Abschluss.

---

## Branch-Abschluss (nach Task 4)

Per Projekt-Konvention (CLAUDE.md): lokaler `--no-ff`-Merge nach `master`, Test-Verifikation auf dem Merge-Ergebnis (`npm run test && npm run typecheck`), Feature-Branch löschen. Anschließend Deploy des `ape-ui`-Containers per `docker build` + Neustart **mit `--network my-lab-net`** (nicht Host-`npm ci`). Handoff/Docs direkt auf `master`.
