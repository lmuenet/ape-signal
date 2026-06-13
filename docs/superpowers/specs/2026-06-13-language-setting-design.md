# Spec — A1 Language-Setting (Sprache der LLM-Freitexte)

Datum: 2026-06-13 · Status: genehmigt (Brainstorming abgeschlossen)
Backlog: `docs/BACKLOG.md` → A1

## Ziel

Die Sprache aller **KI-generierten Freitexte** konfigurierbar machen statt fest
Deutsch — als Baustein für den Public-Self-Host-Pfad. Die Sprache wird **einmal
beim VPS-Setup** gewählt und von dort variabel an alle Prompt-Pfade
weitergegeben.

## Scope

**Drin (Scope A):** alle LLM-Freitexte —
- Persona: Journal-, Kür-/Decision-, Debate-, Dossier- und Tick-Texte
  (`src/paper/prompts.ts`), inkl. Tagesabschluss (Close-Tick-Journal).
- Scan/Strategie: Freitexte aus `strategyDirective`/`trendingDirective`
  (`src/core/language.ts`).

**Draußen:** fest getextete System-Strings (Telegram-Statusmeldungen,
Scan-Tabellen, Health-Pings, Command-Antworten in `format.ts`/`commands.ts`)
und UI-Labels. Können später als B/C nachgezogen werden.

## Entscheidungen (aus dem Brainstorming)

- **Sprachumfang:** DE/EN jetzt, Architektur offen für mehr (Option C) — neue
  Sprache = ein Map-Eintrag.
- **Ansatz:** Direktiven-Overlay (Ansatz 1). Prompt-Körper bleiben deutsch;
  gewechselt wird nur das **Sprach-Label** in der Schluss-Direktive. Der
  DE-Pfad bleibt damit **byte-identisch** zu heute (kein Verhaltenswechsel,
  Regressionssicherung).
- **Var-Name:** `APE_LANGUAGE` (deckt Persona *und* Scan/Strategie ab).
- **Ungültiger Wert:** hart fehlschlagen (`throw`), nicht still auf DE
  zurückfallen — konsistent mit den `REQUIRED`-Checks in `loadEnv`.
- **`HEADLESS_JSON_DIRECTIVE`** bleibt konstant deutsch (Ausführungsmodus, keine
  Output-Sprache).
- **Invarianz über alle Sprachen:** JSON-Keys + Enum-Werte bleiben englisch
  festgenagelt (`long|short|stay-out`, `signal|noise|watch`,
  `low|medium|high`, `side ∈ long|short`, Adjustment-`type`s).

## Architektur

### 1. Datenmodell & Config

In `src/core/language.ts`:
```ts
export type Language = "de" | "en";
export const SUPPORTED_LANGUAGES: Language[] = ["de", "en"];
const FREETEXT_LABEL: Record<Language, string> = { de: "DEUTSCH", en: "ENGLISCH" };
```

In `src/config/env.ts`:
- `Env` bekommt `language: Language`.
- `loadEnv`: `APE_LANGUAGE` lesen, `trim().toLowerCase()`; unset/leer → `"de"`;
  Wert ∈ `SUPPORTED_LANGUAGES` → übernehmen; sonst `throw new Error(...)` mit
  klarer Meldung (erlaubte Werte nennen).
- `src/config/doctor.ts`: aktive Sprache in der Diagnose ausweisen.

### 2. Sprachmodul & Direktiven

Die festen Konstanten werden zu sprach-parametrierten Buildern:
- `strategyDirective(lang: Language): string` (ersetzt `GERMAN_DIRECTIVE_STRATEGY`)
- `trendingDirective(lang: Language): string` (ersetzt `GERMAN_DIRECTIVE_TRENDING`)
- `jsonOnly(lang: Language): string` (ersetzt die `JSON_ONLY`-Konstante in
  `prompts.ts`; lebt sinnvollerweise in `core/language.ts` oder bleibt in
  `prompts.ts` — Implementierungsdetail des Plans)

Jeder Builder interpoliert `FREETEXT_LABEL[lang]` an der Stelle, wo heute fest
„DEUTSCH" steht. Für `lang="de"` ist das Ergebnis identisch zu heute.
`HEADLESS_JSON_DIRECTIVE` bleibt unverändert.

### 3. Threading

Sprache wird **einmal** in `loadEnv()` an den Entry-Points geladen
(`scan/index.ts`, `telegram/listener.ts`, `paper/tick.ts`) und nach unten
durchgereicht:
- `paper/prompts.ts`: `language` in die Input-Interfaces (`DossierPromptInput`,
  `DebatePromptInput`, `DecisionPromptInput`, `TickPromptInput`) aufnehmen;
  `buildAdminPrompt(text, balance, language)`. Jeder Builder ruft
  `jsonOnly(language)`.
- `paper/select.ts`, `paper/tickPipeline.ts`, `paper/journalCommand.ts` reichen
  `env.language` in die Builder.
- `scan/pipeline.ts` → `trendingDirective(env.language)`;
  `src/strategy/strategy.ts` → `strategyDirective(env.language)`.
- Inline-Sprachwörter (z.B. „kurze **deutsche** Journal-Notiz" in
  `buildAdminPrompt`, „kurze Notiz" im Tick) werden sprachneutral umformuliert;
  die Output-Sprache steuert allein die `jsonOnly`-Direktive.

## Datenfluss

```
Setup (docker -e APE_LANGUAGE=de|en  /  systemd Env)
  → loadEnv() validiert → Env.language
    → Prompt-Builder (jsonOnly / strategyDirective / trendingDirective)
      → FREETEXT_LABEL[lang] in die Schluss-Direktive
        → Claude schreibt Freitext in Zielsprache; JSON-Keys/Enums bleiben EN
```

## Fehlerbehandlung

- Ungültiger `APE_LANGUAGE`-Wert: `loadEnv` wirft sofort (Dienst startet nicht;
  Symptom beim Setup sichtbar, nicht erst zur Laufzeit).
- Fehlt `APE_LANGUAGE`: Default `"de"` — Bestandssysteme verhalten sich
  unverändert.

## Tests

- `core/language.test.ts`: `strategyDirective`/`trendingDirective`/`jsonOnly`
  für `de` (Bestands-Assertions: „DEUTSCH" + Enum-Tokens) **und** `en` (statt
  „DEUTSCH" → „ENGLISCH", Enum-Tokens unverändert).
- `config/env.test.ts`: `APE_LANGUAGE` unset→`de`, `"en"`/`"EN"`→`en`,
  ungültig (`"xx"`) → wirft.
- `paper/prompts.test.ts`: Builder mit `language:"en"` enthalten
  „ENGLISCH"-Direktive + intakte JSON-Struktur/Enums; `language:"de"`
  unverändert (Regressionssicherung).
- Vorgehen: TDD red-green pro Task, ein Commit pro Task.

## Nicht-Ziele / YAGNI

- Keine Laufzeit-Umschaltung (Sprache ist Setup-Zeit-Config).
- Keine Übersetzung der System-/Template-Strings oder UI-Labels.
- Keine pro-Sprache hand-getunten Prompt-Sets.

## Deploy-Hinweis

Die LLM-Läufe (Scans, Ticks, Telegram-Listener) laufen im **systemd-Kern** auf
dem Host — `APE_LANGUAGE` gehört daher in die **systemd-Units** (`systemd/`),
nicht in den `ape-ui`-`docker run` (die UI ist nur read-only Viewer und ruft
kein LLM). Fehlt die Var → Default DE. Beim nächsten
Self-Host-Quickstart-Update aufnehmen.
