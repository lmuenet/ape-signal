# A1 Language-Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Sprache aller KI-generierten Freitexte (Persona-Journal/Kür/Tick, Scan- und Strategie-Freitexte) über eine einmal beim Setup gesetzte Env-Var `APE_LANGUAGE` (DE/EN) konfigurierbar machen.

**Architecture:** Direktiven-Overlay (Ansatz 1). Die deutschen Prompt-Körper bleiben unverändert; getauscht wird nur ein Sprach-**Label** in der Schluss-Direktive jedes Prompts. `APE_LANGUAGE` wird einmal in `loadEnv()` validiert (Default `de`, ungültig → Fehler) und über die bestehenden DI-Deps in die Prompt-Builder gereicht. Alle Builder/Direktiven defaulten auf `de`, damit der DE-Pfad **byte-identisch** zu heute bleibt und der bestehende Testbestand grün bleibt.

**Tech Stack:** TypeScript, Node (tsx), vitest. Tests: `npm run test`; Einzeldatei: `npx vitest run <pfad>`; Typecheck: `npm run typecheck`.

**Invarianz über alle Sprachen:** JSON-Keys und Enum-Werte bleiben englisch (`long | short | stay-out`, `signal | noise | watch`, `low | medium | high`, `side ∈ long|short`). Nur Freitext wechselt.

**Spec:** `docs/superpowers/specs/2026-06-13-language-setting-design.md`

---

### Task 1: Sprach-Typ + parametrierte Direktiven in `core/language.ts`

**Files:**
- Modify: `src/core/language.ts`
- Modify: `src/core/language.test.ts`
- Modify: `src/strategy/strategy.ts:17,88` (Direktiven-Aufruf)
- Modify: `src/scan/pipeline.ts:10,170` (Direktiven-Aufruf)

- [ ] **Step 1: Failing test schreiben** — `src/core/language.test.ts` komplett ersetzen:

```ts
import { describe, it, expect } from "vitest";
import {
  strategyDirective,
  trendingDirective,
  HEADLESS_JSON_DIRECTIVE,
  SUPPORTED_LANGUAGES,
  type Language,
} from "./language";

describe("language directives", () => {
  it("strategy directive (de) demands German free text but English JSON keys + enums", () => {
    const d = strategyDirective("de");
    expect(d).toContain("DEUTSCH");
    expect(d).toContain("long | short | stay-out");
    expect(d).toContain("low | medium | high");
  });

  it("strategy directive (en) swaps the language label, keeps the enums English", () => {
    const d = strategyDirective("en");
    expect(d).toContain("ENGLISCH");
    expect(d).not.toContain("DEUTSCH");
    expect(d).toContain("long | short | stay-out");
    expect(d).toContain("low | medium | high");
  });

  it("strategy directive defaults to German when no language is passed", () => {
    expect(strategyDirective()).toBe(strategyDirective("de"));
  });

  it("trending directive (de) keeps verdict English to protect the parser", () => {
    const d = trendingDirective("de");
    expect(d).toContain("DEUTSCH");
    expect(d).toContain("signal | noise | watch");
    expect(d.toLowerCase()).toContain("verdict");
  });

  it("trending directive (en) swaps the language label, keeps verdict English", () => {
    const d = trendingDirective("en");
    expect(d).toContain("ENGLISCH");
    expect(d).not.toContain("DEUTSCH");
    expect(d).toContain("signal | noise | watch");
  });

  it("trending directive defaults to German", () => {
    expect(trendingDirective()).toBe(trendingDirective("de"));
  });

  it("headless directive forbids tools and demands JSON-only, no preamble", () => {
    expect(HEADLESS_JSON_DIRECTIVE).toContain("headless");
    expect(HEADLESS_JSON_DIRECTIVE).toContain("KEINE Tools");
    expect(HEADLESS_JSON_DIRECTIVE).toContain("JSON-Block");
    expect(HEADLESS_JSON_DIRECTIVE).toContain("Rückfrage");
  });

  it("exposes the supported language set (de, en)", () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual<Language[]>(["de", "en"]);
  });
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/core/language.test.ts`
Expected: FAIL — `strategyDirective`/`trendingDirective`/`SUPPORTED_LANGUAGES` existieren nicht (nur die alten `GERMAN_DIRECTIVE_*`-Konstanten).

