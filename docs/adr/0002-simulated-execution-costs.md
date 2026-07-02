# ADR 0002 — Simuliertes Kostenmodell: Spread + Ordergebühren

Datum: 2026-06-10 · Status: akzeptiert · Ergänzt ADR 0001
· Amendment 2026-07-02 (Pauschalgebühr statt 500er-Schwelle, siehe unten)

## Kontext

ADR 0001 füllt Orders exakt zum Order-Niveau. Ohne Spread und Gebühren schönt
die simulierte Performance systematisch (Community-Konsens r/algotrading;
Alpha-Arena-Benchmark zeigte, wie Handelskosten LLM-Strategien real drücken).
Referenz-Broker des Betreibers ist Smartbroker+ (gettex): Orders unter 500 €
Volumen kosten 0,99 €, darüber 0 €.

## Entscheidung

1. **Halber Spread (0,1 %)** gegen die Handelsrichtung auf jeder *Market-artigen*
   Ausführung: Market-Entry, Stop-Loss, manueller Close, Liquidation. Limit-artige
   Ausführungen (Limit-Entry, Take-Profit) garantieren ihr Niveau und slippen nicht
   — eine Limit-Order füllt nie schlechter als ihr Limit.
2. **Ordergebühr pro Ausführung** nach Smartbroker+-Schema: Nominalwert
   (Einsatz × Hebel bzw. Units × Exit-Kurs) unter 500 → 0,99; ab 500 → 0.
   Währungen werden nicht umgerechnet (Depot in USD, Schwelle/ Gebühr 1:1).
3. **Transparenz:** `Position.fees` trägt die Entry-Gebühr, `ClosedTrade.fees`
   den Roundtrip (Entry + Exit). Beide Felder sind optional, damit vor-Kosten-
   Depots lesbar bleiben. Gebühren sind keine Margin: der Gesamtverlust eines
   Trades darf den Einsatz um die Gebühren übersteigen (auch bei Liquidation).

## Konsequenzen

- Die simulierte Performance ist konservativer; Default-Startkapital steigt
  auf 2.000, damit 20 %-Positionen (400) nicht ständig in der Gebührenzone
  unter 500 Nominal landen.
- Konstanten in `src/paper/types.ts` (`COSTS`); die Fill-*Erkennung* aus
  ADR 0001 bleibt unverändert, nur der Fill-*Preis* bekommt Kosten.

## Amendment 2026-07-02 — Pauschalgebühr, EUR-Basis

Zwei Aktualisierungen gegenüber dem ursprünglichen Text:

1. **Pauschalgebühr:** Die 500er-Freigrenze entfällt — JEDE Ausführung (Entry-
   und Exit-Leg) kostet 0,99. Bewusst konservativer als reale
   Ab-500-gratis-Schemata: die Simulation soll Kosten nie unterschlagen, und
   die Smartbroker+-Derivate-Anbindung wurde verworfen (Entscheidung
   2026-07-02). `executionFee()` ist damit volumenunabhängig.
2. **EUR-Basis:** Seit ADR 0005 sind Kurse, Einsätze und Gebühren durchgängig
   EUR (der Satz „Depot in USD, Schwelle/Gebühr 1:1" ist obsolet).
