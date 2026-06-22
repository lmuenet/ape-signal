# Kür-Spiegelung, Reflection-Loop & opportunistische Mini-Kür — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spiegele die internen Kür-Stufen verdichtet nach Telegram, gib Opus einen kostenfreien Track-Record als Lernstoff und baue den Intraday-Pfad zu einer Mini-Kür (Sonnet-Research → Opus) mit Live-Meldungen um.

**Architecture:** Ansatz A — geteilte reine Builder (`format.ts`) und ein Datenmodell-Feld (`ClosedTrade.thesis`), genutzt von zwei getrennten Orchestratoren (`select.ts` Tages-Kür, `intraday.ts` Mini-Kür). Track-Record wird aus der vorhandenen `portfolio.history` gerendert (kein neuer Store). Reflection ist kostenfrei (Opus reflektiert inline). Mini-Kür kostet +1 Opus-Call pro gegatetem Trigger.

**Tech Stack:** TypeScript (ESM, `type: module`), tsx-Runtime, vitest. Claude via `createClaudeRunner` (Sonnet/Opus). Telegram via `deps.send`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-kuer-spiegelung-reflection-mini-kuer-design.md`.
- Alle LLM-Freitext-Werte folgen `env.language` (Default `de`); JSON-Keys/Enums bleiben Englisch. Prompts hängen `jsonOnly(lang)` an (Muster `prompts.ts`).
- Best-effort heißt: in try/catch, Fehler nur `console.error`, niemals den Hauptpfad abbrechen (Muster `tryDegradeAlert`/`trySaveKuer` in `select.ts`).
- „Nie raten": unlesbare/leere/limitierte LLM-Antwort des Entscheiders → kein Trade.
- Guardrails unverändert (`GUARDRAILS`, `intradayGateOpen`).
- Tests via `npm test` (vitest). Commit-Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Vor Arbeitsbeginn Feature-Branch (kein Commit auf master für Code): `git checkout -b feat/kuer-spiegelung-reflection-mini-kuer`.

---

### Task 1: `thesis` in `ClosedTrade` + Propagierung beim Schließen

**Files:**
- Modify: `src/paper/types.ts` (Interface `ClosedTrade`, ~Zeile 86)
- Modify: `src/paper/engine.ts` (`closeTrade`, ~Zeile 100-115)
- Test: `src/paper/engine.test.ts`

**Interfaces:**
- Produces: `ClosedTrade.thesis: string` (von `Position.thesis` beim Close übernommen).

- [ ] **Step 1: Failing test** — in `src/paper/engine.test.ts` einen Test ergänzen, der eine Position mit These schließt und prüft, dass der ClosedTrade die These trägt. Nutze die im File bereits vorhandenen Helfer/Imports (z. B. `runTick`/Close-Pfad oder den direkten Close, wie im File üblich). Minimal-Beispiel über einen Stop-Close:

```ts
it("carries the position thesis into the closed trade", () => {
  const p: Portfolio = {
    ...freshPortfolio(1000),
    positions: [{
      id: "AMD-1", ticker: "AMD", side: "long", stake: 100, leverage: 1,
      entryPrice: 100, units: 1, stopLoss: 95, openedAt: "2026-06-09T13:00:00Z",
      thesis: "EMA-Cross Pullback",
    }],
  };
  const quotes: QuoteMap = { AMD: { close: 94, changePct: -6, high: 100, low: 94 } };
  const { portfolio } = runTick(p, quotes, { now: "2026-06-09T15:00:00Z", day: "2026-06-09" });
  expect(portfolio.history.at(-1)?.thesis).toBe("EMA-Cross Pullback");
});
```

  (Falls `runTick`/Typen anders heißen oder importiert werden müssen, an die im File etablierten Muster anpassen — Signaturen NICHT erfinden.)

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- engine`
Expected: FAIL — `thesis` ist `undefined` (Feld existiert noch nicht).

- [ ] **Step 3: Implementierung**

In `src/paper/types.ts`, Interface `ClosedTrade`, neues Feld ergänzen (nach `source?`):

```ts
  /** Where the trade originated. Absent → "kuer". Carried for the intraday budget tier. */
  source?: TradeSource;
  /** The position's thesis at entry — carried into the reflection track-record. */
  thesis: string;
```

In `src/paper/engine.ts`, `closeTrade`, im zurückgegebenen `trade`-Objekt ergänzen (nach `source: pos.source,`):