- [ ] **Step 3: Implementieren** — `src/core/language.ts` komplett ersetzen:

```ts
/**
 * Prompt-Direktiven, die an die Export-/Persona-Prompts angehängt werden, damit
 * Claude (a) Freitexte in der konfigurierten Sprache schreibt OHNE die
 * JSON-Parser zu brechen und (b) headless korrekt läuft (keine Tools, nur JSON).
 *
 * Ansatz "Direktiven-Overlay": Der Prompt-Körper bleibt deutsch; gewechselt wird
 * nur das Sprach-LABEL ({@link FREETEXT_LABEL}). Für `de` ist das Ergebnis
 * identisch zum bisherigen Verhalten. JSON-Schlüssel + Enums bleiben in JEDER
 * Sprache englisch (die Parser in decision.ts / ape-intel.ts verlangen das).
 */
export type Language = "de" | "en";

export const SUPPORTED_LANGUAGES: readonly Language[] = ["de", "en"];

/** Label, mit dem die (deutschsprachigen) Direktiven die Zielsprache benennen. */
const FREETEXT_LABEL: Record<Language, string> = { de: "DEUTSCH", en: "ENGLISCH" };

/** Das Sprach-Label für die Direktiven. Neue Sprache = ein Eintrag mehr oben. */
export function freetextLabel(lang: Language): string {
  return FREETEXT_LABEL[lang];
}

export function strategyDirective(lang: Language = "de"): string {
  return [
    `WICHTIG — SPRACHE: Schreibe ALLE Freitext-Inhalte auf ${FREETEXT_LABEL[lang]} — auch die JSON-Werte`,
    "(recommendation, rationale, risks, barometerCritique, timeframe, instruments,",
    "positionSizing, targetPrice, stopLoss, leverage). Die JSON-Schlüssel bleiben exakt",
    "wie vorgegeben auf ENGLISCH. Für \"direction\" verwende weiterhin genau einen Wert aus",
    "long | short | stay-out, für \"conviction\" genau low | medium | high (NICHT übersetzen).",
  ].join("\n");
}

export function trendingDirective(lang: Language = "de"): string {
  return [
    `WICHTIG — SPRACHE: Schreibe \"summary\", \"thesis\" und \"watch\" auf ${FREETEXT_LABEL[lang]}.`,
    "Der Wert von \"verdict\" MUSS auf Englisch bleiben — exakt einer von:",
    "signal | noise | watch (sonst kann ich die Antwort nicht verarbeiten).",
    "Die JSON-Schlüssel bleiben Englisch.",
  ].join("\n");
}

export const HEADLESS_JSON_DIRECTIVE = [
  "WICHTIG — AUSFÜHRUNGSMODUS (headless): Dieser Aufruf läuft vollautomatisch ohne Tools",
  "und ohne interaktive Eingabe. Nutze KEINE Tools (kein WebSearch, WebFetch, Bash o.ä.),",
  "frage NICHT nach Berechtigungen und warte auf keine Bestätigung. Fehlt dir Live-Recherche,",
  "arbeite mit deinem vorhandenen Wissen weiter und vermerke die Unsicherheit IM Text —",
  "brich NICHT ab und stelle KEINE Rückfragen. Gib AUSSCHLIESSLICH den oben geforderten",
  "JSON-Block zurück — ohne Vorrede, ohne Nachsatz, ohne Rückfrage.",
].join("\n");
```

- [ ] **Step 4: Konsumenten auf die neuen Funktionen umstellen (Default `de`)**

`src/strategy/strategy.ts` Zeile 17 — Import:
```ts
import { strategyDirective, HEADLESS_JSON_DIRECTIVE } from "../core/language";
```
`src/strategy/strategy.ts` Zeile 88 — Aufruf (Default `de`, wird in Task 5 auf `deps.language` umgestellt):
```ts
  const prompt = `${base}\n\n${renderPriceBlock(input.ticker, quote)}\n\n${strategyDirective()}\n\n${HEADLESS_JSON_DIRECTIVE}`;
```

`src/scan/pipeline.ts` Zeile 10 — Import:
```ts
import { trendingDirective, HEADLESS_JSON_DIRECTIVE } from "../core/language";
```
`src/scan/pipeline.ts` Zeile 170 — im `payload`-Array `GERMAN_DIRECTIVE_TRENDING` ersetzen durch:
```ts
    trendingDirective(),
