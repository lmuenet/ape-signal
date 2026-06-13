# Handoff — 2026-06-13: Language-Setting + Handelsfenster-Setting

Session-Übergabe. Stand: beide Features fertig, getestet (340/340, `tsc
--noEmit` sauber), nach master gemerged **und auf den VPS deployed + verifiziert**.
master gepusht bis `a501fc1` (+ anschließender Docs/Handoff-Commit).

## Was diese Session geliefert hat

### A1 Language-Setting (gemerged, deployed)

Spec: `docs/superpowers/specs/2026-06-13-language-setting-design.md`
Plan: `docs/superpowers/plans/2026-06-13-language-setting.md`

- Sprache aller **KI-Freitexte** (Persona-Journal/Kür/Tick, Scan-/Strategie-
  Freitexte) konfigurierbar via **`APE_LANGUAGE`** (`de`|`en`, Default `de`).
- Ansatz **Direktiven-Overlay**: deutsche Prompt-Körper bleiben, nur das
  Sprach-**Label** in der Schluss-Direktive wechselt → **DE byte-identisch** zu
  vorher. JSON-Keys + Enums bleiben in **jeder** Sprache englisch (Parser-Schutz).
- `src/core/language.ts`: `Language`, `SUPPORTED_LANGUAGES`, `freetextLabel`,
  `strategyDirective(lang)`, `trendingDirective(lang)` (vorher feste Konstanten).
- `loadEnv` parst `APE_LANGUAGE` (ungültig → throw). Durchgereicht über die DI-
  Deps in alle Prompt-Builder (paper + scan + strategy), Default `de`.
- `doctor` weist die aktive Sprache aus.

### A2 Handelsfenster-Setting (gemerged, deployed)

Spec: `docs/superpowers/specs/2026-06-13-handelsfenster-setting-design.md`
Plan: `docs/superpowers/plans/2026-06-13-handelsfenster-setting.md`

- Handelsfenster konfigurierbar via **`SESSION`** (Presets `us`/`xetra`) +
  Overrides `SESSION_OPEN`/`SESSION_CLOSE`/`SESSION_KUER_SCAN`,
  `TICK_INTERVAL_MIN`. Genau **eine Session** zur Zeit. Zeitzone bleibt
  Europe/Berlin; `isClose` bleibt label-getrieben.
- `src/config/session.ts`: `loadSession()` (Presets + Overrides + Validierung,
  fail-fast).
- `src/config/genTimers.ts` (`npm run gen-timers`): erzeugt die **drei**
  session-getriebenen Timer (`ape-signal-scan-preus`, `ape-signal-tick`,
  `ape-signal-tick-close`). Tick-Timer feuert **jede Minute** im Fenster;
  schreibt nach `/etc/systemd/system` (`--out=` für Tests). PreOpen-Scan bleibt
  fix/unangetastet.
- **Tick-Intervall entkoppelt vom Timer:** Laufzeit-Wert (`data/tickInterval.json`
  → sonst `TICK_INTERVAL_MIN` → Preset 5). Die Pipeline **drosselt vor dem
  TradingView-Abruf** (`tickPipeline.ts` + neues `Portfolio.lastTickAt`);
  Close-Tick drosselt nie. `src/paper/tickInterval.ts` (read/write/resolve,
  korrupt → Fallback).
- **Telegram `/ticker N`** (live): setzt das Intervall sofort; `/ticker` ohne
  Arg zeigt den Wert; Edge-Cases (Nicht-Zahl/Dezimal/`<1`/`>60`) → Fehler-Reply.
  Parser in `commands.ts`, Handler in `listener.ts`.
