# Kür-Ansicht im Depot-UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Kandidatenkür persistiert ihre Artefakte (Dossier, Debatte, Entscheidung, Orders) als JSON pro Tag; das read-only Depot-UI zeigt sie in einer neuen „Kandidatenkür"-Section mit Tagesauswahl.

**Architecture:** Neues Modul `src/paper/kuerArtifact.ts` (Typ + atomares Save/Load/List unter `DATA_DIR/kuer/`). `runKuer` bekommt ein injiziertes Dep `saveKuer` und speichert an beiden Ausgängen (decided / skipped-unreadable); Save-Fehler brechen die Kür nie ab. Das UI bekommt zwei Routen (`/api/kuer/days`, `/api/kuer?day=`) und eine neue Section im bestehenden einspaltigen Layout (kein Tab-System — das Frontend hat keins; die Spec meint die Ansicht). Spec: `docs/superpowers/specs/2026-06-12-kuer-ansicht-design.md`.

**Tech Stack:** TypeScript (ESM, tsx), vitest, node:http-UI ohne Framework, Vanilla-JS-Frontend.

---

## Wichtige Codebase-Fakten (für Kontextlose)

- Tests: `npx vitest run <datei>` aus dem Repo-Root.
- `runKuer` (`src/paper/select.ts`) hat `dossier: Dossier | null`, `debate: Debate | null`, `decision` (mit `.journal`), `accepted: EntryOrder[]`, `rejected: Array<{decision: TradeDecision; reason: string}>` bereits im Speicher — wir speichern sie nur.
- `Dossier`/`Debate` sind in `src/paper/decision.ts` definiert, `EntryOrder`/`Side` in `src/paper/types.ts`.
- Verdrahtung der Kür: `src/scan/index.ts` (~Zeile 88, `runKuer(...)`-Aufruf mit deps-Objekt; `dir` ist dort definiert).
- UI-Server: `src/ui/server.ts`, Routen als `if (path === "...")`-Kette; Tests in `src/ui/server.test.ts` mit `fixture()` + `start()` + Basic-Auth-Header `AUTH`.
- Frontend: `src/ui/public/index.html` (Sections), `app.js` (Vanilla, `$`-Helper, `api()`-Helper, `load()` am Ende), `style.css` (Dark Theme, `.card`/`.meta`/`.empty`-Klassen).

---

### Task 1: Artefakt-Modul (`kuerArtifact.ts`)

**Files:**
- Create: `src/paper/kuerArtifact.ts`
- Test: `src/paper/kuerArtifact.test.ts`

- [ ] **Step 1: Failing Tests schreiben**

`src/paper/kuerArtifact.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listKuerDays, loadKuerArtifact, saveKuerArtifact, type KuerArtifact } from "./kuerArtifact";

function artifact(day: string): KuerArtifact {
  return {
    day,
    createdAt: `${day}T13:25:00.000Z`,
    scanSummary: "NVDA: signal",
    dossier: {
      candidates: [{ ticker: "NVDA", angle: "Momentum", catalyst: "Earnings", sentiment: "euphorisch" }],
      marketContext: "risk-on",
    },
    debate: { debates: [{ ticker: "NVDA", bull: "stark", bear: "überkauft" }] },
    decisionJournal: "Heute NVDA long.",
    orders: [],
    rejected: [{ ticker: "TSLA", side: "short", reason: "kein Kurs" }],
    status: "decided",
  };
}

describe("kuerArtifact", () => {
  it("round-trips through kuer/<day>.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ape-kuer-"));
    try {
      const a = artifact("2026-06-12");
      saveKuerArtifact(dir, a);
      expect(loadKuerArtifact(dir, "2026-06-12")).toEqual(a);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for a missing day", () => {
    const dir = mkdtempSync(join(tmpdir(), "ape-kuer-"));
    try {
      expect(loadKuerArtifact(dir, "2026-06-12")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists days newest first, ignoring foreign files", () => {
    const dir = mkdtempSync(join(tmpdir(), "ape-kuer-"));
    try {
      saveKuerArtifact(dir, artifact("2026-06-10"));
      saveKuerArtifact(dir, artifact("2026-06-12"));
      saveKuerArtifact(dir, artifact("2026-06-11"));
      expect(listKuerDays(dir)).toEqual(["2026-06-12", "2026-06-11", "2026-06-10"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists nothing when the directory does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "ape-kuer-"));
    try {
      expect(listKuerDays(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/kuerArtifact.test.ts`
