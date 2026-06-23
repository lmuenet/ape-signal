# ADR 0005 — EUR-Pricing über eine deutsche Live-Kursquelle

Datum: 2026-06-23 · Status: akzeptiert · Ergänzt ADR 0001, ändert die Währungsannahme aus ADR 0002

## Kontext

Die einzige Preisquelle war der TradingView-`america/scan` (US-Listings, USD) —
für Kür-Level *und* Tick-Fills/Stops. Während des Xetra-Fensters (09:00–15:30
Berlin) ist die US-Börse zu; der Scanner liefert dann den **US-Schlusskurs vom
Vortag**. Es gab keine Frische-Prüfung. Folge (real beobachtet, QCOM): Entry und
SL wurden auf eingefrorenen Vortagsdaten gesetzt, der Monitor sah den realen
Drop nicht, der Stop konnte nicht auslösen — die Position hing offen, bis die
US-Börse öffnete. Zusätzlich verglich man USD-Zahlen mit dem realen EUR-Kurs
(QCOM ~207 USD vs. ~181 EUR), was Level bedeutungslos macht.

Ein VPS-Probe-Spike (2026-06-23) bestätigte: `scanner.tradingview.com/germany/scan`
ist vom VPS erreichbar, liefert EUR-Kurse mit `description` (Klarname) und `isin`,
ist per `isin in_range` server-seitig filterbar, und trägt EMA/RSI. US-Namen
liegen über ihre ISIN auf mehreren deutschen Venues — mit **echter Intraday-Range
nur auf Tradegate**; andere Plätze (HAM/MUN/LS/…) kollabieren oft auf einen
einzelnen Market-Maker-Print (`high==low==close`), auf dem die Stop-Logik nichts
erkennt. Tradegate handelt zudem ~08:00–22:00 → live über das ganze Handelsfenster.

## Entscheidung

1. **Deutsche EUR-Quelle statt US-Close.** `tvScanner` ist pro Markt
   parametrisiert (`america|germany`). Preise/Level laufen in **EUR**.
2. **Venue = Tradegate** (Fallback XETR), aufgelöst per **ISIN** als US↔DE-Brücke
   (`core/listingMap.ts`): US-Ticker → ISIN (`america`) → deutsche Venue
   (`germany`, `isin in_range`). Entartete `high==low`-Zeilen werden verworfen;
   der Klarname kommt aus `description`. **Selektion/Ranking bleibt auf den
   US-Screenern** (Momentum in % ist währungs-agnostisch) — nur die absoluten
   Level wandern auf EUR.
3. **Konsistente Venue-Bindung.** Eine Position wird auf der **Venue gepricet, auf
   der sie eröffnet wurde** (gespeichertes `deSymbol`); der Monitor-Tick re-resolved
   nicht (`fetchTickQuotesEur` matcht exakt). Kandidaten/Watchlist-Ticker werden
   frisch aufgelöst (`resolveAndFetchEur`). Alle vier Kurspfade (Kür, Monitor-Tick,
   Intraday, Setup-Radar) nutzen EUR.
4. **`ListingRef`** (`deSymbol/isin/name/currency`, alle optional) reist von der
   Decision über Order und Position bis in den ClosedTrade. Die Engine bleibt
   **währungs-agnostisch** — sie rechnet unverändert, solange eine Position in
   einer Währung konsistent ist.
5. **v1: nur EUR-gelistete Namen, kein FX.** Namen ohne brauchbare deutsche Notiz
   fallen aus dem handelbaren Universum (unterstützt zugleich „weniger Apewisdom").
   Gemischte Währungen / FX sind explizit ein Folge-PR.

## Konsequenzen

- **Depot-Währung ist EUR** (ändert die USD-Annahme aus ADR 0002; das
  „gettex-style" Gebührenmodell bleibt — Gebühr und Kurs-Venue sind unabhängig).
- **Deploy-Sperre — frischer EUR-Start ist Pflicht.** Ein bestehendes
  `portfolio.json` mit Legacy-USD-Positionen **ohne `isin`/`deSymbol`** wird vom
  EUR-Fetcher nicht mehr gepricet → „Monitor blind". Vor dem ersten Tick mit dem
  neuen Code muss das Depot zurückgesetzt werden (Runbook im Design-Spec,
  `docs/superpowers/specs/2026-06-23-eur-pricing-deutsche-kursquelle-design.md`).
- **Doppelter `germany`-Scan** auf den Nicht-Hot-Pfaden (Auflösung + voller Quote)
  — bewusst in Kauf genommen für saubere Trennung Identität/Preis; der Monitor-Tick
  (Hot Path, minütlich) bleibt ein einziger Scan ohne Re-Resolve.
- **Bewusst offen (Folge-PRs):** FX/gemischte Währungen, EUR-Anzeige (Klarname +
  €) in Telegram/UI, eigenes EU-natives Kandidaten-Universum.
