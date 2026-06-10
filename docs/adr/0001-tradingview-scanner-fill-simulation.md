# ADR 0001 — Fill-Simulation über den TradingView-Scanner statt Intraday-Candles

Datum: 2026-06-09 · Status: akzeptiert

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
