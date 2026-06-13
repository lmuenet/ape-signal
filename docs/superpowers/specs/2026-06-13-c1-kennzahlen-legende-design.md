# Spec — C1 (Baseline): Feste Kennzahlen-Legende über dem Positions-Chart

Datum: 2026-06-13 · Status: brainstormt, zur Freigabe
Backlog: C1 (TradingView-Embed + Kennzahlen-Overlay), hier **nur der sichere
Overlay-Teil**. ADR-Kontext: 0004 (read-only Depot-UI im Container),
0003 (Wake-Up-Bänder).

## Ziel & Abgrenzung

C1 ist im Backlog in zwei trennbare Teile geschnitten: ein **sicher von uns
lieferbares Kennzahlen-Overlay** und ein **TradingView-Embed/Refresh**
(abhängig von externen Restriktionen). Diese Spec liefert **ausschließlich die
Baseline des Overlays**: eine **immer sichtbare Kennzahlen-Legende** über jedem
Positions-Chart im Depot-UI, mit aktuellem Kurs und Abstand zu den Schwellen.

Damit wird das eigentliche Problem gelöst: Entry/SL/TP/Wake stehen heute zwar
als gestrichelte `priceLine`-Overlays im Chart und als statische Text-Meta-Zeile
in der Card — aber **ohne aktuellen Kurs und ohne Abstand**, und die
Linien-Titel sind beim Zoomen/Scrollen schlecht ablesbar. Die feste Legende
macht den Verlauf relativ zu den Schwellen jederzeit nachvollziehbar.

## Erfolgskriterien

- Über jedem Chart einer **offenen Position** steht eine immer sichtbare Leiste
  mit: **Kurs · Entry · TP · Wake↑ · Wake↓ · SL**.
- Jede Schwelle zeigt **Preis + vorzeichenbehafteten Abstand zum aktuellen
  Kurs in %** (1 Nachkomma), z. B. `TP 28.00 (+10.7%)`.
- Die Legende ist auch sichtbar, wenn **noch keine Tick-Historie** vorliegt
  (Chart leer) — sie hängt nur am aktuellen Kurs, nicht am Chart.
- Fehlende Werte (kein Kurs / keine TP / keine Wake-Bänder) brechen nichts:
  „—" statt Zahl, kein %.
- Die bisherige statische Meta-Zeile (`Entry · SL · TP · Wake`) entfällt.
- Reine Frontend-Änderung; `/api/state` bleibt unverändert.

## Architektur

**Reiner Frontend-Change** im `ape-ui`-Container — keine Server-/API-Änderung.
Betroffen:

- `src/ui/public/app.js` — DOM-Verdrahtung der Legende in der Positions-Card.
- `src/ui/public/style.css` — Layout der Leiste (Variante „Leiste oben",
  volle Breite, responsiv umbrechend).
- **Neues reines Modul** für die testbare Logik (siehe Testbarkeit).

Alle benötigten Daten liegen bereits im `/api/state`-Payload:

- Schwellen je Position: `entryPrice`, `stopLoss`, `takeProfit`,
  `wakeAbove`, `wakeBelow` (aus `portfolio.positions[]`).
- Aktueller Kurs: `portfolio.lastTick.quotes[ticker].close` (in `app.js`
  bereits als `quotes` an `positionCard` durchgereicht).

**Deploy-Konsequenz (ADR 0004):** Das UI baut sein eigenes `node_modules` und
seine Statics beim `docker build`. Ein Host-`git pull && npm ci` aktualisiert
den Container **nicht** — C1 wird per `docker build` + Container-Neustart
ausgerollt (Container immer mit `--network my-lab-net`, siehe CLAUDE.md).

## Komponente: Legenden-Leiste

- Position: über dem Chart innerhalb der bestehenden Positions-Card, **statt**
  der heutigen `Entry · SL · TP · Wake`-Meta-Zeile.
- Feste Feldreihenfolge: **Kurs, Entry, TP, Wake↑, Wake↓, SL.**
- Darstellung pro Feld: Label + Preis; bei den Schwellen zusätzlich der
  Abstand zum aktuellen Kurs in Klammern.