Expected: FAIL — `Failed to load url ./kuerArtifact`

- [ ] **Step 3: Implementierung**

`src/paper/kuerArtifact.ts`:

```typescript
// src/paper/kuerArtifact.ts — structured per-day record of the Kandidatenkür
// (Kür-Ansicht spec 2026-06-12): dossier, debate, decision and orders are
// persisted at the source so the depot UI can replay why Mr Ape traded.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Debate, Dossier } from "./decision";
import type { EntryOrder, Side } from "./types";

export interface KuerArtifact {
  day: string;
  createdAt: string; // ISO
  /** Compact PreUS scan block — the basis the research worked from. */
  scanSummary: string;
  /** null = research degraded (scan-only decision). */
  dossier: Dossier | null;
  /** null = debate failed or never attempted (no dossier). */
  debate: Debate | null;
  /** Opus' reasoning; null = unreadable decision. */
  decisionJournal: string | null;
  /** Accepted orders verbatim (incl. wake bands). */
  orders: EntryOrder[];
  rejected: Array<{ ticker: string; side: Side; reason: string }>;
  status: "decided" | "skipped-unreadable";
}

const kuerDir = (dir: string) => join(dir, "kuer");

/** Atomic save (tmp + rename), one file per Kür day. */
export function saveKuerArtifact(dir: string, artifact: KuerArtifact): void {
  mkdirSync(kuerDir(dir), { recursive: true });
  const path = join(kuerDir(dir), `${artifact.day}.json`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

export function loadKuerArtifact(dir: string, day: string): KuerArtifact | null {
  const path = join(kuerDir(dir), `${day}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as KuerArtifact;
}

