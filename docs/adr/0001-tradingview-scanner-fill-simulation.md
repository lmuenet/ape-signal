# ADR 0001 — Fill-Simulation über den TradingView-Scanner statt Intraday-Candles

Datum: 2026-06-09 · Status: akzeptiert · Ergänzt durch ADR 0003 (Tick-Fenster
seit dem 5-Minuten-Monitor-Tick kleiner — die Fill-Regel ist fensteragnostisch)
· Amendment 2026-07-02 (Level-Kreuzung + Platzierungs-Baseline, siehe unten)

## Kontext

Das Paper-Trading-Feature (Mr Ape) braucht zweierlei Kursdaten: (a) den Nachweis,
ob eine Limit-/Stop-Order innerhalb eines 30-Minuten-Tick-Fensters erreicht
wurde, und (b) historischen Kontext für Trade-Entscheidungen. Vom VPS
(Datacenter-IP) aus sind die naheliegenden Quellen tot: Yahoo-Chart-API und
StockTwits blocken Datacenter-IPs, Finnhub-Candles sind kostenpflichtig
(dokumentiert in `src/core/marketData.ts`). Der TradingView-Scanner
(`scanner.tradingview.com/america/scan`) ist die einzige bewährte, freie und
vom VPS erreichbare Quelle — liefert aber nur Snapshots (aktueller Kurs,
Tages-High/Low, Perf-/Indikator-Spalten), keine Candle-Historie.

## Entscheidung

1. Der TradingView-Scanner bleibt die einzige Kursquelle; pro Tick werden
   `close`, `change`, `high`, `low` (Tageswerte) gepollt.
2. **Konservative Fill-Regel:** Eine Order gilt als ausgeführt, wenn ihr Niveau
   seit dem letzten Tick *nachweislich* erreicht wurde — entweder hat der
   Schlusskurs das Niveau zwischen zwei Ticks gekreuzt, oder das Tages-High/Low
   hat sich seit dem letzten Tick über das Niveau hinaus bewegt (beim ersten
   Tick des Tages zählt das Tages-High/Low direkt). Fill-Preis ist das
   Order-Niveau. Sind Stop UND Take-Profit im selben Fenster nachweisbar,
   gewinnt der Stop (Worst-Case-Annahme).
3. Historischer Kontext für Entscheidungen kommt aus Scanner-Spalten
   (Perf 1W/1M/3M, Tages-High/Low) statt aus echten Candles.

## Alternativen

- **Alpaca Paper-Trading-API**: echte serverseitige Order-Engine, realistische
  Fills inkl. Spikes — aber externes Konto, Depot läge außerhalb des Repos,
  kein freies CFD-artiges Hebelmodell, US-only-Anmeldung.
- **Twelve Data free tier** (800 Calls/Tag): echte 30min-/Tages-Candles — aber
  weiterer API-Key, Ratenlimit-Handling, VPS-Erreichbarkeit ungetestet.

## Konsequenzen

- Ein Spike innerhalb eines Tick-Fensters, der **kein** neues Tagesextrem setzt
  und bis zum nächsten Tick zurückläuft, wird nicht erkannt → manche Fills
  passieren später oder gar nicht. Für Paper-Swing-Trading akzeptiert.
- Fills sind systematisch leicht *zu konservativ* (nie zu optimistisch) — die
  simulierte Performance unterschätzt eher, als dass sie schönt.
- Außerhalb der Tick-Fenster (über Nacht, Wochenende) füllt nichts; Gaps werden
  beim ersten Tick des Tages über das Tages-High/Low nachgeholt.
- Sollte später Candle-Genauigkeit nötig sein, ist Twelve Data der designierte
  Nachrüstpfad (nur `quotes.ts` tauschen — die Fill-Regel bleibt).

## Amendment 2026-07-02 — Level-Kreuzung + Platzierungs-Baseline

Die ursprüngliche Implementierung kombinierte für Limit-Entries die einseitigen
Nachweise („handelte bei/unter dem Niveau" ODER „bei/über dem Niveau") — davon
ist für JEDES Niveau trivialerweise einer wahr. Folge: Am ersten Tick des Tages
füllte jede Limit-Order, und jedes neue Tages-Extrem füllte alle Limits auf der
Gegenseite des Kurses (Phantom-Fills auf nie gehandelten Niveaus). Zwei
Präzisierungen stellen die intendierte Regel her:

1. **Level-Kreuzung:** Ein Limit-Entry füllt nur, wenn das Niveau nachweislich
   GEHANDELT wurde — ohne Baseline (Order von einem Vortag, erster Tick des
   Tages) muss das Niveau INNERHALB der heutigen Tagesspanne liegen
   (Gap-Nachholen); mit Baseline muss ein Tages-Extrem das Niveau seit der
   Baseline überschritten oder der Schlusskurs es gekreuzt haben.
2. **Platzierungs-Baseline:** Jede Order trägt den Quote-Snapshot ihrer
   Platzierung (`baseline`). Am Erstellungstag zählt nur Evidenz NACH der
   Platzierung — die Kür läuft ~15:00, die deutschen Venues handeln aber seit
   08:00; das Vormittags-Tief darf eine um 15:00 gesetzte Order nie füllen.
   Ab dem Folgetag ist die Baseline verbraucht (Tagesspannen-Regel greift).

Zusätzlich füllen Market-Entries nicht mehr blind zum Tick-Close: ein
kollabierter Einzel-Print (high == low, staler Market-Maker-Kurs dünner
Venues) füllt nicht, und ein Close, der mehr als `GUARDRAILS.maxMarketDrift`
(3 %) vom Platzierungs-Close abgelaufen ist, füllt nicht (Mr Ape entschied auf
einem anderen Kursniveau) — die Order bleibt offen und verfällt spätestens am
Close-Tick.
