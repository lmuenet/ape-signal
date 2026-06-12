# Design — Kür-Ansicht im Depot-UI (strukturierte Kür-Artefakte)

Datum: 2026-06-12 · Status: validiert

## Problem

Die Kandidatenkür ist der eine Entscheidungspunkt pro Handelstag, aber ihre
Grundlagen (Dossier, Bull/Bear-Debatte, Opus-Begründung, abgelehnte Trades)
existieren nur flüchtig: als Journal-Prosa und Telegram-Post. Im Depot-UI ist
nicht nachvollziehbar, warum Mr Ape an einem Tag gehandelt hat — obwohl
`runKuer` alle Teile strukturiert im Speicher hat und sie nur wegwirft.

## Entscheidung

`runKuer` persistiert seine Artefakte selbst (an der Quelle, kein Parsing,
kein zweiter Wahrheitsort); das read-only UI bekommt einen „Kür"-Tab mit
Tageshistorie.

### 1. Artefakt: eine JSON-Datei pro Kür-Tag

Neues Modul `src/paper/kuerArtifact.ts` (Typ + Save/Load/List, atomarer
Write wie `savePortfolio`). Ablage: `DATA_DIR/kuer/YYYY-MM-DD.json`.

```json
{
  "day": "2026-06-12",
  "createdAt": "2026-06-12T13:25:00.000Z",
  "scanSummary": "kompakter PreUS-Scan-Block (Basis der Recherche)",
  "dossier": { "candidates": [{ "ticker": "...", "angle": "...", "catalyst": "...", "sentiment": "..." }], "marketContext": "..." },
  "debate": { "debates": [{ "ticker": "...", "bull": "...", "bear": "..." }] },
  "decisionJournal": "Opus' Begründung",
  "orders": ["… die akzeptierten EntryOrder-Objekte unverändert (inkl. Wake-Bänder) …"],
  "rejected": [{ "ticker": "...", "side": "short", "reason": "..." }],
  "status": "decided"
}
```

- `dossier: null` = Research degradiert (Scan-only entschieden).
- `debate: null` = Debatte ausgefallen (oder kein Dossier → nie versucht).
- `decisionJournal: null` + `status: "skipped-unreadable"` = Entscheidung
  unlesbar, keine Trades — Dossier/Debatte werden trotzdem archiviert.
- `status: "decided"` deckt auch „0 Orders platziert" ab (bewusste
  Nicht-Entscheidung ist eine Entscheidung).
- Bricht die Kür vor dem Research ab (Tagesbudget verbraucht), entsteht
  **kein** Artefakt — der Tag fehlt in der Liste.

### 2. Kür-Änderung

`KuerDeps` bekommt `saveKuer: (artifact: KuerArtifact) => void`, verdrahtet
im Aufrufer (`src/scan/index.ts`) auf das neue Modul. Gespeichert wird an
beiden Ausgängen von `runKuer`:

- nach `placeOrders` (Status `decided`; `orders` sind die akzeptierten
  `EntryOrder`-Objekte unverändert, `rejected` wird auf
  `{ ticker, side, reason }` reduziert),
- beim Unlesbar-Abbruch (Status `skipped-unreadable`).

Ein Save-Fehler bricht die Kür nie ab (Log + weiter, Muster Tick-Historie).
`opts.scanSummary` wandert mit ins Artefakt.

### 3. UI-API (bestehender node:http-Stil in `src/ui/server.ts`)

- `GET /api/kuer/days` → sortierte Liste vorhandener Kür-Tage (neueste
  zuerst), aus den Dateinamen in `DATA_DIR/kuer/`.
- `GET /api/kuer?day=YYYY-MM-DD` → das Artefakt; 400 bei ungültigem
  Day-Format (Regex wie bei `/api/ticks`), 404 wenn der Tag fehlt.

### 4. UI-Ansicht

Neuer Tab „Kür" im bestehenden Frontend (`index.html`, `app.js`,
`style.css` — bestehende Optik):

- Tages-Dropdown, neuester Tag vorausgewählt.
- `scanSummary` als einklappbares `<details>` („Scan-Kontext").
- Pro Dossier-Kandidat eine Karte: Angle, Katalysator, Sentiment; darunter
  Bull/Bear aus der Debatte gegenübergestellt.
- Opus' `decisionJournal` als Begründungsblock.
- Orders: platzierte (mit Einsatz/Hebel/SL/TP/These), abgelehnte mit Grund.
- Degradationsfälle zeigen Hinweise statt leerer Flächen: „Research
  fehlgeschlagen — entschieden auf Scan-Basis", „keine Debatte verfügbar",
  „Entscheidung unlesbar — keine Trades an diesem Tag".

## Alternativen

- **Journal-Prosa rückwärts parsen**: kein Kür-Eingriff, aber Prosa ist kein
  Vertrag und Dossier/Debatte stehen gar nicht im Journal. Verworfen.
- **Generisches Event-Log (JSONL)** aller Kür-Schritte: flexibler, aber es
  gibt genau eine Ansicht pro Tag — YAGNI. Verworfen.
- **Rohe LLM-Antworten mitarchivieren**: maximale Transparenz, aber große
  Dateien und im UI unlesbar. Verworfen (Nutzerentscheidung).

## Tests

- `kuerArtifact`: Save/Load-Round-trip, atomarer Write, `listKuerDays`
  sortiert absteigend, Load eines fehlenden Tags.
- `select.test.ts` (deps-injiziert, existiert): `saveKuer` wird bei
  `decided` mit Orders/Rejected aufgerufen; bei unlesbarer Entscheidung mit
  `skipped-unreadable` inkl. Dossier/Debatte; ein werfender `saveKuer`
  bricht die Kür nicht ab (Telegram-Post kommt trotzdem).
- `server.test.ts`: beide Routen — gültiger Tag, ungültiges Format (400),
  fehlender Tag (404), Tagesliste.

## Nicht-Ziele

- Kein Telegram-Umbau (das UI ist Pull, Telegram bleibt Push).
- Keine Migration alter Tage (Artefakte entstehen ab Deploy).
- Keine Anzeige roher LLM-Antworten.