/** Days with a Kür artifact, newest first. */
export function listKuerDays(dir: string): string[] {
  const kdir = kuerDir(dir);
  if (!existsSync(kdir)) return [];
  return readdirSync(kdir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse();
}
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/kuerArtifact.test.ts`
Expected: PASS (4 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/paper/kuerArtifact.ts src/paper/kuerArtifact.test.ts
git commit -m "feat(paper): Kuer artifact module - per-day JSON under DATA_DIR/kuer"
```

---

### Task 2: `runKuer` persistiert die Artefakte (+ Verdrahtung)

**Files:**
- Modify: `src/paper/select.ts`
- Modify: `src/scan/index.ts` (deps-Objekt im `runKuer`-Aufruf)
- Test: `src/paper/select.test.ts`

- [ ] **Step 1: `makeDeps` erweitern + Failing Tests schreiben**

In `src/paper/select.test.ts` den Import ergänzen:

```typescript
import type { KuerArtifact } from "./kuerArtifact";
```

`makeDeps` ersetzen (neues Dep `saveKuer` + `kuerSaves`-Capture; Rest identisch):

```typescript
function makeDeps(p: Portfolio, quotes: QuoteMap, over: Partial<KuerDeps> = {}) {
  const saved: Portfolio[] = [];
  const journal: Array<[string, string]> = [];
  const sent: string[] = [];
  const kuerSaves: KuerArtifact[] = [];
  const deps: KuerDeps = {
    loadPortfolio: () => p,
    savePortfolio: (x) => saved.push(x),
    appendJournal: (t, b) => journal.push([t, b]),
    readJournalTail: () => "",
    fetchQuotes: vi.fn(async () => quotes),
    researchRunner: vi.fn(async () => DOSSIER),
    debateRunner: vi.fn(async () => DEBATE),
    decideRunner: vi.fn(async () => DECISION),
    send: vi.fn(async (t: string) => {
      sent.push(t);
    }),
    saveKuer: (a) => kuerSaves.push(a),
    now: () => NOW,
    berlinDay,
    ...over,
  };
  return { deps, saved, journal, sent, kuerSaves };
}
```

Neuen describe-Block ans Dateiende:

```typescript
describe("Kür artifact persistence (Kür-Ansicht spec)", () => {
  it("saves a decided artifact with dossier, debate, journal, orders and scan summary", async () => {
    const { deps, kuerSaves } = makeDeps(freshPortfolio(1000), quotes);
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    const a = kuerSaves.at(-1)!;
    expect(a.status).toBe("decided");
    expect(a.day).toBe(DAY);
    expect(a.scanSummary).toBe("NVDA: signal");
    expect(a.dossier?.candidates[0]?.ticker).toBe("NVDA");
    expect(a.debate?.debates[0]?.bear).toContain("überkauft");
    expect(a.decisionJournal).toContain("NVDA long");
    expect(a.orders).toHaveLength(1);
    expect(a.orders[0]?.ticker).toBe("NVDA");
  });

  it("records rejected trades with reason", async () => {
    const { deps, kuerSaves } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () =>
        JSON.stringify({
          trades: [{ ticker: "XXXX", side: "long", stake: 100, leverage: 1, entry: "market", stopLoss: 1, thesis: "" }],
          journal: "Versuch.",
        }),
      ),
    });
    await runKuer({ scanSummary: "" }, deps);
    const a = kuerSaves.at(-1)!;
    expect(a.orders).toHaveLength(0);
    expect(a.rejected[0]?.ticker).toBe("XXXX");
    expect(a.rejected[0]?.reason).toContain("kein Kurs");
  });

  it("saves a skipped-unreadable artifact that still archives dossier and debate", async () => {
    const { deps, kuerSaves } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () => "kein JSON heute"),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    const a = kuerSaves.at(-1)!;
    expect(a.status).toBe("skipped-unreadable");
    expect(a.decisionJournal).toBeNull();
    expect(a.orders).toEqual([]);
    expect(a.dossier?.candidates).toHaveLength(1);
  });

  it("saves no artifact when the daily budget is already used (skip before research)", async () => {
    const p: Portfolio = {
      ...freshPortfolio(400),
      orders: [1, 2, 3].map((i) => ({
        id: `X-${DAY}-${i}`,
        ticker: "X",
        side: "long" as const,
        stake: 100,
        leverage: 1,
        entryType: "market" as const,
        stopLoss: 1,
        thesis: "",
        createdAt: NOW.toISOString(),
        day: DAY,
      })),
    };
    const { deps, kuerSaves } = makeDeps(p, quotes);
    await runKuer({ scanSummary: "" }, deps);
    expect(kuerSaves).toHaveLength(0);
  });

  it("a saveKuer failure never breaks the Kür (post still goes out)", async () => {
    const { deps, sent, saved } = makeDeps(freshPortfolio(1000), quotes, {
      saveKuer: () => {
        throw new Error("disk full");
      },
    });
    await runKuer({ scanSummary: "" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1);
    expect(sent[0]).toContain("Kandidatenkür");
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/select.test.ts`
Expected: FAIL — `saveKuer` existiert nicht auf `KuerDeps` (TS) bzw. neue Tests rot

- [ ] **Step 3: Implementierung in `select.ts`**

Import ergänzen:

```typescript
import type { KuerArtifact } from "./kuerArtifact";
```

In `KuerDeps` nach `send` einfügen:

```typescript
  /** Persist the day's Kür artifact (Kür-Ansicht spec). Failures must not break the Kür. */
  saveKuer: (artifact: KuerArtifact) => void;
```

Hilfsfunktion auf Modulebene (neben `renderDebate`):

```typescript
function trySaveKuer(deps: KuerDeps, artifact: KuerArtifact): void {
  try {
    deps.saveKuer(artifact);
  } catch (err) {
    console.error(`[kuer] saving artifact failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

Den Unlesbar-Block ersetzen:

```typescript
  const decision = parseDecision(raw);
  if (!decision) {
    console.error("[kuer] unreadable decision, skipping today (no guessed trades).");
    trySaveKuer(deps, {
      day,
      createdAt: now.toISOString(),
      scanSummary: opts.scanSummary,
      dossier,
      debate,
      decisionJournal: null,
      orders: [],
      rejected: [],
      status: "skipped-unreadable",
    });
    await deps.send("⚠️ Mr Ape: Kandidatenkür heute ausgefallen (Entscheidung nicht lesbar). Morgen wieder.");
    return;
  }
```

Nach `deps.savePortfolio(portfolio);` (vor dem `journalBody`-Block) einfügen:

```typescript
  trySaveKuer(deps, {
    day,
    createdAt: now.toISOString(),
    scanSummary: opts.scanSummary,
    dossier,
    debate,
    decisionJournal: decision.journal,
    orders: accepted,
    rejected: rejected.map((r) => ({ ticker: r.decision.ticker, side: r.decision.side, reason: r.reason })),
    status: "decided",
  });
```

- [ ] **Step 4: Verdrahtung in `src/scan/index.ts`**

Import ergänzen:

```typescript
import { saveKuerArtifact } from "../paper/kuerArtifact";
```

Im deps-Objekt des `runKuer`-Aufrufs (nach `send` bzw. neben den anderen deps) einfügen:

```typescript
        saveKuer: (a) => saveKuerArtifact(dir, a),
```

- [ ] **Step 5: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/select.test.ts` und `npx tsc --noEmit`
Expected: PASS (alle, inkl. 5 neue); tsc ohne Fehler

- [ ] **Step 6: Commit**

```bash
git add src/paper/select.ts src/paper/select.test.ts src/scan/index.ts
git commit -m "feat(paper): runKuer persists its artifacts at both exits"
```

---

### Task 3: UI-API-Routen

**Files:**
- Modify: `src/ui/server.ts`
- Test: `src/ui/server.test.ts`

- [ ] **Step 1: Failing Tests schreiben**

In `src/ui/server.test.ts` die `fixture()`-Funktion am Ende (nach dem ticks-Write) ergänzen:

```typescript
  mkdirSync(join(dir, "kuer"));
  writeFileSync(
    join(dir, "kuer", "2026-06-11.json"),
    JSON.stringify({
      day: "2026-06-11",
      createdAt: "2026-06-11T13:25:00.000Z",
      scanSummary: "AAPL: signal",
      dossier: { candidates: [{ ticker: "AAPL", angle: "Momentum", catalyst: "Earnings", sentiment: "bullish" }], marketContext: "" },
      debate: { debates: [{ ticker: "AAPL", bull: "stark", bear: "teuer" }] },
      decisionJournal: "AAPL long.",
      orders: [],
      rejected: [],
      status: "decided",
    }),
  );
```

Neuen describe-Block ans Dateiende:

```typescript
describe("kuer routes (Kür-Ansicht spec)", () => {
  it("lists kuer days newest first", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/api/kuer/days`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["2026-06-11"]);
  });

  it("serves the artifact for a day", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/api/kuer?day=2026-06-11`, { headers: AUTH });
    expect(res.status).toBe(200);
    const a = await res.json();
    expect(a.decisionJournal).toBe("AAPL long.");
    expect(a.dossier.candidates[0].ticker).toBe("AAPL");
  });

  it("400s a malformed day and 404s a missing one", async () => {
    fixture();
    const base = await start();
    expect((await fetch(`${base}/api/kuer?day=..%2Fjournal`, { headers: AUTH })).status).toBe(400);
    expect((await fetch(`${base}/api/kuer?day=2026-01-01`, { headers: AUTH })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/ui/server.test.ts`
Expected: FAIL — die drei neuen Tests bekommen 404

- [ ] **Step 3: Implementierung in `server.ts`**

Import ergänzen:

```typescript
import { listKuerDays, loadKuerArtifact } from "../paper/kuerArtifact";
```

Nach dem `/api/equity`-Block (vor `res.writeHead(404)`) einfügen:

```typescript
      if (path === "/api/kuer/days") {
        sendJson(res, listKuerDays(opts.dir));
        return;
      }
      if (path === "/api/kuer") {
        const day = url.searchParams.get("day") ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          res.writeHead(400).end("bad day");
          return;
        }
        const artifact = loadKuerArtifact(opts.dir, day);
        if (!artifact) {
          res.writeHead(404).end("no kuer for that day");
          return;
        }
        sendJson(res, artifact);
        return;
      }
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/ui/server.test.ts`
Expected: PASS (alle, inkl. 3 neue)

- [ ] **Step 5: Commit**

```bash
git add src/ui/server.ts src/ui/server.test.ts
git commit -m "feat(ui): kuer routes - day list and per-day artifact"
```

---

### Task 4: Frontend-Section „Kandidatenkür"

**Files:**
- Modify: `src/ui/public/index.html` (neue Section zwischen „Offene Orders" und „Journal")
- Modify: `src/ui/public/app.js`
- Modify: `src/ui/public/style.css`

Frontend hat keine Unit-Tests (bestehender Zustand) — verifiziert wird über die Server-Tests (Routen) und Sichtprüfung nach Deploy.

- [ ] **Step 1: `index.html` — Section einfügen**

Zwischen der Orders-Section und der Journal-Section:

```html
    <section>
      <h2>Kandidatenkür</h2>
      <div id="kuer"></div>
    </section>
```

- [ ] **Step 2: `app.js` — Renderer ergänzen**

Nach `renderJournal` einfügen (LLM-Texte werden escaped — anders als die eigenen Zahlenfelder):

```javascript
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderKuerArtifact(a) {
  const debates = a.debate?.debates ?? [];
  const cards = (a.dossier?.candidates ?? []).map((c) => {
    const d = debates.find((x) => x.ticker === c.ticker);
    return `<div class="card">
      <b>${esc(c.ticker)}</b> — ${esc(c.angle)}
      <div class="meta">Katalysator: ${esc(c.catalyst)} · Sentiment: ${esc(c.sentiment)}</div>
      ${d ? `<div class="bullbear"><div><b class="pnl-pos">Bull</b><br>${esc(d.bull)}</div><div><b class="pnl-neg">Bear</b><br>${esc(d.bear)}</div></div>` : ""}
    </div>`;
  });
  const orders = a.orders.map(
    (o) => `<div class="card"><b>${esc(o.ticker)}</b> ${o.side} ${o.leverage}x — Einsatz ${usd(o.stake)},
      ${o.entryType === "market" ? "Market" : `Limit ${o.limitPrice}`}, SL ${o.stopLoss}${o.takeProfit ? `, TP ${o.takeProfit}` : ""}
      <div class="meta">${esc(o.thesis)}</div></div>`,
  );
  const rejected = a.rejected.map((r) => `<div class="meta">✗ ${esc(r.ticker)} ${r.side} — ${esc(r.reason)}</div>`);
  return [
    a.dossier ? "" : '<p class="empty">Research fehlgeschlagen — entschieden auf Scan-Basis.</p>',
    cards.join(""),
    a.dossier && !a.debate ? '<p class="empty">Keine Debatte verfügbar.</p>' : "",
    a.status === "skipped-unreadable"
      ? '<p class="empty">Entscheidung unlesbar — keine Trades an diesem Tag.</p>'
      : `<article><h3>Mr Apes Begründung</h3><pre>${esc(a.decisionJournal ?? "")}</pre></article>`,
    orders.length ? `<h3>Platzierte Orders</h3>${orders.join("")}` : a.status === "decided" ? '<p class="empty">Keine Orders platziert.</p>' : "",
    rejected.length ? `<h3>Abgelehnt</h3>${rejected.join("")}` : "",
    a.scanSummary ? `<details><summary>Scan-Kontext</summary><pre>${esc(a.scanSummary)}</pre></details>` : "",
  ].join("");
}

async function showKuerDay(day) {
  $("#kuer-detail").innerHTML = renderKuerArtifact(await api(`/api/kuer?day=${day}`));
}

async function renderKuerSection() {
  const days = await api("/api/kuer/days");
  if (days.length === 0) {
    $("#kuer").innerHTML = '<span class="empty">Noch keine Kür-Artefakte — entstehen ab der nächsten Kandidatenkür.</span>';
    return;
  }
  $("#kuer").innerHTML = `<select id="kuer-day">${days.map((d) => `<option>${d}</option>`).join("")}</select><div id="kuer-detail"></div>`;
  $("#kuer-day").onchange = (e) => showKuerDay(e.target.value).catch(console.error);
  await showKuerDay(days[0]);
}
```

In `load()` nach `renderJournal(await api("/api/journal", true));` einfügen (nicht-fatal — ein Kür-Fehler darf die Depot-Ansicht nicht töten):

```javascript
  renderKuerSection().catch((err) => {
    $("#kuer").innerHTML = `<span class="empty">Kür-Ansicht nicht ladbar: ${esc(err.message)}</span>`;
  });
```

- [ ] **Step 3: `style.css` — Ergänzungen ans Dateiende**

```css
.bullbear { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; font-size: 14px; }
#kuer select { background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; margin: 4px 0 8px; font: inherit; }
#kuer h3 { font-size: 14px; color: var(--dim); margin: 16px 0 4px; }
#kuer pre { white-space: pre-wrap; font: inherit; margin: 0; }
#kuer details { margin-top: 12px; color: var(--dim); }
#kuer details summary { cursor: pointer; }
```

- [ ] **Step 4: Smoke-Test über den Server**

Run: `npx vitest run src/ui/` (Routen + Statik weiter grün)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/public/index.html src/ui/public/app.js src/ui/public/style.css
git commit -m "feat(ui): Kandidatenkuer section - day picker, dossier cards, bull/bear, decision"
```

---

### Task 5: Gesamtlauf

- [ ] **Step 1: Typprüfung + komplette Suite**

Run: `npx tsc --noEmit` und `npx vitest run`
Expected: beide ohne Fehler (stderr-Warnungen degradierter Quellen in Scan-Tests sind bekannt und ok)

- [ ] **Step 2: Kein Commit nötig** (Tasks 1–4 sind committet; dieser Task verifiziert nur)

---

## Self-Review-Notizen

- Spec-Abdeckung: §1 Artefakt/Schema → Task 1; §2 beide Ausgänge + Save-Fehler-Toleranz + Verdrahtung → Task 2; §3 Routen inkl. 400/404 → Task 3; §4 Ansicht inkl. Degradationshinweise + `<details>`-Scan-Kontext → Task 4. „Kein Artefakt bei Budget-Skip" → Test in Task 2.
- Typkonsistenz: `KuerArtifact`, `saveKuerArtifact(dir, a)`, `loadKuerArtifact(dir, day)`, `listKuerDays(dir)`, Dep `saveKuer` — in allen Tasks identisch.
- Abweichung von der Spec (dokumentiert): „Tab" → eigene Section im bestehenden einspaltigen Layout; das Frontend hat kein Tab-System, die Spec meint die Ansicht.
