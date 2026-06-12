# Handoff — 2026-06-12: Lebenszeichen-Härtung + Kür-Ansicht

Session-Übergabe für die nächste Entwicklungsrunde. Stand: beide Features
fertig, getestet (287/287, `tsc --noEmit` sauber), nach master gemerged und
gepusht (`3a0906d`).

## Was diese Session geliefert hat

### 0. Analyse: „Mr Ape meldet sich nicht mehr" (Auslöser der Session)

Befund: **kein Defekt**. Die Server-Logs zeigten Monitor-Ticks alle 5 Minuten,
alle Timer gesund. Letzte Telegram-Meldung 15:30 hieß nur: seitdem kein Fill,
kein Band-Bruch — der Manager wird per Design nur ereignisgetrieben geweckt
(ADR 0003). Das eigentliche Risiko waren drei *stille* Fehlermodi, die von
außen wie ein ruhiger Markt aussehen. Daraus wurde Feature 1.

### 1. Lebenszeichen & Alert-Härtung (gemerged, deployed-pending s.u.)

Spec: `docs/superpowers/specs/2026-06-12-lebenszeichen-alert-haertung-design.md`
Plan: `docs/superpowers/plans/2026-06-12-lebenszeichen-alert-haertung.md`

- **`src/paper/health.ts`** (neu): operativer Zustand getrennt von der
  Depot-Wahrheit. `data/health.json` mit Tageszähler (ticksOk, quoteFailures,
  consecutiveQuoteFailures, quoteAlertActive). Day-Rollover behält den
  Outage-Zustand. Schwelle: `HEALTH.quoteFailureThreshold = 3`.
- **Quote-Blindheit alarmiert**: Nach 3 Quote-Fetch-Fehlern in Folge geht
  einmalig „⚠️ Monitor blind: N Ticks ohne Kurse — Stops werden nicht
  geprüft." raus; beim ersten guten Tick danach die Entwarnung
  „✅ Monitor wieder ok". Kein Alert-Spam (Flag `quoteAlertActive`).
- **Manager-Ausfall alarmiert**: Fehlgeschlagener Manager-Call meldet
  „⚠️ Mr Ape nicht erreichbar — Stops bleiben unverändert."