```

- [ ] **Step 5: Tests + Typecheck (grün)**

Run: `npx vitest run src/core/language.test.ts && npm run typecheck && npm run test`
Expected: language-Tests PASS; `tsc` ohne Fehler; gesamter Suite grün (DE-Pfad byte-identisch → strategy.test.ts/pipeline-Tests unverändert grün).

- [ ] **Step 6: Commit**

```bash
git add src/core/language.ts src/core/language.test.ts src/strategy/strategy.ts src/scan/pipeline.ts
git commit -m "feat(language): parametrierte Sprach-Direktiven (Default de, byte-identisch)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `APE_LANGUAGE` in `config/env.ts` parsen

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/config/env.test.ts`

- [ ] **Step 1: Failing tests ergänzen** — in `src/config/env.test.ts` nach dem ersten `describe("loadEnv", …)`-Block einfügen:

```ts
describe("APE_LANGUAGE", () => {
  const base = { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" };

  it("defaults to de when unset", () => {
    expect(loadEnv(base).language).toBe("de");
  });

  it("accepts en", () => {
    expect(loadEnv({ ...base, APE_LANGUAGE: "en" }).language).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(loadEnv({ ...base, APE_LANGUAGE: "EN" }).language).toBe("en");
  });

  it("throws on an unsupported value, listing the allowed ones", () => {
    expect(() => loadEnv({ ...base, APE_LANGUAGE: "xx" })).toThrowError(
      /APE_LANGUAGE.*de.*en/s,
    );
  });
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/config/env.test.ts`
Expected: FAIL — `cfg.language` ist `undefined`, ungültiger Wert wirft nicht.

- [ ] **Step 3: Implementieren** — `src/config/env.ts` anpassen:

Import oben ergänzen:
```ts
import { SUPPORTED_LANGUAGES, type Language } from "../core/language";
```
`Env`-Interface um ein Feld erweitern:
```ts
export interface Env {
  telegramBotToken: string;
  telegramChatId: string;
  finnhubApiKey?: string;
  redditCrawlEnabled: boolean;
  paperTradingEnabled: boolean;
  redditClientId?: string;
  redditClientSecret?: string;
  redditUserAgent?: string;
  language: Language;
}
```
Parser-Helfer vor `loadEnv` einfügen:
```ts
/** APE_LANGUAGE → Language. Unset/leer → "de". Ungültig → throw (fail-fast). */
function parseLanguage(source: Record<string, string | undefined>): Language {
  const raw = source.APE_LANGUAGE;
  if (!raw || raw.trim() === "") return "de";
  const v = raw.trim().toLowerCase();
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(v)) return v as Language;
  throw new Error(
    `Invalid APE_LANGUAGE: "${raw}". Supported values: ${SUPPORTED_LANGUAGES.join(", ")}`,
  );
}
```
Im `return` von `loadEnv` das Feld ergänzen:
```ts
    redditUserAgent: val(source, "REDDIT_USER_AGENT"),
    language: parseLanguage(source),
  };
```

- [ ] **Step 4: Tests + Typecheck (grün)**

Run: `npx vitest run src/config/env.test.ts && npm run typecheck`
Expected: PASS; keine Typfehler.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/config/env.test.ts
git commit -m "feat(config): APE_LANGUAGE parsen (default de, ungueltig wirft)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Aktive Sprache im Doctor ausweisen

**Files:**
- Modify: `src/config/doctor.ts:54-61` (`checkRequiredEnv`)
- Modify: `src/config/doctor.test.ts`

- [ ] **Step 1: Failing test ergänzen** — in `src/config/doctor.test.ts` einen Test für `checkRequiredEnv` ergänzen (Import von `checkRequiredEnv` ggf. oben hinzufügen):

```ts
import { checkRequiredEnv } from "./doctor";

describe("checkRequiredEnv language", () => {
  it("reports the active language in the ok detail", () => {
    const r = checkRequiredEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c", APE_LANGUAGE: "en" });
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("en");
  });

  it("defaults the reported language to de", () => {
    const r = checkRequiredEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });
    expect(r.detail).toContain("de");
  });
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/config/doctor.test.ts`
Expected: FAIL — `detail` enthält die Sprache nicht.

- [ ] **Step 3: Implementieren** — `checkRequiredEnv` in `src/config/doctor.ts` anpassen:

```ts
/** Required env present (Telegram) + aktive Sprache. Hard-fail mit Liste des Fehlenden. */
export function checkRequiredEnv(source: Record<string, string | undefined>): CheckResult {
  try {
    const env = loadEnv(source);
    return {
      name: "Required env",
      status: "ok",
      detail: `TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID present (Sprache: ${env.language})`,
    };
  } catch (err) {
    return { name: "Required env", status: "fail", detail: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Tests + Typecheck (grün)**

Run: `npx vitest run src/config/doctor.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/doctor.ts src/config/doctor.test.ts
git commit -m "feat(doctor): aktive Sprache in der Diagnose ausweisen

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Sprache in die Persona-Builder (`paper/prompts.ts`)

**Files:**
- Modify: `src/paper/prompts.ts`
- Modify: `src/paper/prompts.test.ts`

- [ ] **Step 1: Failing tests ergänzen** — in `src/paper/prompts.test.ts` ans Ende anfügen:

```ts
import { buildAdminPrompt, buildDossierPrompt } from "./prompts";

describe("prompt language label", () => {
  it("decision prompt defaults to a German free-text directive", () => {
    const p = buildDecisionPrompt({
      day: "2026-06-11", dossierBlock: "", debateBlock: "", quotesBlock: "",
      portfolioBlock: "", journalTail: "",
    });
    expect(p).toContain("DEUTSCH");
  });

  it("decision prompt switches the free-text directive to English", () => {
    const p = buildDecisionPrompt({
      day: "2026-06-11", dossierBlock: "", debateBlock: "", quotesBlock: "",
      portfolioBlock: "", journalTail: "", language: "en",
    });
    expect(p).toContain("ENGLISCH");
    expect(p).not.toContain("auf DEUTSCH");
    // Enums bleiben Englisch:
    expect(p).toContain("long | short");
  });

  it("tick prompt honours the language flag", () => {
    const base = {
      stamp: "2026-06-11 15:35", portfolioBlock: "(d)", quotesBlock: "(q)",
      eventsBlock: "", wakeBlock: "", journalTail: "", isClose: false,
    };
    expect(buildTickPrompt({ ...base, language: "en" })).toContain("ENGLISCH");
    expect(buildTickPrompt(base)).toContain("DEUTSCH");
  });

  it("admin prompt honours the language flag and drops the hard-coded 'deutsche'", () => {
    expect(buildAdminPrompt("setz auf 500", 100, "en")).toContain("ENGLISCH");
    const de = buildAdminPrompt("setz auf 500", 100);
    expect(de).toContain("DEUTSCH");
    expect(de).not.toContain("deutsche Journal-Notiz");
  });

  it("dossier prompt honours the language flag", () => {
    const input = { day: "2026-06-11", scanSummary: "", journalTail: "" };
    expect(buildDossierPrompt({ ...input, language: "en" })).toContain("ENGLISCH");
    expect(buildDossierPrompt(input)).toContain("DEUTSCH");
  });
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/paper/prompts.test.ts`
Expected: FAIL — `language` ist kein gültiges Feld; EN-Erwartungen schlagen fehl; `buildAdminPrompt` enthält noch „deutsche Journal-Notiz".

- [ ] **Step 3: Implementieren** — `src/paper/prompts.ts` anpassen:

Import oben ergänzen:
```ts
import { freetextLabel, type Language } from "../core/language";
```
`JSON_ONLY`-Konstante (Zeilen 7-12) durch eine Funktion ersetzen:
```ts
function jsonOnly(lang: Language): string {
  return [
    "WICHTIG — AUSFÜHRUNGSMODUS (headless): Dieser Aufruf läuft vollautomatisch.",
    "Stelle KEINE Rückfragen und warte auf keine Bestätigung. Gib am Ende",
    "AUSSCHLIESSLICH den geforderten JSON-Block zurück — ohne Vorrede, ohne Nachsatz.",
    `Alle Freitext-WERTE im JSON auf ${freetextLabel(lang)}; Schlüssel und Enum-Werte exakt wie vorgegeben.`,
  ].join("\n");
}
```
Jedes Input-Interface um ein optionales Feld erweitern (Default `de` im Builder):
```ts
export interface DossierPromptInput {
  day: string;
  scanSummary: string;
  journalTail: string;
  language?: Language;
}
```
analog für `DebatePromptInput`, `DecisionPromptInput`, `TickPromptInput` jeweils `language?: Language;` ergänzen.

In jedem der vier Builder am Ende `JSON_ONLY` durch `jsonOnly(input.language ?? "de")` ersetzen. Beispiel `buildDossierPrompt` (letzte Array-Zeile):
```ts
    JSON_ONLY,        // ALT
    jsonOnly(input.language ?? "de"),  // NEU
```
Dieselbe Ersetzung in `buildDebatePrompt`, `buildDecisionPrompt`, `buildTickPrompt`.

`buildAdminPrompt` (Signatur + Body):
```ts
/** /journal admin (Sonnet): interpret a free-text balance instruction. */
export function buildAdminPrompt(text: string, balance: number, language: Language = "de"): string {
  return [
    "Du verwaltest das Guthaben eines fiktiven Paper-Trading-Depots. Der Besitzer hat per",
    `Telegram geschrieben: "${text}"`,
    "",
    `Aktuelles freies Guthaben: $${balance.toFixed(2)}.`,
    "",
    "Interpretiere die Nachricht als GENAU EINE dieser Aktionen:",
    '- "set_balance": Guthaben soll auf einen Betrag GESETZT werden ("dein Guthaben ist jetzt 500")',
    '- "deposit": Betrag kommt DAZU ("ich lege dir 200 dazu")',
    '- "withdraw": Betrag wird ENTNOMMEN',
    '- "note": keine Guthaben-Änderung — nur eine Notiz fürs Journal',
    "",
    "Antworte mit GENAU diesem JSON-Format (amount in USD, bei note: null):",
    '{ "action": "set_balance", "amount": 500, "note": "kurze Journal-Notiz, was passiert ist" }',
    "",
    jsonOnly(language),
  ].join("\n");
}
```
(Die einzige inline-Sprachstelle „kurze **deutsche** Journal-Notiz" wird zu „kurze Journal-Notiz"; die Sprache steuert allein `jsonOnly`.)

- [ ] **Step 4: Tests + Typecheck (grün)**

Run: `npx vitest run src/paper/prompts.test.ts && npm run typecheck && npm run test`
Expected: PASS. Bestehende Builder-Tests (ohne `language`) bleiben grün (Default `de`, byte-identisch außer der entfernten „deutsche"-Stelle im Admin-Beispiel, die kein Test prüfte).

- [ ] **Step 5: Commit**

```bash
git add src/paper/prompts.ts src/paper/prompts.test.ts
git commit -m "feat(prompts): Sprach-Flag in Persona-Buildern (Default de)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Sprache durch Scan- und Strategie-Deps reichen

**Files:**
- Modify: `src/scan/pipeline.ts` (`ScanDeps` + Aufruf `trendingDirective`)
- Modify: `src/strategy/strategy.ts` (`StrategyDeps` + Aufruf `strategyDirective`)
- Modify: `src/scan/pipeline.test.ts` (EN-Test)
- Modify: `src/strategy/strategy.test.ts` (EN-Test)

> Hinweis: In Task 1 wurden `trendingDirective()`/`strategyDirective()` mit Default aufgerufen. Hier wird der Default durch `deps.language ?? "de"` ersetzt.

- [ ] **Step 1: Failing test (Strategy EN)** — in `src/strategy/strategy.test.ts` im Block `describe("runStrategy price + language", …)` ergänzen:

```ts
  it("switches the free-text directive to English when deps.language is en", async () => {
    let seen = "";
    await runStrategy("avgo", { risk: "balanced", horizon: "swing" }, deps({
      language: "en",
      claudeRunner: async (p) => { seen = p; return ""; },
    }));
    expect(seen).toContain("ENGLISCH");
    expect(seen).not.toContain("auf DEUTSCH");
  });
```

- [ ] **Step 2: Failing test (Scan EN)** — in `src/scan/pipeline.test.ts` einen Test ergänzen, der den an `claudeRunner` übergebenen Payload prüft. Muster (an die dortige `deps`-Konstruktion anpassen — `language: "en"` ins Deps-Objekt, Payload über den `claudeRunner`-Spy abgreifen):

```ts
  it("puts an English free-text directive into the scan payload when language=en", async () => {
    let seen = "";
    const deps: ScanDeps = {
      fetchSnapshot: async () => new Map(),
      claudeRunner: async (p) => { seen = p; return ""; },
      send: async () => {},
      language: "en",
    };
    await runScan({ label: "Test", limit: 5 }, deps);
    expect(seen).toContain("ENGLISCH");
    expect(seen).not.toContain("auf DEUTSCH");
  });
```
(Falls die Datei bereits eine Deps-Factory hat, diese mit `language: "en"` nutzen statt eines neuen Literals. `ScanDeps`-Import oben ggf. ergänzen.)

- [ ] **Step 3: Test laufen lassen (rot)**

Run: `npx vitest run src/strategy/strategy.test.ts src/scan/pipeline.test.ts`
Expected: FAIL — `language` ist kein `StrategyDeps`/`ScanDeps`-Feld; Payload enthält weiter „DEUTSCH".

- [ ] **Step 4: Implementieren**

`src/strategy/strategy.ts` — `StrategyDeps` um Feld erweitern und Import von `Language`:
```ts
import { strategyDirective, HEADLESS_JSON_DIRECTIVE } from "../core/language";
import type { Language } from "../core/language";
```
```ts
export interface StrategyDeps {
  fetchApewisdom: () => Promise<ApewisdomSnapshot>;
  fetchStockTwits: (ticker: string) => Promise<StockTwitsEntry | null>;
  fetchTradestie: () => Promise<TradestieSnapshot>;
  fetchNews: (ticker: string) => Promise<NewsItem[]>;
  fetchEarnings: (ticker: string) => Promise<EarningsDate | null>;
  fetchQuote: (ticker: string) => Promise<Quote | null>;
  claudeRunner: (prompt: string) => Promise<string>;
  language?: Language;
}
```
Aufruf (vorher `strategyDirective()`):
```ts
  const prompt = `${base}\n\n${renderPriceBlock(input.ticker, quote)}\n\n${strategyDirective(deps.language ?? "de")}\n\n${HEADLESS_JSON_DIRECTIVE}`;
```

`src/scan/pipeline.ts` — `ScanDeps` um Feld erweitern und Import von `Language`:
```ts
import { trendingDirective, HEADLESS_JSON_DIRECTIVE } from "../core/language";
import type { Language } from "../core/language";
```
In `ScanDeps` ergänzen:
```ts
  fetchMomentum?: () => Promise<RsResult>;
  language?: Language;
```
Aufruf im `payload`-Array (vorher `trendingDirective()`):
```ts
    trendingDirective(deps.language ?? "de"),
```

- [ ] **Step 5: Tests + Typecheck (grün)**

Run: `npx vitest run src/strategy/strategy.test.ts src/scan/pipeline.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scan/pipeline.ts src/scan/pipeline.test.ts src/strategy/strategy.ts src/strategy/strategy.test.ts
git commit -m "feat(scan,strategy): Sprache aus Deps in die Direktiven reichen

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Sprache durch die Paper-Pipelines reichen

**Files:**
- Modify: `src/paper/select.ts` (`KuerDeps` + 3 Builder-Aufrufe)
- Modify: `src/paper/tickPipeline.ts` (`TickDeps` + `buildTickPrompt`-Aufruf)
- Modify: `src/paper/journalCommand.ts` (`JournalDeps` + `buildAdminPrompt`-Aufruf)
- Modify: `src/paper/select.test.ts` (EN-Guard-Test)

- [ ] **Step 1: Failing test (Kür EN)** — in `src/paper/select.test.ts` ergänzen (an die dortige `deps`-Factory anpassen; `language: "en"` setzen und den `researchRunner`-Prompt abgreifen):

```ts
  it("passes the configured language into the research prompt", async () => {
    let seen = "";
    const deps = makeDeps({           // vorhandene Factory der Datei nutzen
      language: "en",
      researchRunner: async (p: string) => { seen = p; return "{}"; },
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(seen).toContain("ENGLISCH");
  });
```
(Heißt die Factory anders bzw. werden Deps inline gebaut, dort `language: "en"` ergänzen und `researchRunner` als Spy setzen.)

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `npx vitest run src/paper/select.test.ts`
Expected: FAIL — `language` ist kein `KuerDeps`-Feld; Prompt enthält „DEUTSCH".

- [ ] **Step 3: Implementieren**

`src/paper/select.ts` — Import + `KuerDeps`-Feld:
```ts
import type { Language } from "../core/language";
```
In `KuerDeps` ergänzen (z.B. nach `berlinDay`):
```ts
  berlinDay: (d: Date) => string;
  language?: Language;
```
In `runKuer` die drei Builder-Aufrufe um `language` erweitern:
```ts
    dossier = parseDossier(await deps.researchRunner(buildDossierPrompt({ day, scanSummary: opts.scanSummary, journalTail, language: deps.language ?? "de" })));
```
```ts
          buildDebatePrompt({ day, dossierBlock: renderDossier(dossier), quotesBlock: renderQuotes(quotes), journalTail, language: deps.language ?? "de" }),
```
```ts
    buildDecisionPrompt({
      day,
      dossierBlock: renderDossier(dossier),
      debateBlock: renderDebate(debate),
      quotesBlock: renderQuotes(quotes),
      portfolioBlock: renderPortfolio(portfolio, quotes),
      journalTail,
      language: deps.language ?? "de",
    }),
```

`src/paper/tickPipeline.ts` — Import + `TickDeps`-Feld:
```ts
import type { Language } from "../core/language";
```
In `TickDeps` ergänzen (z.B. nach `berlinStamp`):
```ts
  berlinStamp: (d: Date) => string;
  language?: Language;
```
`buildTickPrompt`-Aufruf um `language` erweitern:
```ts
        buildTickPrompt({
          stamp,
          portfolioBlock: renderPortfolio(portfolio, quotes),
          quotesBlock: renderQuotes(quotes),
          eventsBlock: events.map(formatEvent).join("\n"),
          wakeBlock: breaches.map(describeBreach).join("\n"),
          journalTail: deps.readJournalTail(),
          isClose: opts.isClose,
          language: deps.language ?? "de",
        }),
```

`src/paper/journalCommand.ts` — Import + `JournalDeps`-Feld:
```ts
import type { Language } from "../core/language";
```
In `JournalDeps` ergänzen (nach `claudeRunner`):
```ts
  claudeRunner: (prompt: string) => Promise<string>;
  language?: Language;
```
`buildAdminPrompt`-Aufruf (Zeile 48):
```ts
  const raw = await deps.claudeRunner(buildAdminPrompt(text, portfolio.balance, deps.language ?? "de"));
```

- [ ] **Step 4: Tests + Typecheck (grün)**

Run: `npx vitest run src/paper/select.test.ts && npm run typecheck && npm run test`
Expected: PASS. Bestehende Pipeline-Tests ohne `language` bleiben grün (Default `de`).

- [ ] **Step 5: Commit**

```bash
git add src/paper/select.ts src/paper/tickPipeline.ts src/paper/journalCommand.ts src/paper/select.test.ts
git commit -m "feat(paper): Sprache durch Kuer/Tick/Journal-Pipelines reichen

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: `env.language` an den Entry-Points verdrahten

**Files:**
- Modify: `src/scan/index.ts` (ScanDeps + KuerDeps)
- Modify: `src/paper/tick.ts` (TickDeps)
- Modify: `src/telegram/listener.ts` (StrategyDeps, ScanDeps, JournalDeps)

> Diese Dateien sind `main()`-Entrypoints ohne Unit-Tests; verifiziert wird per `npm run typecheck` + Gesamt-Suite.

- [ ] **Step 1: `src/scan/index.ts`** — `language: env.language` in beide Deps-Objekte eintragen.
  - Im `deps: ScanDeps`-Objekt (nach `fetchMomentum`): `language: env.language,`
  - Im `runKuer(...)`-Deps-Objekt (nach `berlinDay`): `language: env.language,`

- [ ] **Step 2: `src/paper/tick.ts`** — im `runTick(...)`-Deps-Objekt (nach `berlinStamp`): `language: env.language,`

- [ ] **Step 3: `src/telegram/listener.ts`** — `env.language` ist bereits via `const env = loadEnv()` verfügbar. Ergänzen:
  - in `strategyDeps` (nach `claudeRunner`): `language: env.language,`
  - in `scanDeps` (nach `fetchMomentum`): `language: env.language,`
  - in `journalDeps` (nach `claudeRunner`): `language: env.language,`

- [ ] **Step 4: Typecheck + Gesamt-Suite (grün)**

Run: `npm run typecheck && npm run test`
Expected: keine Typfehler; alle Tests grün.

- [ ] **Step 5: Manuelle Rauchprobe (optional, lokal)**

Run: `APE_LANGUAGE=en npm run doctor`
Expected: Zeile „Required env … (Sprache: en)". (Ohne gesetzte Telegram-Keys schlägt der Telegram-Check fehl — das ist hier egal; geprüft wird nur die Sprach-Zeile.)

- [ ] **Step 6: Commit**

```bash
git add src/scan/index.ts src/paper/tick.ts src/telegram/listener.ts
git commit -m "feat(wiring): APE_LANGUAGE an Scan/Tick/Listener-Entrypoints durchreichen

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Dokumentation

**Files:**
- Modify: `docs/superpowers/specs/2026-06-06-self-host-quickstart-design.md` (falls Env-Var-Liste vorhanden) ODER der aktuelle Self-Host-Quickstart-Ort
- Modify: `systemd/README.md` (Env-Var dokumentieren)
- Modify: `docs/BACKLOG.md` (A1 als erledigt markieren)

> Docs gehen direkt auf master (Projektkonvention). Kein Test; Schritt ist „schreiben + committen".

- [ ] **Step 1: systemd-Doku** — in `systemd/README.md` `APE_LANGUAGE` in der Env-Var-Übersicht ergänzen: „`APE_LANGUAGE` (optional, `de`|`en`, Default `de`) — Sprache aller KI-Freitexte. Gehört in die systemd-Units des Kerns (Scan/Tick/Listener), nicht in den `ape-ui`-Container."

- [ ] **Step 2: Self-Host-Quickstart** — die neue Env-Var an der bestehenden Stelle für Env-Variablen ergänzen (gleiche Formulierung wie oben).

- [ ] **Step 3: BACKLOG** — in `docs/BACKLOG.md` unter „Reihenfolge" Punkt A1 als erledigt markieren (z.B. `~~A1 Language-Setting~~ — erledigt 2026-06-13`) und in der Kategorie A einen Erledigt-Hinweis ergänzen.

- [ ] **Step 4: Commit**

```bash
git add docs/ systemd/README.md
git commit -m "docs: APE_LANGUAGE dokumentieren + A1 als erledigt markieren

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review (vom Plan-Autor durchgeführt)

**Spec-Abdeckung:**
- Datenmodell/Config (`Language`, `SUPPORTED_LANGUAGES`, `Env.language`, `APE_LANGUAGE`-Parsing, throw on invalid) → Tasks 1+2. ✓
- Sprachmodul/Direktiven (`strategyDirective`/`trendingDirective`/`jsonOnly`, Label-Tausch, `HEADLESS_JSON_DIRECTIVE` konstant) → Tasks 1+4. ✓
- Threading (prompts-Inputs, `buildAdminPrompt`-Param, select/tickPipeline/journalCommand, scan/pipeline + strategy, Entry-Points) → Tasks 4-7. ✓
- Inline-„deutsche" neutralisiert → Task 4. ✓
- Doctor meldet Sprache → Task 3. ✓
- Tests (language/env/prompts + EN-Guards in scan/strategy/select) → in jeder Task. ✓
- DE byte-identisch / Regressionssicherung → Default `de` überall, Gesamt-Suite-Lauf in Tasks 1/4/6/7. ✓
- Deploy-Hinweis systemd-Kern → Task 8. ✓

**Platzhalter-Scan:** keine TBD/TODO; jeder Code-Schritt zeigt konkreten Code. ✓

**Typ-Konsistenz:** `Language`, `freetextLabel`, `strategyDirective`, `trendingDirective`, `jsonOnly`, `SUPPORTED_LANGUAGES` durchgängig identisch benannt; `language?: Language` (optional, Default `de`) in allen Deps/Inputs konsistent. ✓