- Prompts session-neutral („Handelsstart"/„Handelsschluss"/„Handelssession
  läuft" statt US-spezifisch). `doctor` zeigt das aktive Fenster.

## Deploy-Status — ERLEDIGT (2026-06-13)

- VPS gezogen (`git pull && npm ci`), `/etc/ape-signal.env` um
  `APE_LANGUAGE=de`, `SESSION=us`, `TICK_INTERVAL_MIN=5` ergänzt, `npm run
  gen-timers && systemctl daemon-reload`, Listener + 3 Timer neugestartet.
- `npm run doctor` grün inkl. `Session: 15:30–22:00, Kür-Scan 15:15, Tick 5min`
  und `(Sprache: de)`. Telegram/`/ticker` reagieren.
- **Deploy-Stolperstein (für nächstes Mal):** Der Host hatte einen
  uncommitteten **vitest-4-Bump** in `package.json` **und** `package-lock.json`
  → `npm ci` schlug fehl (lock ≠ package.json). Fix war: `git stash push
  package.json` + `git checkout -- package-lock.json` (committeter Stand =
  vitest 1.6.1) + `git stash drop`, dann `npm ci`. Falls vitest 4 wirklich
  gewünscht ist: **sauber als eigene Änderung** (package.json + Lockfile +
  Tests gegen den Major-Bump grün), nicht als Host-Hack.
- Wochenende beim Deploy → Live-Minutenraster/Drossel erst ab **Mo 15:30**
  sichtbar (`journalctl -u 'ape-signal-tick@*'` zeigt dann
  `[tick] throttled …` bzw. echte Ticks).

## Nächste Backlog-Punkte (NICHT beauftragt — erst auf Zuruf)

Reihenfolge & Details in `docs/BACKLOG.md`. Heißeste Kandidaten:

- **C1 TradingView-Embed + Kennzahlen-Overlay** — Wake-up/Entry der offenen
  Positionen **immer sichtbar** (sicher, von uns lieferbar) + Embed/Refresh
  (abhängig von TradingViews Restriktionen). In der Spec trennen.
- **B2 EMA-Signal (EMA 8)** — Zenbotscanner/Candles, EMA 8 als Trend-Indikator;
  offene Frage: nur anzeigen vs. in Scan-/Signal-Logik. Profitiert von B1.
- **B3 Trending-Scan überarbeiten** (neu) — liefert immer dieselben Ticker,
  geringer Nutzen; Kür+Paper sind effizienter. Behalten/umbauen/abschalten?
- **C4 Session/Tick-Verwaltung im UI** (neuer Nutzerwunsch) — `SESSION`/
  Overrides/Tick bequem aus dem **UI-Container** pflegen. Knackpunkt: UI ist
  read-only + eigener Container; Timer-Regen + `daemon-reload` laufen auf dem
  **Host** → privilegierter Pfad nötig oder Entkopplung wie beim Tick-Intervall.
  Enger Nachbar von C3.

Ältere Punkte: B1 Proxy, C2 Mr-Ape-Chat im UI, C3 Setup-Assistent, D1
Claude-Health-Check.

## Arbeitsweise (bewährt, beibehalten)

- Superpowers-Workflow strikt: brainstorming → spec → writing-plans →
  executing-plans (TDD red-green, **Commit pro Task**) →
  finishing-a-development-branch.
- Entwicklung **inline** (keine Subagents). Branch-Abschluss per lokalem
  `--no-ff`-Merge nach master + Test-Verifikation auf dem Merge-Ergebnis +
  Branch löschen. Docs/Handoff direkt auf master.
- Commit-Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- SSH auf den VPS hat **nur der Nutzer** — Befehle als
  `! ssh root@159.69.202.146 "..."` vorschlagen. **Verschachteltes Shell-
  Escaping über SSH meiden** (der `for/grep -q`-Einzeiler scheiterte still;
  `printf ... >> file` lief sauber).
- Bekannt & ok: vitest-stderr zeigt gewollte Degradations-Logs.

## Schlüsseldateien

| Bereich | Dateien |
|---|---|
| Sprache | `src/core/language.ts`, `src/config/env.ts`, `src/paper/prompts.ts`, `src/scan/pipeline.ts`, `src/strategy/strategy.ts` |
| Session/Timer | `src/config/session.ts`, `src/config/genTimers.ts`, `systemd/*.timer` (US-Baseline) |
| Tick-Intervall | `src/paper/tickInterval.ts`, `src/paper/tickPipeline.ts` (Drossel + `lastTickAt`), `src/paper/tick.ts` |
| Telegram /ticker | `src/telegram/commands.ts`, `src/telegram/listener.ts` |
| Diagnose/Doku | `src/config/doctor.ts`, `.env.example`, `systemd/README.md`, `CONTEXT.md`, `docs/BACKLOG.md` |
