# EUR-Pricing & deutsche Live-Kursquelle (gegen Stale-US-Data)

**Datum:** 2026-06-23 · **Branch:** `feat/eur-deutsche-kursquelle` (auf `origin/master`)
**Status:** FREIGEGEBEN — Phase 0 abgeschlossen, Phase 1 startet.

**Sign-off Lars (2026-06-23):**
- **v1 = nur EUR-gelistete Namen, kein FX.** Reine US-Namen ohne brauchbare deutsche
  Notiz fallen vorerst raus (unterstützt Ziel 3). FX/gemischte Währungen → Folge-PR.
- **Frischer EUR-Depot-Start.** Bestehende USD-Positionen werden nicht umgerechnet;
  die hängende QCOM-Position ist damit erledigt.

## Problem (Root-Cause)

Die **einzige** Preisquelle ist heute der TradingView-`america/scan` (US-Listings,
USD) — genutzt von Kür-Trend (`core/marketData.ts`) **und** Tick-Fills/Stops
(`paper/quotes.ts`). Während des **Xetra-Fensters (09:00–15:30 Berlin)** ist die
US-Börse zu → der Scanner liefert den **US-Schlusskurs vom Vortag**. Es gibt
**keine Frische-Prüfung**.

Konkreter Schaden (Beispiel QCOM): Kür um 08:45 entscheidet long @ ~219,5 (US-Close
Vortag), SL 211. Der Monitor-Tick sieht bis 15:30 denselben eingefrorenen Wert
(`paper/tickPipeline.ts:97-125` schützt nur bei Fetch-*Fehler*, nicht bei
„erfolgreich-aber-alt"). Der Stop kann nicht auslösen (`engine.ts:56-69` braucht
ein neues Tief/Cross — eingefrorene Daten liefern keins), während der reale Kurs
längst auf 205 gefallen ist. Position offen, Stop tot, bis die US-Börse öffnet.

**Betroffen:** `xetra` (komplett), `xetra+us` (Vormittag). `us`-Modus nicht.

## Ziele (aus Lars' Brief, 2026-06-23)

1. **EUR-Pricing durchgängig** — Kurs *und* Level (Wake/SL/TP) in Euro, aus echten
   deutschen Venue-Kursen, nicht aus dem US-Close.