- Abstand-Formel: `pct = (schwelle − kurs) / kurs * 100`, vorzeichenbehaftet,
  1 Nachkomma. Rein positional (gilt für long wie short gleich); die
  Bewertung gut/schlecht steckt allein in der Rollen-Farbe, nicht im Vorzeichen.
- Farben nach Rolle (bestehende Palette): TP grün (`#3fb68b`), SL rot
  (`#e0556a`), Wake↑/Wake↓ bernstein (`#caa75c`), Kurs/Entry neutral
  (`#e6e9ef`/`#8b96a8`).
- Erhalten bleiben: Card-Kopf (Ticker, Seite, Leverage, Einsatz, P&L), die
  Thesis-Meta-Zeile und die gestrichelten `priceLine`-Overlays im Chart
  (doppelte Verankerung Chart↔Legende ist gewollt).

## Datenfluss & Edge-Cases

- Die Legende wird in `positionCard(pos, quotes)` gebaut (dort liegen Kurs +
  Schwellen) — **unabhängig** von `drawTickerChart`. So steht sie auch, wenn
  der Chart „Noch keine Tick-Historie …" anzeigt.
- **Kein aktueller Kurs** (`lastTick` fehlt oder Ticker nicht in `quotes`):
  Kurs = „—", alle Abstands-% entfallen, die Schwellenpreise bleiben sichtbar.
- **Schwelle nicht gesetzt** (`takeProfit`/`wakeAbove`/`wakeBelow` undefiniert):
  Feld zeigt „—", kein %. (Entry/SL sind bei offenen Positionen immer gesetzt.)
- **Kurs = 0** (defensiv): kein %, „—", keine Division durch 0.

## Testbarkeit (TDD)

Die riskante, reine Logik wird in ein eigenes **browser-ladbares ESM-Modul**
ausgelagert (analog zur Trennung `series.ts` ↔ `series.test.ts` von `server.ts`),
das **sowohl `app.js` als auch ein vitest-Test** importieren — kein Bundler/Build
nötig. Das Modul exportiert ein Legenden-**Modell** aus `pos` + `quote`
(je Feld: Label, Preis-Text, Abstand-% oder null, Rolle/Farbe). `app.js` bleibt
dünner DOM-Kleber, der dieses Modell rendert.

Test-Fälle:

- Normalfall: korrekte vorzeichenbehaftete %-Abstände für TP/SL/Wake↑/Wake↓.
- Fehlende Schwelle (kein TP / keine Wake-Bänder) → „—", kein %.
- Fehlender Kurs → Kurs „—", alle Abstände entfallen, Preise bleiben.
- Kurs = 0 → keine Division durch 0.
- Long und Short liefern dieselbe positionale %-Berechnung.

Die DOM-Verdrahtung (Einhängen in die Card, Wegfall der alten Meta-Zeile,
Styling) wird manuell im laufenden Container verifiziert.

*Plan-Detail (kein Spec-Festlegung):* der Plan bestätigt, dass die vitest-Config
das `.js`-Testmodul erfasst bzw. wählt das passende Dateiformat.

## Bewusst NICHT in dieser Spec (Folgearbeiten)

Diese Teile sind bewusst ausgeklammert und kommen später:

- **Simpel/detailliert-Umschalter**, **Candles**, **EMA 8**, **TradingView-
  Live-Embed/Refresh** mit voller Markthistorie.
- Diese Funktionen hängen **voraussichtlich am Proxy (B1)**: Der VPS erreicht
  heute keine freie Candle-/Chart-Quelle (ADR 0001), und die TradingView-Live-
  Historie sowie EMA-/Candle-Daten kommen erst über den rotierenden Proxy
  herein. B1 ist ausschließlich dafür da, **genau diese fehlenden Daten zu
  liefern**.
- **Diese Daten sind nicht nur UI-Deko, sondern wichtig für den Manager:**
  Mr Ape soll Candles/EMA und breiteren Marktkontext für seine
  **Entscheidungen** nutzen können (Wake-Up-getriebene Ticks fragen die
  variablen Schwellen ab; die zusätzlichen Quellen schärfen die
  Entscheidungsbasis). Die jetzige Baseline ist so gebaut, dass der spätere
  Detail-Modus die Legende unverändert weiterverwendet und nur den Chart-Inhalt
  ergänzt.
