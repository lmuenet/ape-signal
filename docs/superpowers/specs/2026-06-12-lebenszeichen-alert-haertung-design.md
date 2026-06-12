# Design — Lebenszeichen & Alert-Härtung (stille Degradation)

Datum: 2026-06-12 · Status: validiert

## Problem

Drei Ausfallarten des Monitor-/Manager-Systems bleiben heute still — von außen
nicht von einem ruhigen Markt unterscheidbar:

1. **Quote-Fetch scheitert wiederholt**: `runTick` überspringt den Tick still
   (`console.error`, kein Telegram). Stops und Fills werden nicht mehr geprüft.
2. **Manager-Call scheitert**: Mr Ape verpasst ein reales Ereignis (Fill,
   Band-Riss, Close); nur stderr.
3. **Timer feuert gar nicht** (Deploy-Fehler, Server tot): kein Prozess läuft —
   ein In-Process-Alert kann das prinzipiell nicht melden.

Auslöser: Tick-Analyse vom 2026-06-12 (System war gesund, aber die Stille war
nicht beweisbar).

## Entscheidung

Fall 1+2 lösen Fehlerzähler + Telegram-Alerts; Fall 3 löst ein garantiertes
positives Lebenszeichen: der **unbedingte Tagesabschluss** mit Gesundheitszeile
und der dokumentierten Konvention „kein Tagesabschluss um 22:00 = System tot".

### 1. Betriebszustand in eigener Datei `health.json`

Neues Modul `src/paper/health.ts` (pure Funktionen + Load/Save nach
`DATA_DIR/health.json`). Das Depot (`portfolio.json`) bleibt strikt Quelle der
Wahrheit für Depot-Zahlen; Betriebszustand ist kategorial etwas anderes.

Zustand:

```json
{
  "day": "2026-06-12",
  "ticksOk": 76,
  "quoteFailures": 2,
  "consecutiveQuoteFailures": 0,
  "quoteAlertActive": false
}
```

Bei Tageswechsel werden die Tagesstatistiken (`ticksOk`, `quoteFailures`)
zurückgesetzt; `consecutiveQuoteFailures` und `quoteAlertActive` bleiben — eine
Störung über Nacht bleibt eine Störung.

### 2. Quote-Fetch-Härtung (Schwelle 3, einmalig + Entwarnung)

Schlägt der Fetch fehl, wird der Tick wie bisher übersprungen (Depot-Zustand
unangetastet, konservative Fill-Regel unverändert) — aber der Zähler in
`health.json` inkrementiert. Beim **3. Fehler in Folge** (= 15 Minuten ohne Stop-Prüfung)
geht einmalig ein Alert raus:

> ⚠️ Monitor blind: 3 Ticks ohne Kurse — Stops werden nicht geprüft.

`quoteAlertActive` verhindert Wiederholung. Läuft der nächste Tick wieder
durch und das Flag ist aktiv:

> ✅ Monitor wieder ok.

Flag löschen, Zähler null. `ticksOk` zählt nur Ticks, die tatsächlich Kurse
geholt haben — No-op-Ticks ohne offene Positionen/Orders zählen nicht (sie
beweisen nichts über die Kursquelle).

### 3. Manager-Call-Härtung (sofort, ohne Schwelle)

Scheitert der Sonnet-Call, geht **sofort** ein Alert raus — abweichend von der
Quote-Logik, bewusst: Manager-Calls passieren nur bei echten Ereignissen;
scheitert einer, hat Mr Ape ein reales Ereignis verpasst. Ein
„in Folge"-Zähler wäre künstlich, weil zwischen zwei Manager-Calls Tage liegen
können. Die Engine schützt weiter deterministisch (Stops bleiben) — das sagt
der Alert auch:

> ⚠️ Mr Ape nicht erreichbar (Manager-Call fehlgeschlagen) — Stops bleiben unverändert.

### 4. Unbedingter Tagesabschluss mit Gesundheitszeile

Heute entfällt der Tagesabschluss, wenn beim Close-Tick der Quote-Fetch
scheitert (early return) — genau das Lebenszeichen, das nie ausfallen darf.

Neu beim Close-Tick mit Fetch-Fehler:

- Bilanziert wird mit den **letzten bekannten Kursen**
  (`portfolio.lastTick.quotes`), im Summary markiert als „(Kurse von HH:MM)".
- Stale Kurse dienen **nur der Bewertung** — sie treiben nie Fills, Stops oder
  Band-Checks (die wurden zu ihrem Tick bereits verarbeitet). Der Monitor-Pfad
  wird übersprungen.
- Zeitbasierte Pflichten laufen trotzdem: Day-Order-Expiry und das Summary.

Jeder Tagesabschluss bekommt eine Gesundheitszeile aus `health.json`:

> Monitor: 76 Ticks ok, 2 Quote-Fehler

Konvention (wird im Glossar unter „Tagesabschluss" dokumentiert): **Kommt um
22:00 kein Tagesabschluss, ist das System tot** — der einzige Fall, den kein
In-Process-Alert melden kann.

### 5. Fehlerpfad-Garantie

Alerts laufen über denselben `send` wie alles andere. Scheitert Telegram
selbst, greift weiter der bestehende catch-all in `tick.ts` (Exit ≠ 0 +
Best-Effort-Alert). Ein Fehler beim Schreiben von `health.json` darf nie einen
Tick abbrechen (Log + weiter, wie heute bei der Tick-Historie).

## Alternativen

- **Zähler in `portfolio.json`**: ein State-File weniger, aber vermischt
  Betriebs- mit Depotzustand; jede Änderung ginge durchs Depot-Schema, obwohl
  sie fachlich nichts mit dem Depot zu tun hat. Verworfen.
- **Externer systemd-Watchdog** für Fall 3: robuster (meldet auch tote Timer
  aktiv), aber mehr Infrastruktur mit eigenem Alarmpfad — der unbedingte
  Tagesabschluss deckt Fall 3 für einen Single-Operator ausreichend ab.
  Bleibt als Ausbaustufe denkbar.
- **Wiederholende Alerts** (z.B. stündlich): schwerer zu überhören, nervt bei
  bekannten Störungen. Einmal + Entwarnung hält den Kanal vertrauenswürdig.

## Tests (vitest, deps-injiziert wie bestehende `runTick`-Tests)

- Zähler-Verlauf über mehrere `runTick`-Aufrufe mit fehlschlagendem
  `fetchQuotes`: Alert genau beim 3. Fehler, keine Wiederholung beim 4.
- Entwarnung beim ersten erfolgreichen Tick nach aktivem Alert, Zähler-Reset.
- Tageswechsel: Tagesstatistik resettet, `consecutiveQuoteFailures` bleibt.
- Manager-Call-Fehler → sofortiger Alert, Stops unverändert.
- Close-Tick mit Fetch-Fehler: Summary kommt trotzdem (stale Kurse, Markierung,
  keine Fills/Band-Checks, Day-Order-Expiry läuft).
- Gesundheitszeile im Tagesabschluss.
- `health.json`-Schreibfehler bricht den Tick nicht ab.

## Nicht-Ziele

- Kein externer Watchdog, kein Healthcheck-Endpoint im Depot-UI (Ausbaustufe).
- Keine Änderung an Fill-Regeln, Cooldown oder Wake-Band-Logik (ADR 0003).
- Keine Retry-Logik beim Quote-Fetch — der nächste Tick ist ≤5 Minuten weg.