- **Tagesabschluss ist unbedingt**: Auch wenn der Close-Tick keine Kurse
  bekommt, kommt die Tageszusammenfassung — mit Stale-Markierung und
  Health-Zeile („Monitor: X Ticks ok, Y Quote-Fehler"). Heuristik für den
  Nutzer: **keine 22:00-Meldung = System tot** (steht so im CONTEXT.md-Glossar).
- **Stale-Close-Sicherheit**: Bei Close mit fehlgeschlagenem Fetch läuft
  `expireDayOrders` (neu in `src/paper/engine.ts`) statt `applyTick` — alte
  Tages-Extremes dürfen niemals Stops/Fills auslösen, `lastTick` bleibt als
  Fill-Evidenz-Baseline unangetastet (ADR 0001, konservative Fill-Regel).
  Manager-Call und Band-Ableitung werden bei stale ebenfalls übersprungen.

### 2. Kür-Ansicht im Depot-UI (gemerged, deployed-pending s.u.)

Spec: `docs/superpowers/specs/2026-06-12-kuer-ansicht-design.md`
Plan: `docs/superpowers/plans/2026-06-12-kuer-ansicht.md`

- **`src/paper/kuerArtifact.ts`** (neu): pro Kür-Tag ein strukturiertes JSON
  unter `DATA_DIR/kuer/<YYYY-MM-DD>.json` — scanSummary, Dossier, Debatte,
  decisionJournal, platzierte Orders, abgelehnte Orders, Status
  (`decided` | `skipped-unreadable`). Atomic write (tmp + rename).
- **`runKuer` persistiert an der Quelle** (`src/paper/select.ts`): am
  Unreadable-Exit und nach placeOrders/savePortfolio. `trySaveKuer` —
  ein Speicherfehler bricht die Kür nie ab (Telegram-Post geht trotzdem raus).
  Beim Budget-Skip entsteht bewusst **kein** Artefakt.
- **UI-Routen** (`src/ui/server.ts`): `GET /api/kuer/days` (neueste zuerst)
  und `GET /api/kuer?day=YYYY-MM-DD` (400 bei kaputtem Day, 404 bei fehlend).
- **Frontend**: neue Sektion „Kandidatenkür" zwischen Orders und Journal —
  Tagesauswahl (`<select>`), Kandidaten-Karten (Katalysator/Sentiment,
  Bull/Bear-Grid), „Mr Apes Begründung", Platzierte/Abgelehnte Orders,
  Scan-Kontext als `<details>`. Degradierte Läufe werden ehrlich markiert
  („Research fehlgeschlagen — entschieden auf Scan-Basis." /
  „Keine Debatte verfügbar." / „Entscheidung unlesbar — keine Trades an
  diesem Tag."). Fehler in der Kür-Sektion sind non-fatal fürs restliche UI.

## Deploy-Status (WICHTIG für die nächste Session)

- master ist gepusht (`b8c50ef..3a0906d`). Der Nutzer zieht selbst auf dem
  VPS: `ssh root@159.69.202.146 "cd /opt/ape-signal && git pull && npm ci"`
  plus Neustart des UI-Dienstes. **Verifizieren, ob das passiert ist**, bevor
  man Verhalten auf dem Server beurteilt.
- Kür-Artefakte entstehen erst ab der **nächsten** Kandidatenkür (nächster
  Handelstag, PreUS). Ältere Küren existieren nur als Journal-Prosa und
  erscheinen nicht rückwirkend — die UI zeigt bis dahin den Leer-Hinweis.
- `data/health.json` entsteht beim ersten Monitor-Tick nach dem Deploy.

## Nächste Backlog-Punkte (vom Nutzer benannt, noch NICHT beauftragt)

Der Nutzer hat zwei eigene Ideen für „später" hinterlegt — erst auf Zuruf
starten, dann via Superpowers-Workflow (brainstorming → spec → plan → TDD):

1. **Language-Setting** — Persona-Ausgaben (Journal, Telegram, Tagesabschluss)
   konfigurierbar statt fest Deutsch.
2. **Handelsfenster-Setting** — Session konfigurierbar statt fest US 15:30–22:00
   Europe/Berlin; betrifft systemd-Timer, Fill-Fenster-Logik, Close-Zeitpunkt.

Restliches Backlog in `docs/BACKLOG.md` (Proxy fürs Crawling, Setup-Assistent,
TradingView-Embed, Mr-Ape-Chat im UI).

## Arbeitsweise dieser Session (bewährt, beibehalten)

- Superpowers-Workflow strikt: brainstorming → spec → writing-plans →
  executing-plans (TDD red-green, Commit pro Task) →
  finishing-a-development-branch.
- Nutzer-Präferenzen: Entwicklung **inline** (keine Subagents), Branch-Abschluss
  per **lokalem `--no-ff`-Merge nach master** + Test-Verifikation auf dem
  Merge-Ergebnis + Branch löschen. Docs gehen direkt auf master.
- Commit-Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- SSH auf den VPS hat nur der Nutzer (Passwort, interaktiv) — Befehle als
  `! ssh root@159.69.202.146 "..."` vorschlagen, der `!`-Prefix führt sie in
  der Session aus.
- Bekannt & ok: vitest-stderr zeigt gewollte Degradations-Logs (StockTwits 403
  etc.) — das sind Tests der Degradationspfade, keine Fehler.

## Schlüsseldateien

| Bereich | Dateien |
|---|---|
| Health/Alerts | `src/paper/health.ts`, `src/paper/tickPipeline.ts`, `src/paper/engine.ts` (expireDayOrders), `src/paper/format.ts` |
| Kür-Artefakte | `src/paper/kuerArtifact.ts`, `src/paper/select.ts`, `src/scan/index.ts` |
| Depot-UI | `src/ui/server.ts`, `src/ui/public/{index.html,app.js,style.css}` |
| Doku | `CONTEXT.md` (Glossar Monitor-Tick/Tagesabschluss), `docs/BACKLOG.md`, ADRs 0001/0003/0004 |