2. **Klarnamen** der Ticker (Firmenname, z. B. „Qualcomm"), nicht nur Kürzel.
3. **Weniger Apewisdom-Abhängigkeit** — Universum stärker aus der Kür selbst
   (RS-/Strong-/Momentum-Screener + Research/Debatte), wie schon angelegt.
4. **Live-Kurs, minütig vom Tick** zu Handelszeiten — eine Datenader, die der
   Monitor-Tick jede Minute (drosselbar) abfragen kann.

## Schlüssel-Erkenntnisse aus dem Machbarkeits-Spike (VPS-Proben 2026-06-23 ✅)

- **Erreichbar ohne neue Infra — bestätigt.** `POST scanner.tradingview.com/germany/scan`
  liefert vom VPS 200 (`totalCount: 38888`). Gleiche Client-Mechanik, nur Markt
  parametrisiert — **kein neues IP-Sperr-Risiko**.
- **Felder bestätigt:** `description` (Klarname), `close` (EUR), `currency`="EUR",
  `exchange` (Venue), `isin` (inkl. US-ISINs). `s` = `VENUE:symbol`,
  `name` = venue-lokaler Code (WKN-artig) → Klarname IMMER aus `description`.
- **ISIN ist server-seitig filterbar (Probe 2a) ✅** —
  `{left:"isin",operation:"in_range",right:[…]}` liefert exakt die passenden
  Venue-Zeilen (QCOM+Unity → 22 Zeilen). → **kein clientseitiger Voll-Scan**, der
  US→DE-Join ist ein gezielter zweiter Request.
- **EMA10/20/50 + RSI im `germany`-Scan vorhanden (Probe 2a) ✅** — als Zahlen je
  Venue. → `trend.ts` läuft unverändert auf der EUR-Quelle. ABER: bei dünnen Venues
  teils `null` (z. B. `XETR:US3` EMA20/50/RSI = null) → Indikatoren nur von der
  gewählten Liquiditäts-Venue lesen.
- **`america`-Scan liefert `isin` (Probe 2b) ✅** — `NASDAQ:QCOM` → `US7475251036`.
  Schritt 1 des Joins steht.
- **Venue-Wahl: TRADEGATE zuerst (korrigiert ggü. Probe 1).** Zwei Befunde aus 2a:
  (a) **GETTEX kam für QCOM/Unity gar nicht vor** — die US-Namen liegen auf
  FWB/XETR/HAM/MUN/LS/LSX/DUS/HAN/**TRADEGATE**, GETTEX führt sie nicht zuverlässig.
  (b) **Viele Venues sind „entartet"**: `high == low == close` (z. B. `HAM:US3`
  23,195/23,195/23,195) = einzelner MM-Print **ohne Intraday-Range**. Unsere
  Stop-Logik (`engine.ts:56-69`) braucht ein neues Tief/Cross → bei `high==low`
  triggert sie nie (dieselbe Stale-Falle in Grün). **Nur Tradegate zeigt echte
  Range** (`TRADEGATE:QCI` H190/L177,82; `TRADEGATE:US3` H24,155/L23,065).
  → **Tradegate primär**, XETR als Fallback. **NICHT GETTEX.**
- **Fee-Modell bleibt „gettex-style".** Gebührenmodell (ADR 0002) und Kurs-Venue
  sind **unabhängig** — wir rechnen gettex-Gebühren und ziehen Tradegate-Kurse.
- **Frische-Heuristik gefunden:** `high == low == close` (bzw. `change == 0`) =
  „Venue quotet den Namen gerade nicht" → Venue verwerfen / Fallback ziehen.
- **Währungs-Gap belegt:** `QCOM` america 207,31 USD vs. germany/Tradegate 181,04
  EUR — verschiedene Zahlenebenen. SL/TP/Wake müssen in EUR gesetzt werden.
- **Mapping über ISIN:** US-Scan → ISIN → `in_range`-gefilterter germany-Scan.
- **Bonus deutsche Retail-Handelszeiten (~08:00–22:00):** live über das **ganze**
  `xetra+us`-Fenster — löst die Staleness nicht nur vormittags.

## Designskizze

### A) Kursquelle pro Markt — `core/tvScanner.ts`
- `scanEndpoint(market)` → `https://scanner.tradingview.com/${market}/scan`
  (`america` | `germany`). Heute hartkodiert `america`.
- `quotes.ts`/`marketData.ts` bekommen einen `market`-Parameter.

### B) Symbol-Auflösung US → deutsche Venue (`core/listingMap.ts`, NEU)
- Eingabe: Liste US-Ticker (aus der Kandidatenliste).
- Schritt 1: US-Scan mit Zusatzspalte `isin` → `{ usTicker → ISIN }` (Probe 2b ✅).
- Schritt 2: **ein** `germany`-Scan, `isin`+`in_range` über alle gesammelten ISINs
  (Probe 2a ✅ — server-seitig, nicht clientseitig). Liefert pro ISIN mehrere
  Venue-Zeilen.
- Schritt 3 — **Venue-Auswahl je ISIN:**
  1. Zeilen ohne echte Range verwerfen (`high == low == close` bzw. `change == 0`,
     EMA/RSI `null`) → entartete MM-Prints raus.
  2. Aus dem Rest **Tradegate bevorzugen**, sonst **XETR**, sonst die Zeile mit der
     größten `high-low`-Spanne.
- Ausgabe: `ResolvedListing { usTicker, deSymbol, isin, name, currency, venue }`.
- **Cache** (DATA_DIR/listings.json), da ISIN↔Listing stabil ist — spart Scans.
  (Venue-Auswahl ist tagesfrisch zu treffen, da „welche Venue quotet gerade" sich
  ändern kann; ISIN↔Symbol-Zuordnung ist der stabile Cache-Teil.)
- Namen **ohne** brauchbare deutsche Venue: aus dem handelbaren Universum **fallen
  lassen** (siehe Währungsmodell) — reduziert zugleich Apewisdom-Mikrocaps (Ziel 3).

### C) Währungsmodell — EUR-Depot (`paper/types.ts`)
- **v1: das Depot ist EUR-denominiert; es werden NUR Namen mit EUR-Listing
  gehandelt.** Dann sind Entry/SL/TP/Wake **und** Quote close/high/low alle in EUR
  → die Engine (`engine.ts`) rechnet **unverändert** weiter (sie ist
  währungs-agnostisch, solange eine Position in einer Währung konsistent ist).
- `TickQuote`/`Position` bekommen optional `currency` (Default "EUR") + die
  Position trägt `name` (Klarname) und `deSymbol`/`isin`.
- **Kein FX nötig** in v1, weil gemischte Währungen vermieden werden — `equity()`
  bliebe sonst falsch (summiert Beträge ohne Umrechnung).

### D) Kür auf EUR-Basis — `scan/index.ts`, `paper/select.ts`
- Vor der Entscheidung: Kandidaten per `listingMap` auf EUR-handelbare reduzieren;
  Mr Ape sieht **EUR-Kurse + Klarnamen** im Kontext und setzt die Level in EUR.
- `placeOrders`-Referenzpreis = EUR-Quote der deutschen Venue.

### E) Monitor-Tick auf EUR-Quelle — `paper/tick.ts`, `tickPipeline.ts`
- `fetchTickQuotes` zieht die **deutschen** EUR-Quotes (per gespeichertem `deSymbol`
  je Position) während der EU-Handelszeit.
- Tick-Intervall: `TICK_INTERVAL_MIN=1` möglich (Timer feuert eh minütlich,
  `resolveTickInterval` drosselt). Tradegate ist ~08:00–22:00 live.

### F) Klarnamen in der Anzeige — `ui/*`, `telegram/*`, `format.ts`
- Position/Order tragen `name`; UI-Karten & Telegram zeigen „Qualcomm (QCI)".

### G) Universum-Rebalance (Ziel 3) — `scan/pipeline.ts`
- Apewisdom optional/abgewertet; Gewicht auf RS-/Strong-/Momentum-Screener
  (große, EUR-gelistete Namen) + Research/Debatte. EUR-Listing-Filter aus (B)
  schneidet Mikrocaps ohnehin weg.

## Bewusst NICHT in v1 (Folge-PRs)
- **FX / gemischte Währungen** (US-only-Namen ohne EUR-Listing parallel handeln).
- Venue-Routing-Feinheiten (Lang & Schwarz, Stuttgart) — v1 nur Tradegate/XETR.
- Spread-/Fill-Realistik der dünnen deutschen Plätze (bleibt optimistisch wie heute).
- Komplett eigenes EU-natives Kandidaten-Universum (separates Vorhaben).

## Offene Punkte
**Bestätigt (Probe 1):** Endpoint + Erreichbarkeit; Felder `name/description/close/
currency/exchange/isin`; US-Namen via ISIN auf mehreren deutschen Venues.

**Bestätigt (Probe 2):** ISIN server-seitig filterbar (2a); EMA/RSI im germany-Scan
vorhanden, an dünnen Venues teils `null` (2a); america-Scan liefert `isin` (2b);
Venue = **Tradegate** (GETTEX führt die Namen nicht; entartete `high==low`-Venues
verworfen); Frische-Heuristik = `high==low==close`/`change==0`.

**Verbleibende Design-Punkte (kein VPS mehr nötig):**
1. Migration bestehender (USD-)Positionen in `portfolio.json` (frisch starten vs.
   umrechnen). → **Empfehlung:** frisch starten (Paper-Depot; saubere EUR-Basis,
   keine Schein-FX-Umrechnung alter Positionen).
2. Venue-Auswahl tagesfrisch vs. Cache (siehe B): ISIN↔Symbol cachen, Venue-Pick
   pro Lauf neu (Liquidität wandert).
3. `xetra`-Session-Fenster ggf. auf deutsche Retail-Zeiten (~08:00–22:00) weiten,
   da Tradegate so lange quotet (heute 09:00–17:30).

## Test-Plan (Vitest, wie gehabt)
- `listingMap`: ISIN-Join, **Tradegate-Bevorzugung**, Fallback XETR, Verwerfen
  entarteter Zeilen (`high==low==close`), Name-ohne-brauchbares-Listing.
- `tvScanner`: `scanEndpoint("germany")`, ISIN-`in_range`-Filter.
- `quotes`/`marketData`: EUR-Spalten, Markt-Parameter.
- `engine`: unverändert grün (Beleg der Währungs-Agnostik).
- Kür-/Tick-Pfad: EUR-Referenz, Klarname-Durchreichung.

## Phasen-Vorschlag
- **Phase 0 (vor Code) ✅ ABGESCHLOSSEN:** VPS-Proben 1+2 — alle Annahmen gehärtet
  (Endpoint, Felder, ISIN-Filter, EMA/RSI, US-ISIN, Venue=Tradegate).
- **Phase 1:** `tvScanner`-Markt + `listingMap` (ISIN-Join, Tradegate-Pick) +
  `currency`/`name` an den Typen.
- **Phase 2:** Kür + Tick auf EUR-Quelle; Klarnamen in UI/Telegram.
- **Phase 3:** Universum-Rebalance + `.env`/Doku/frischer EUR-Depot-Start.