```ts
      source: pos.source,
      thesis: pos.thesis,
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/types.ts src/paper/engine.ts src/paper/engine.test.ts
git commit -m "feat(paper): These in ClosedTrade tragen (Reflection-Grundlage)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `renderTrackRecord` + `closeReasonLabel` (Builder)

**Files:**
- Modify: `src/paper/format.ts`
- Test: `src/paper/format.test.ts`

**Interfaces:**
- Consumes: `ClosedTrade` (mit `thesis` aus Task 1), `sign`/`usd` (modulintern in format.ts).
- Produces:
  - `export const closeReasonLabel: Record<ClosedTrade["reason"], string>`
  - `export function renderTrackRecord(history: ClosedTrade[], limit: number): string`

- [ ] **Step 1: Failing test** — in `src/paper/format.test.ts`:

```ts
import { renderTrackRecord } from "./format";
import type { ClosedTrade } from "./types";

const ct = (over: Partial<ClosedTrade> = {}): ClosedTrade => ({
  id: "1", ticker: "AMD", side: "long", stake: 100, leverage: 2,
  entryPrice: 100, exitPrice: 106, pnl: 12, reason: "take-profit",
  openedAt: "2026-06-06T13:00:00Z", closedAt: "2026-06-09T13:00:00Z",
  thesis: "EMA-Cross Pullback", ...over,
});

