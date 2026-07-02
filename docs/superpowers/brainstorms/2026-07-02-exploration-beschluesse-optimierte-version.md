# Brainstorm/Beschlüsse 2026-07-02 — Exploration & Plan „optimierte Version"

Ergebnis einer offenen Explorations-Session (nach Fill-Evidenz-Fix PR #12 und
frischem EUR-Start) plus einer Frage-Empfehlung-Antwort-Runde mit Lars. Dieses
Dokument ist die Entscheidungsgrundlage; pro Arbeitspaket folgt der übliche
Workflow (spec → plan → execute).

---

## 0. Verifikation Fill-Fix (heute, bestanden)

Erste frische Kür (PreUS 15:15 → 15:19, Kette nur ~4 min statt der früher
gemessenen ~85 min — Finding B faktisch erledigt):

- `portfolio.json` (EUR) angelegt: Balance 2000 → 960 frei, drei Limit-Orders
  (AMD long 3x @472,50 / META long 2x @523 / MU short 2x @932), alle mit
  `baseline`-Snapshot, Tradegate-Venue, ISIN, TTL, eigenen Wake-Bändern.
- **Keine Sofort-Fills** am ersten Tick (15:20) — vor dem Fix wäre MU sofort
  gefüllt worden (Tageshoch 936,50 lag schon VOR Platzierung über dem Limit
  932; genau das blockt die Platzierungs-Baseline B2 jetzt).
- Watchlist geseedet (TSLA, RDDT). Offen blieb nur der 22:00-Tagesabschluss.

## 1. Explorations-Findings (Kurzfassung)

Voller Befund in der Session; die Essenz:

- **A · Sichtbarkeit:** Kür-Degrade-Alerts, Manager-Ausfälle, fast alle
  Intraday-Stufe-3-Meldungen (`progress`) und alle ⚡-Radar-Setups (`research`)
  sind mit Default-`TELEGRAM_VERBOSITY` stumm — obwohl live
  `ENABLE_INTRADAY_OPPORTUNISM=1` aktiv ist (Orders können still entstehen)
  und Code/ADR 0003 Sichtbarkeit zusagen.
- **B · Doppel-Kür (`SESSION=xetra+us`):** PreXetra- und PreUS-Kür teilen sich
  Tagesbudget (3), Artefakt-Datei (`kuer/<tag>.json`, zweite überschreibt
  erste) und Watchlist (Reseed verwirft `firedKinds` → doppelte Alerts).
- **C · Telegram ohne Retry:** Fills/Tagesabschluss gehen bei Telegram-Ausfall
  endgültig verloren (nur Journal/UI haben sie).
- **D · State-Robustheit:** fehlende `portfolio.json` startet still frisch;
  korrupte `health.json` killt jeden Tick; kein Backup.
- **E · Bug:** `/journal`-Status preist USD-Legacy-Quotes gegen EUR-Depot
  (`listener.ts:75`) → falsche P&L-Anzeige.
- **F · Keine Track-Record-Auswertung** (Win-Rate, Stop/TP-Quote, Quelle) —
  weder für Lars noch für den Decider-Prompt (sieht nur letzte 8 Trades roh).
- **G · UI:** geschlossene Trades unsichtbar (Daten liegen schon am Client),
  Kür-Stati `skipped-limit/-timeout` unbehandelt, Orders ohne TTL/Leiter-Marker.
- **H · Kleinkram:** 0,99-€-Gebühr fehlt im Prompt, `setup.sh` ignoriert
  `SESSION`, `BACKLOG.md` stale (D1/B4 sind umgesetzt), Journal/Ticks wachsen
  unbegrenzt.
- **Plays:** Watchlist wird nur aus Dossier-Resten geseedet (beschlossener
  rsScreener-Anteil nie verdrahtet); Trigger nur EMA10×20-Cross + RSI 70/30
  auf Tages-Indikatoren.

### Vibe-Trading-Vergleich (github.com/HKUDS/Vibe-Trading)

- Deren Fallback-Ketten sind EOD-Candle-Loader; für unseren Fill-Pfad
  (venue-exakt EUR per ISIN) ist ein Fremdquellen-Fallback **bewusst falsch**
  (würde die Phantom-Fill-Klasse wieder einführen). „Kein Kurs = keine Aktion
  + Health-Alert" bleibt die Semantik.
- Bestätigt: Track-Record-/Behavioral-Auswertung als fehlende Schicht,
  „erst messen, dann skalieren" für Play-Familien, unser
  Research/Debatte/Entscheider-Muster, die ISIN-Signalzeile als leichte
  Antwort auf „Moves nachbilden".
- Neue Idee übernommen (zurückgestellt, s. u.): dateibasierter
  `/pause`-Kill-Switch.

### Quellen-Tests vom VPS (2026-07-02)

- **Stooq: verworfen.** Daily-CSV-Endpoint liefert eine
  JavaScript-Proof-of-Work-Wand (Anti-Bot); Umgehung wäre Zirkumvention —
  machen wir nicht. Candle-Historie/EMA 8 bleibt am Proxy-Thema (B1) bzw. an
  den TradingView-Spalten.