describe("renderTrackRecord", () => {
  it("is empty-friendly", () => {
    expect(renderTrackRecord([], 8)).toContain("noch keine abgeschlossenen Trades");
  });
  it("renders one line per trade with reason, pnl%% and hold duration", () => {
    const out = renderTrackRecord([ct()], 8);
    expect(out).toContain("AMD long");
    expect(out).toContain("EMA-Cross Pullback");
    expect(out).toContain("Take-Profit");
    expect(out).toContain("+12.00%");
    expect(out).toContain("3 Tage");
  });
  it("marks sub-day holds and respects the limit", () => {
    const intraday = ct({ openedAt: "2026-06-09T13:00:00Z", closedAt: "2026-06-09T17:00:00Z", reason: "stop", pnl: -20 });
    expect(renderTrackRecord([intraday], 8)).toContain("<1 Tag");
    const many = Array.from({ length: 10 }, (_, i) => ct({ id: String(i), ticker: `T${i}` }));
    const out = renderTrackRecord(many, 3);
    expect(out.split("\n").filter((l) => l.includes("long")).length).toBe(3);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- format`
Expected: FAIL — `renderTrackRecord` ist nicht exportiert.

- [ ] **Step 3: Implementierung** — in `src/paper/format.ts`:

Den lokalen `reasonText` in `formatEvent` durch einen exportierten Record ersetzen und wiederverwenden. Oben (nach den Imports) ergänzen:

```ts
/** Human label per close reason (shared by event lines and the track-record). */
export const closeReasonLabel: Record<ClosedTrade["reason"], string> = {
  stop: "Stop-Loss",
  "take-profit": "Take-Profit",
  liquidation: "LIQUIDIERT",
  manual: "Geschlossen",
};
```

In `formatEvent` den lokalen `const reasonText: Record<...> = {...}` entfernen und die Verwendung `reasonText[t.reason]` durch `closeReasonLabel[t.reason]` ersetzen.

`ClosedTrade` zum bestehenden Type-Import aus `./types` hinzufügen (in der vorhandenen `import type { … } from "./types"`-Zeile).

Neuen Builder ans Dateiende anfügen:

```ts
/** Reflection block: the last `limit` closed trades as one line each (for the decider prompt). */
export function renderTrackRecord(history: ClosedTrade[], limit: number): string {
  const recent = history.slice(-limit).reverse();
  const lines = ["## Bisheriger Track-Record (Lehren)"];
  if (recent.length === 0) {
    lines.push("(noch keine abgeschlossenen Trades)");
    return lines.join("\n");
  }
  for (const t of recent) {
    const days = (Date.parse(t.closedAt) - Date.parse(t.openedAt)) / 86_400_000;
    const hold = days < 1 ? "<1 Tag" : `${Math.round(days)} Tag${Math.round(days) === 1 ? "" : "e"}`;
    const pnlPct = sign((t.pnl / t.stake) * 100);
    const thesis = t.thesis?.trim() ? `These „${t.thesis.trim()}"` : "ohne These";
    lines.push(`${t.ticker} ${t.side}, ${thesis} → ${closeReasonLabel[t.reason]}, P&L ${pnlPct}% (${hold})`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/format.ts src/paper/format.test.ts
git commit -m "feat(paper): renderTrackRecord + closeReasonLabel (Reflection-Block)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Track-Record in den Kür-Entscheider-Prompt einspeisen

**Files:**
- Modify: `src/paper/prompts.ts` (`DecisionPromptInput`, `buildDecisionPrompt`)
- Modify: `src/paper/select.ts` (Aufruf von `buildDecisionPrompt`)
- Test: `src/paper/prompts.test.ts`

**Interfaces:**
- Consumes: `renderTrackRecord` (Task 2).
- Produces: `DecisionPromptInput.trackRecordBlock: string`.

- [ ] **Step 1: Failing test** — in `src/paper/prompts.test.ts`:

```ts
it("includes the track-record block in the decision prompt", () => {
  const out = buildDecisionPrompt({
    day: "2026-06-09", dossierBlock: "d", debateBlock: "x", quotesBlock: "q",
    portfolioBlock: "p", trackRecordBlock: "## Bisheriger Track-Record (Lehren)\nAMD long …",
    journalTail: "", language: "de",
  });
  expect(out).toContain("Bisheriger Track-Record (Lehren)");
  expect(out).toContain("AMD long");
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- prompts`
Expected: FAIL — `trackRecordBlock` ist kein gültiges Feld / fehlt im Output.

- [ ] **Step 3: Implementierung** — in `src/paper/prompts.ts`:

`DecisionPromptInput` um ein Feld ergänzen:

```ts
export interface DecisionPromptInput {
  day: string;
  dossierBlock: string;
  debateBlock: string;
  quotesBlock: string;
  portfolioBlock: string;
  trackRecordBlock: string; // rendered renderTrackRecord(history, N)
  journalTail: string;
  language?: Language;
}
```

In `buildDecisionPrompt` den Track-Record vor dem Journal-Abschnitt einfügen (zwischen Debatte-Block und „## Dein Journal"):

```ts
    input.debateBlock,
    "",
    input.trackRecordBlock,
    "",
    "## Dein Journal (letzte Einträge)",
```

In `src/paper/select.ts`: `renderTrackRecord` aus `./format` importieren (bestehende format-Importzeile erweitern) und beim Aufruf von `buildDecisionPrompt` (~Zeile 171) ergänzen:

```ts
        portfolioBlock: renderPortfolio(portfolio, quotes),
        trackRecordBlock: renderTrackRecord(portfolio.history, 8),
        journalTail,
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- prompts select`
Expected: PASS (alle bestehenden select/prompts-Tests bleiben grün).

- [ ] **Step 5: Commit**

```bash
git add src/paper/prompts.ts src/paper/select.ts src/paper/prompts.test.ts
git commit -m "feat(paper): Track-Record in Kür-Entscheider-Prompt (Reflection inline)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: `formatDecisionMirror` (Builder)

**Files:**
- Modify: `src/paper/format.ts`
- Test: `src/paper/format.test.ts`

**Interfaces:**
- Consumes: `Dossier`, `Debate` (`import type` aus `./decision`).
- Produces: `export function formatDecisionMirror(dossier: Dossier | null, debate: Debate | null): string`.

- [ ] **Step 1: Failing test** — in `src/paper/format.test.ts`:

```ts
import { formatDecisionMirror } from "./format";
import type { Dossier, Debate } from "./decision";

describe("formatDecisionMirror", () => {
  const dossier: Dossier = {
    candidates: [{ ticker: "AMD", angle: "Long auf Pullback", catalyst: "Earnings", sentiment: "bullisch" }],
    marketContext: "SPY ruhig, VIX niedrig",
  };
  const debate: Debate = { debates: [{ ticker: "AMD", bull: "Trend intakt", bear: "RSI hoch" }] };

  it("merges dossier + debate into one line per candidate plus market line", () => {
    const out = formatDecisionMirror(dossier, debate);
    expect(out).toContain("Research & Debatte");
    expect(out).toContain("AMD: Long auf Pullback");
    expect(out).toContain("Bull Trend intakt / Bear RSI hoch");
    expect(out).toContain("Marktlage: SPY ruhig, VIX niedrig");
  });
  it("renders angle only when a candidate has no debate", () => {
    const out = formatDecisionMirror(dossier, { debates: [] });
    expect(out).toContain("AMD: Long auf Pullback");
    expect(out).not.toContain("Bull");
  });
  it("returns empty string when there is nothing to mirror", () => {
    expect(formatDecisionMirror(null, null)).toBe("");
    expect(formatDecisionMirror({ candidates: [], marketContext: "" }, null)).toBe("");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- format`
Expected: FAIL — `formatDecisionMirror` nicht exportiert.

- [ ] **Step 3: Implementierung** — in `src/paper/format.ts`:

Type-Import ergänzen (oben):

```ts
import type { Dossier, Debate } from "./decision";
```

Builder ans Dateiende anfügen:

```ts
/** Condensed Telegram mirror of the Kür's research dossier + bull/bear debate. */
export function formatDecisionMirror(dossier: Dossier | null, debate: Debate | null): string {
  if (!dossier && !debate) return "";
  const candidates = dossier?.candidates ?? [];
  const lines: string[] = [];
  for (const c of candidates) {
    const d = debate?.debates.find((x) => x.ticker === c.ticker);
    lines.push(d ? `${c.ticker}: ${c.angle} · Bull ${d.bull} / Bear ${d.bear}` : `${c.ticker}: ${c.angle}`);
  }
  if (lines.length === 0) return "";
  const header = [`🦍 Mr Ape — Research & Debatte (${new Date().toISOString().slice(0, 10)})`, ""];
  if (dossier && dossier.marketContext.trim() !== "") lines.push("", `Marktlage: ${dossier.marketContext.trim()}`);
  return [...header, ...lines].join("\n");
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/format.ts src/paper/format.test.ts
git commit -m "feat(paper): formatDecisionMirror (verdichtete Kür-Spiegelung)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Spiegelung in `runKuer` senden (best-effort)

**Files:**
- Modify: `src/paper/select.ts` (`runKuer`, nach dem `formatKuer`-Send ~Zeile 262)
- Test: `src/paper/select.test.ts`

**Interfaces:**
- Consumes: `formatDecisionMirror` (Task 4).

- [ ] **Step 1: Failing test** — in `src/paper/select.test.ts` (nutze die dort bereits etablierten Test-Helfer/Mocks für `runKuer`; ergänze die zwei Fälle):

```ts
it("mirrors the dossier+debate to Telegram after the Kür post", async () => {
  // … Standard-Setup wie in den bestehenden runKuer-Tests, mit erfolgreichem
  // research/debate/decide. Danach:
  const mirror = sent.find((m) => m.includes("Research & Debatte"));
  expect(mirror).toBeDefined();
});

it("does not break the Kür if the mirror send fails", async () => {
  // send wirft NUR beim Mirror (z. B. zweiter Aufruf nach formatKuer):
  // sicherstellen, dass runKuer trotzdem normal durchläuft (Portfolio gespeichert).
  await runKuer(opts, deps);
  expect(saved.length).toBeGreaterThan(0);
});
```

  (Die genaue Mock-Verdrahtung an die im File vorhandenen `runKuer`-Tests anpassen — keine neuen Helfer erfinden.)

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- select`
Expected: FAIL — keine „Research & Debatte"-Nachricht.

- [ ] **Step 3: Implementierung** — in `src/paper/select.ts`:

`formatDecisionMirror` aus `./format` importieren (bestehende Importzeile erweitern).

Am Ende von `runKuer`, NACH `await deps.send(formatKuer(...))` (~Zeile 262), ergänzen:

```ts
  await deps.send(formatKuer(accepted, rejected.map((r) => `${r.decision.ticker}: ${r.reason}`), decision.journal));

  // Verdichtete Spiegelung der Herleitung — best-effort, darf die Kür nie brechen.
  const mirror = formatDecisionMirror(dossier, debate);
  if (mirror !== "") {
    try {
      await deps.send(mirror);
    } catch (err) {
      console.error(`[kuer] mirror send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- select`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/select.ts src/paper/select.test.ts
git commit -m "feat(paper): Kür spiegelt Dossier+Debatte verdichtet nach Telegram

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: `buildIntradayDossierPrompt` (Sonnet-Research für die Mini-Kür)

**Files:**
- Modify: `src/paper/prompts.ts`
- Test: `src/paper/prompts.test.ts`

**Interfaces:**
- Produces:
  - `export interface IntradayDossierPromptInput { stamp: string; ticker: string; triggerLabel: string; price: number; quotesBlock: string; journalTail: string; language?: Language; }`
  - `export function buildIntradayDossierPrompt(input: IntradayDossierPromptInput): string` — liefert das `Dossier`-JSON-Format mit GENAU einem Kandidaten (parsebar via `parseDossier`).

- [ ] **Step 1: Failing test** — in `src/paper/prompts.test.ts`:

```ts
it("builds a focused single-ticker intraday research prompt", () => {
  const out = buildIntradayDossierPrompt({
    stamp: "2026-06-09 17:00", ticker: "AMD", triggerLabel: "EMA10×EMA20 ↑",
    price: 100, quotesBlock: "AMD: 100", journalTail: "", language: "de",
  });
  expect(out).toContain("AMD");
  expect(out).toContain("RESEARCH");
  expect(out).toContain('"candidates"'); // Dossier-Format, parsebar via parseDossier
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- prompts`
Expected: FAIL — Funktion nicht exportiert.

- [ ] **Step 3: Implementierung** — in `src/paper/prompts.ts` anfügen:

```ts
export interface IntradayDossierPromptInput {
  stamp: string;
  ticker: string;
  triggerLabel: string;
  price: number;
  quotesBlock: string;
  journalTail: string;
  language?: Language;
}

/** Mini-Kür Stufe 1 (Sonnet, WebSearch): focused research on ONE triggered ticker. */
export function buildIntradayDossierPrompt(input: IntradayDossierPromptInput): string {
  return [
    PERSONA,
    "",
    `Tick ${input.stamp}. Du bist in der RESEARCH-Rolle für eine INTRADAY-CHANCE: ein`,
    `deterministischer Setup-Trigger ist auf ${input.ticker} gefeuert. Sammle kurz die`,
    "Entscheidungsgrundlage (die Entscheidung trifft gleich dein Entscheider-Lauf).",
    "Empfiehl nichts — informiere.",
    "",
    "## Trigger",
    `${input.ticker} @ ${input.price} — ${input.triggerLabel}`,
    "",
    "## Aktuelle Kurse (inkl. EMA10/20/50, RSI, Trend)",
    input.quotesBlock,
    "",
    "## Dein Journal (letzte Einträge)",
    input.journalTail.trim() === "" ? "(noch leer)" : input.journalTail,
    "",
    "## Auftrag",
    `Recherchiere per WebSearch kurz, was JETZT zu ${input.ticker} relevant ist: Katalysator`,
    "(News/Earnings), ungewöhnliche Bewegung, Sentiment. Falls /last30days verfügbar ist,",
    "nutze ihn; sonst ohne ihn weiter. GENAU EIN Kandidat (der getriggerte Ticker).",
    "",
    "Antworte mit GENAU diesem JSON-Format:",
    "{",
    '  "candidates": [',
    `    { "ticker": "${input.ticker}", "angle": "Long-/Short-Idee in 1 Satz", "catalyst": "konkreter Katalysator + Datum", "sentiment": "Stimmungslage in 1 Satz" }`,
    "  ],",
    '  "marketContext": "Gesamtmarkt in 1-2 Sätzen"',
    "}",
    "",
    jsonOnly(input.language ?? "de"),
  ].join("\n");
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- prompts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/prompts.ts src/paper/prompts.test.ts
git commit -m "feat(paper): buildIntradayDossierPrompt (Mini-Kür Research)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Mini-Kür Opus-Entscheider-Prompt anreichern

**Files:**
- Modify: `src/paper/prompts.ts` (`IntradayPromptInput`, `buildIntradayPrompt`)
- Test: `src/paper/prompts.test.ts`

**Interfaces:**
- Produces: `IntradayPromptInput.dossierBlock: string` und `IntradayPromptInput.trackRecordBlock: string`.

- [ ] **Step 1: Failing test** — in `src/paper/prompts.test.ts` den bestehenden `buildIntradayPrompt`-Test (falls vorhanden) um die neuen Blöcke erweitern bzw. neuen Test ergänzen:

```ts
it("includes the chance dossier and track-record in the intraday decision prompt", () => {
  const out = buildIntradayPrompt({
    stamp: "2026-06-09 17:00", ticker: "AMD", triggerLabel: "EMA ↑", price: 100,
    portfolioBlock: "p", quotesBlock: "q",
    dossierBlock: "AMD: Long auf Pullback", trackRecordBlock: "## Bisheriger Track-Record (Lehren)\nMSFT long …",
    journalTail: "", language: "de",
  });
  expect(out).toContain("Research zur Chance");
  expect(out).toContain("AMD: Long auf Pullback");
  expect(out).toContain("Bisheriger Track-Record (Lehren)");
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- prompts`
Expected: FAIL — `dossierBlock`/`trackRecordBlock` fehlen.

- [ ] **Step 3: Implementierung** — in `src/paper/prompts.ts`:

`IntradayPromptInput` erweitern:

```ts
export interface IntradayPromptInput {
  stamp: string;
  ticker: string;
  triggerLabel: string;
  price: number;
  portfolioBlock: string;
  quotesBlock: string;
  dossierBlock: string; // mini-dossier (or degrade note) from buildIntradayDossierPrompt
  trackRecordBlock: string; // renderTrackRecord(history, N)
  journalTail: string;
  language?: Language;
}
```

In `buildIntradayPrompt` die zwei Blöcke nach dem Kurse-Block, vor dem Journal einfügen:

```ts
    "## Aktuelle Kurse (inkl. EMA10/20/50, RSI, Trend)",
    input.quotesBlock,
    "",
    "## Research zur Chance",
    input.dossierBlock,
    "",
    input.trackRecordBlock,
    "",
    "## Dein Journal (letzte Einträge)",
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- prompts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/prompts.ts src/paper/prompts.test.ts
git commit -m "feat(paper): Mini-Kür Opus-Prompt um Dossier + Track-Record erweitern

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: `runIntradayOpportunity` → zweistufige Mini-Kür + Live-Meldungen

**Files:**
- Modify: `src/paper/intraday.ts` (`IntradayDeps`, `runIntradayOpportunity`)
- Test: `src/paper/intraday.test.ts` (Helfer + geänderte Erwartungen)

**Interfaces:**
- Consumes: `buildIntradayDossierPrompt` (Task 6), erweitertes `buildIntradayPrompt` (Task 7), `parseDossier` (`./decision`), `renderTrackRecord` (`./format`).
- Produces: `IntradayDeps` ohne `runner`, dafür mit `researchRunner: (prompt: string) => Promise<string>` und `decideRunner: (prompt: string) => Promise<string>`.

- [ ] **Step 1: Failing tests** — `src/paper/intraday.test.ts` anpassen. Helfer `makeDeps` umstellen (`runner` → `researchRunner` + `decideRunner`) und die durch das neue Design **geänderten** Erwartungen aktualisieren:

```ts
const DOSSIER = JSON.stringify({
  candidates: [{ ticker: "AMD", angle: "Long auf Pullback", catalyst: "Momentum", sentiment: "bullisch" }],
  marketContext: "SPY ruhig",
});

function makeDeps(p: Portfolio, over: Partial<IntradayDeps> = {}) {
  const saved: Portfolio[] = [];
  const sent: string[] = [];
  const journal: Array<[string, string]> = [];
  const deps: IntradayDeps = {
    loadPortfolio: () => p,
    savePortfolio: (x) => saved.push(x),
    appendJournal: (t, b) => journal.push([t, b]),
    readJournalTail: () => "",
    fetchQuotes: vi.fn(async () => quotes),
    researchRunner: vi.fn(async () => DOSSIER),
    decideRunner: vi.fn(async () => LIMIT_DECISION),
    send: vi.fn(async (t: string) => { sent.push(t); }),
    now: () => NOW,
    berlinDay,
    berlinStamp,
    ...over,
  };
  return { deps, saved, sent, journal };
}
```

  Tests:

```ts
it("runs research → Opus decide, places the order, posts start-ping + result", async () => {
  const { deps, saved, sent } = makeDeps(freshPortfolio(1000));
  await runIntradayOpportunity(trigger, deps);
  expect(deps.researchRunner).toHaveBeenCalled();
  expect(deps.decideRunner).toHaveBeenCalled();
  expect(saved.at(-1)?.orders[0].source).toBe("intraday");
  expect(sent.some((m) => m.includes("prüft Intraday-Chance AMD"))).toBe(true); // start-ping
  expect(sent.some((m) => m.includes("Intraday-Limit gesetzt"))).toBe(true);    // result
});

it("ALWAYS posts an outcome when Opus declines (kein Trade)", async () => {
  const { deps, saved, sent } = makeDeps(freshPortfolio(1000), {
    decideRunner: vi.fn(async () => '{"trades":[],"journal":"Kein klares Setup."}'),
  });
  await runIntradayOpportunity(trigger, deps);
  expect(saved).toHaveLength(0);
  expect(sent.some((m) => m.includes("kein Trade"))).toBe(true);
});

it("posts a 'nicht entschieden' note on a Claude limit (never a guessed trade)", async () => {
  const { deps, saved, sent } = makeDeps(freshPortfolio(1000), {
    decideRunner: vi.fn(async () => { throw new ClaudeLimitError("usage limit reached", "Intraday-Entscheidung"); }),
  });
  await runIntradayOpportunity(trigger, deps);
  expect(saved).toHaveLength(0);
  expect(sent.some((m) => m.includes("nicht entschieden"))).toBe(true);
});

it("decides anyway when research fails (degrade), still posting an outcome", async () => {
  const { deps, sent } = makeDeps(freshPortfolio(1000), {
    researchRunner: vi.fn(async () => { throw new Error("network"); }),
  });
  await runIntradayOpportunity(trigger, deps);
  expect(deps.decideRunner).toHaveBeenCalled();
  expect(sent.some((m) => m.includes("Intraday-Limit gesetzt") || m.includes("kein Trade"))).toBe(true);
});

it("refuses a market entry (limit-only) and says so", async () => {
  const { deps, saved, sent } = makeDeps(freshPortfolio(1000), {
    decideRunner: vi.fn(async () => JSON.stringify({ trades: [{ ticker: "AMD", side: "long", stake: 100, leverage: 1, entry: "market", stopLoss: 94, thesis: "x" }], journal: "" })),
  });
  await runIntradayOpportunity(trigger, deps);
  expect(saved).toHaveLength(0);
  expect(sent.some((m) => m.includes("nur Limit"))).toBe(true);
});

it("does not call any LLM when the gate is closed (already held)", async () => {
  const held: Portfolio = {
    ...freshPortfolio(1000),
    positions: [{ id: "AMD-x", ticker: "AMD", side: "long", stake: 100, leverage: 1, entryPrice: 100, units: 1, stopLoss: 90, openedAt: NOW.toISOString(), thesis: "" }],
  };
  const { deps, sent } = makeDeps(held);
  await runIntradayOpportunity(trigger, deps);
  expect(deps.researchRunner).not.toHaveBeenCalled();
  expect(deps.decideRunner).not.toHaveBeenCalled();
  expect(sent).toHaveLength(0);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- intraday`
Expected: FAIL — `runner` existiert nicht mehr / neue Meldungen fehlen.

- [ ] **Step 3: Implementierung** — `src/paper/intraday.ts` neu fassen:

Imports ergänzen:

```ts
import { renderPortfolio, renderQuotes, renderTrackRecord } from "./format";
import { buildIntradayDossierPrompt, buildIntradayPrompt } from "./prompts";
import { parseDecision, parseDossier, type Dossier } from "./decision";
```

`IntradayDeps`: `runner` ersetzen durch:

```ts
  /** Sonnet with WebSearch — focused research on the triggered ticker. */
  researchRunner: (prompt: string) => Promise<string>;
  /** Opus — the decider for the mini-Kür. */
  decideRunner: (prompt: string) => Promise<string>;
```

Lokaler Renderer (vor `runIntradayOpportunity`):

```ts
function renderChanceDossier(d: Dossier | null, ticker: string): string {
  const c = d?.candidates.find((x) => x.ticker === ticker.toUpperCase());
  if (!c) return "(Research fehlgeschlagen — entscheide auf Trigger und Kursen.)";
  return `${c.ticker}: ${c.angle}\n  Katalysator: ${c.catalyst}\n  Sentiment: ${c.sentiment}`;
}
```

`runIntradayOpportunity` neu (Gate → Start-Ping → Quotes → Research → Opus → garantierte Ergebnis-Meldung):

```ts
export async function runIntradayOpportunity(trigger: SetupTrigger, deps: IntradayDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const day = deps.berlinDay(now);
  const stamp = deps.berlinStamp(now);
  const ticker = trigger.ticker.toUpperCase();

  let portfolio = deps.loadPortfolio();
  if (!intradayGateOpen(portfolio, day, ticker)) return;

  // Start-Ping: signalisiert, dass der Mini-Kür-Prozess live läuft (best-effort).
  try {
    await deps.send(`🦍 Mr Ape prüft Intraday-Chance ${ticker} (${trigger.note}) …`);
  } catch (err) {
    console.error(`[intraday] start-ping send failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let quotes: QuoteMap;
  try {
    quotes = await deps.fetchQuotes([ticker]);
  } catch (err) {
    console.error(`[intraday] quote fetch failed for ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    await deps.send(`⚠️ Mr Ape — Intraday ${ticker}: Kurse nicht verfügbar, übersprungen.`);
    return;
  }
  if (!quotes[ticker]) {
    await deps.send(`⚠️ Mr Ape — Intraday ${ticker}: keine Kurse, übersprungen.`);
    return;
  }

  const trackRecordBlock = renderTrackRecord(portfolio.history, 8);
  const journalTail = deps.readJournalTail();

  // Stufe 1: Research (Sonnet). Scheitert sie → sanfte Degradation, Opus entscheidet trotzdem.
  let dossier: Dossier | null = null;
  try {
    dossier = parseDossier(
      await deps.researchRunner(
        buildIntradayDossierPrompt({
          stamp, ticker, triggerLabel: trigger.note, price: trigger.price,
          quotesBlock: renderQuotes(quotes), journalTail, language: deps.language ?? "de",
        }),
      ),
    );
  } catch (err) {
    console.error(`[intraday] research failed, deciding on trigger+quotes: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Stufe 2: Entscheidung (Opus).
  let raw: string;
  try {
    raw = await deps.decideRunner(
      buildIntradayPrompt({
        stamp, ticker, triggerLabel: trigger.note, price: trigger.price,
        portfolioBlock: renderPortfolio(portfolio, quotes), quotesBlock: renderQuotes(quotes),
        dossierBlock: renderChanceDossier(dossier, ticker), trackRecordBlock,
        journalTail, language: deps.language ?? "de",
      }),
    );
  } catch (err) {
    const limited = err instanceof ClaudeError && (err.kind === "limit" || err.kind === "timeout");
    const why = err instanceof ClaudeError && err.kind === "limit" ? "Usage-Limit" : limited ? "Timeout" : "Fehler";
    deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, `Nicht entschieden (${why}).`);
    await deps.send(`⚠️ Mr Ape — Intraday ${ticker}: nicht entschieden (${why}).`);
    return;
  }

  const decision = parseDecision(raw);
  const trade = decision?.trades[0];
  if (!decision || !trade) {
    const note = decision?.journal?.trim() || "kein klares Setup.";
    deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, `Kein Trade. ${note}`);
    await deps.send(`🦍 Mr Ape — Intraday ${ticker}: kein Trade. ${note}`);
    return;
  }
  if (trade.entry === "market") {
    deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, "Verworfen: nur Limit-Einstiege erlaubt.");
    await deps.send(`🦍 Mr Ape — Intraday ${ticker}: Vorschlag verworfen (nur Limit erlaubt).`);
    return;
  }

  const { portfolio: updated, accepted, rejected } = placeOrders(
    portfolio, [{ ...trade, ticker }], quotes, { now: now.toISOString(), day, source: "intraday" },
  );
  portfolio = updated;
  deps.savePortfolio(portfolio);

  if (accepted.length === 0) {
    const reason = rejected[0]?.reason ?? "abgelehnt";
    deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, `Order abgelehnt (${reason}).`);
    await deps.send(`🦍 Mr Ape — Intraday ${ticker}: Order abgelehnt (${reason}).`);
    return;
  }

  const o = accepted[0];
  const journalText = decision.journal.trim();
  const orderText = `🟢 Intraday-Limit gesetzt: ${o.ticker} ${o.side} ${o.leverage}x, Einsatz $${o.stake.toFixed(2)}, Limit ${o.limitPrice}, SL ${o.stopLoss}${o.takeProfit !== undefined ? `, TP ${o.takeProfit}` : ""}${o.expiresOn ? ` (bis ${o.expiresOn})` : ""}`;
  deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, [journalText, orderText].filter((l) => l !== "").join("\n"));
  await deps.send([`🦍 Mr Ape — Intraday-Chance ${ticker} (${trigger.note})`, journalText, orderText].filter((l) => l !== "").join("\n"));
}
```

  (`ClaudeError` ist bereits importiert. `Dossier`, `parseDossier`, `parseDecision`, `renderTrackRecord`, die zwei Prompt-Builder neu importieren.)

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- intraday`
Expected: PASS (alle alten + neuen Fälle).

- [ ] **Step 5: Commit**

```bash
git add src/paper/intraday.ts src/paper/intraday.test.ts
git commit -m "feat(paper): Intraday als Mini-Kür (Sonnet-Research → Opus) mit Live-Meldungen

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: `tick.ts` verdrahten (Sonnet-Research + Opus-Entscheider)

**Files:**
- Modify: `src/paper/tick.ts` (~Zeile 68-74, der `intraday`-Closure)

**Interfaces:**
- Consumes: neues `IntradayDeps` aus Task 8 (`researchRunner` + `decideRunner`).

- [ ] **Step 1: Implementierung** — in `src/paper/tick.ts` den `intraday`-Closure ersetzen:

```ts
    const intraday = env.intradayOpportunismEnabled
      ? (trigger: SetupTrigger) =>
          runIntradayOpportunity(trigger, {
            ...shared,
            researchRunner: createClaudeRunner({ model: "sonnet", allowedTools: ["WebSearch", "Skill"], label: "Intraday-Research", onSlow, ...watchdog }),
            decideRunner: createClaudeRunner({ model: "opus", label: "Intraday-Entscheidung", onSlow, ...watchdog }),
          })
      : undefined;
```

  (`shared` enthält bereits `readJournalTail`, `fetchQuotes`, `send`, `appendJournal`, `loadPortfolio`, `savePortfolio`, `berlinDay`, `berlinStamp`, `language` — passt zu `IntradayDeps`.)

- [ ] **Step 2: Typecheck + komplette Testsuite**

Run: `npm run typecheck && npm test`
Expected: typecheck sauber; alle Tests grün.

- [ ] **Step 3: Commit**

```bash
git add src/paper/tick.ts
git commit -m "feat(paper): tick.ts verdrahtet Mini-Kür-Runner (Sonnet-Research + Opus)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Spec-Coverage:**
- Baustein 1 (Track-Record) → Tasks 1, 2, 3 (Feld, Builder, Kür-Einspeisung) + Task 8 (Mini-Kür-Einspeisung). ✓
- Baustein 2 (Spiegelung) → Tasks 4, 5. ✓
- Baustein 3 (Mini-Kür) → Tasks 6, 7, 8, 9. ✓
- Tests (alle Spec-Punkte) → in den jeweiligen Tasks. ✓
- Nicht-Ziele (Alpha, separater Reflexions-Call, voller Debatten-Schritt intraday, UI) → bewusst nicht im Plan. ✓

**Placeholder-Scan:** Keine TBD/TODO; jeder Code-Step zeigt vollständigen Code. Zwei Stellen verweisen bewusst auf „die im File etablierten Mock-Helfer" (Task 1 engine-Close-Setup, Task 5 runKuer-Mocks) — das sind keine Platzhalter, sondern die Anweisung, vorhandene Test-Harnesses zu nutzen statt neue zu erfinden.

**Typ-Konsistenz:** `renderTrackRecord(history, limit)`, `formatDecisionMirror(dossier, debate)`, `closeReasonLabel`, `DecisionPromptInput.trackRecordBlock`, `IntradayPromptInput.dossierBlock`/`.trackRecordBlock`, `IntradayDossierPromptInput`, `IntradayDeps.researchRunner`/`.decideRunner` — über alle Tasks identisch verwendet.

**Verhaltensänderung (Achtung bei Task 8):** Die bestehenden `intraday.test.ts`-Fälle „does nothing (no post) when declines" und „degrades silently on a Claude limit (no post)" kodieren das ALTE Stille-Verhalten und werden in Task 8 bewusst durch „postet immer ein Ergebnis"-Fälle ersetzt — das ist die designierte Änderung, kein Regressionsfehler.