- **Tradegate: Kandidat.** `https://www.tradegatebsx.com/refresh.php?isin=…`
  (301-Redirect von tradegate.de) liefert venue-exakt in EUR: bid/ask, last,
  high/low, close, Stückzahl, Umsatz, **executions**. Caveats: inoffiziell
  (Format-Drift-Risiko), gemischte Zahlformate (deutsche Kommas in
  String-Feldern), keine EMA/RSI-Spalten (Trend-Read degradiert sauber).
  Perspektive: `executions` könnte den „kollabierter Print"-Market-Guard
  fundierter machen als die high==low-Heuristik.

## 2. Beschlüsse (Frage-Empfehlung-Antwort-Runde)

| # | Frage | Beschluss |
|---|---|---|
| 1 | Doppel-Kür xetra+us | **Kollisionen fixen:** beide Kürs bleiben; Artefakt pro Tag+Markt (UI zeigt beide), Watchlist mergen statt ersetzen (`firedKinds` erhalten), Budget bleibt bewusst geteilt (3/Tag gesamt). |
| 2 | Stumme Meldungen | **Kategorien schärfen:** Fehler/Degrade/Wake-Hold → `alert`; Intraday-Orderplatzierung → `trade` (eine Order darf nie still passieren); reine Radar-Beobachtungen bleiben `research` (opt-in). |
| 3 | Telegram-Signalformat | **Split trade/research:** Kür & Manager-Notes gesplittet — knappe Signalzeile (Side, Limit/Market, SL/TP, Hebel, Einsatz + %-Equity, Venue, ISIN) als `trade`; These/Journal/Research-Spiegel als `research`. Kein neues Setting. |
| 4 | Fallback-Quellen | **Stooq getestet → verworfen** (JS-Wand). **Tradegate getestet → Evaluierungs-Kandidat** als venue-exakter EUR-Fallback (nur Monitor-Pfad, nicht Scan). Finnhub-Scan-Fallback: nicht gewählt. |
| 5 | Quick Wins | **Nur Korrektheit:** `/journal`-EUR-Fix + 0,99-€-Gebühr in Kür-/Intraday-Prompt. (Robustheit, `/pause`, Track-Record-Statistik: zurückgestellt.) |
| 6 | Play-Hebel | **Watchlist breiter seeden** (rsScreener-Momentum, war 2026-06-18 beschlossen) **+ neue deterministische Trigger** (EMA20-Pullback-Touch, EMA50-Reclaim/-Verlust, Ausbruch Vortages-/52W-Hoch, Volumen-Spike — alles TradingView-Spalten). (Engine-Bausteine, Intraday-Zeitebene: zurückgestellt.) |

## 3. Arbeitspakete „optimierte Version" (vorgeschlagene Reihenfolge)

- **WP1 · Korrektheit (S):** `/journal`-Pfad auf `fetchTickQuotesEur`
  umstellen; Gebühr (COSTS.orderFee) in Entscheider- und Intraday-Prompt
  nennen. Kleinster Umfang, echter Bug — zuerst.
- **WP2 · Telegram (M):** Kategorien schärfen (Beschluss 2) + Signal-Split
  (Beschluss 3) in einem Paket — beide leben in `format.ts`/Notify-Verdrahtung.
  Formatter sind pure Funktionen, gut testbar.
- **WP3 · Doppel-Kür-Koexistenz (M):** `kuerArtifact` pro Tag+Markt (inkl.
  Kür-Ansicht im UI), `seedWatchlist` → Merge-Semantik. Beschluss 1.
- **WP4 · Radar-Ausbau (M):** Watchlist-Seeding aus rsScreener-Listen;
  Volumen-Spalten in `quotes.ts` ergänzen; neue Trigger-Arten in
  `setupRadar.ts` (+ `OPPORTUNISM`-Knobs). Hinweis: Ohne die (zurückgestellte)
  Track-Record-Statistik bleibt die Trigger-Kalibrierung Handarbeit —
  Schwellen konservativ starten.
- **WP5 · Tradegate-Evaluierung (S, optional):** kurzer ADR-Anhang/Spike:
  Parser für das JSON (Komma-Strings!), Abgleich gegen TradingView-Kurse über
  ein paar Tage, erst danach Entscheidung über echte Fallback-Verdrahtung.

## 4. Bewusst zurückgestellt (Backlog)

- Robustheits-Paket (Telegram-Retry/Nachliefern, health.json-Härtung,
  portfolio.json-Warnung + Backup-Rotation) — Finding C/D.
- `/pause`-Kill-Switch (Vibe-Trading-Anleihe) — mit aktiver Stufe 3 weiterhin
  empfohlen, aber nicht gewählt.
- Track-Record-Statistik + Behavioral-Metriken (Finding F).
- Engine-Bausteine (Trailing-Stop, EMA-Wake, Re-Entry, Zeit-/Katalysator-Exit).
- Intraday-Zeitebene (intervall-suffigierte Scanner-Spalten, z. B. `EMA20|60`).
- Finnhub als zweite Scan-Quelle.
- UI-Lücken (geschlossene Trades, Skip-Stati, TTL/Leiter-Marker) und
  `BACKLOG.md`-Pflege (stale Einträge D1/B4).
