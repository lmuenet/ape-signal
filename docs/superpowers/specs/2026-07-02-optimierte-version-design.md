# Spec 2026-07-02 — „Optimierte Version" (Beschlüsse der Explorations-Runde)

Setzt die Beschlüsse aus
`docs/superpowers/brainstorms/2026-07-02-exploration-beschluesse-optimierte-version.md`
um. Sechs Slices, jeder einzeln mergebar und getestet; Reihenfolge = Abschnitts-
reihenfolge. Nicht enthalten (bewusst zurückgestellt): Robustheits-Paket,
`/pause`, Track-Record-Statistik, Engine-Bausteine, Intraday-Zeitebene.

---

## Slice 1 — Korrektheit: `/journal` in EUR + Gebühr im Prompt

**Bug:** Der Telegram-`/journal`-Status preist EUR-Positionen mit US-Kursen
(`listener.ts:75` injiziert das Legacy-`fetchTickQuotes`; ADR 0005 nicht
nachgezogen) → falsche P&L-Anzeige.

- `journalCommand.ts`: `JournalDeps.fetchQuotes` nimmt `QuoteHolding[]` statt
  `string[]`; der Status baut die Holdings via `toHoldings(portfolio.positions)`
  (Orders haben keinen P&L — Positionen reichen für den Status).
- `listener.ts`: verdrahtet `fetchTickQuotesEur` (wie `tick.ts:71`).

**Gebühr:** `COSTS.orderFee` (0,99 €) wird gebucht, aber kein Prompt nennt sie
(offener Handoff-Punkt). In `buildDecisionPrompt` und `buildIntradayPrompt`
je eine Regel-Zeile ergänzen: jede Ausführung kostet pauschal 0,99 €
(Ein- und Ausstieg ≈ 2 €/Runde) — bei kleinen Einsätzen einpreisen. Wert aus
`COSTS` interpolieren, nicht hart codieren.

## Slice 2 — UI: Order-Karten vollständig

**Befund (Lars + Sweep):** Der Orders-Block im UI zeigt weder Einsatz noch
Gültigkeit noch Leiter-Marker (`app.js:229-234`), obwohl `/api/state` alles
liefert. Telegram-`orderLine` (format.ts:45-50) ist der Maßstab.

- `app.js` Orders-Loop: Zeile um `Einsatz €X`, `gültig bis {expiresOn ?? day}`
  und `Leiter-Rung` (wenn `rungGroup` gesetzt) ergänzen.
- Kein Server-Change. Deploy-Hinweis: UI-Container (`docker build`,
  `--network my-lab-net`), nicht Host-`npm ci`.

## Slice 3 — Telegram-Kategorien schärfen (Beschluss 2)

Zusage „wird garantiert sichtbar" gilt künftig auch mit Default-Verbosity
(`trade,digest,alert`):

| Stelle | heute | neu |
|---|---|---|
| Kür-Degrade (Research/Debatte Limit/Timeout), `select.ts:93` | progress | **alert** |
| Manager-Call-Ausfall (inkl. Band-Riss-Kontext), `tickPipeline.ts:225` | progress | **alert** |
| Intraday: Kurse fehlen / „nicht entschieden (Limit/Timeout/Fehler)", `intraday.ts:83,87,127` | progress | **alert** |
| Intraday: „kein Trade" / „nur Limit erlaubt" (benigne Ausgänge, journaliert) | progress | progress (bleibt) |
| Intraday: „Order abgelehnt (Guardrail)", `intraday.ts:156` | progress | **trade** (Trade-Lebenszyklus) |
| Intraday: Orderplatzierung, `intraday.ts:164` | trade | trade (bleibt) |
| ⚡-Radar-Setups, `radar.ts:52` | research | research (bleibt, Beschluss) |
| Start-Ping/Slow-Pings | progress | progress (bleibt) |

Wake-Hold (Band gerissen, Mr Ape hält) wandert in Slice 4 auf `alert` —
dort wird die Manager-Nachricht ohnehin neu geschnitten.

## Slice 4 — Signal-Split (Beschluss 3)

Ziel-Format im Chat (Default-Verbosity): Order eröffnet → Position geöffnet →
TP/SL → Anpassung — ohne Begründungsprosa. Begründungen wandern in die
`research`-Kategorie (mit `TELEGRAM_VERBOSITY=all` wieder sichtbar); Journal/UI
behalten ohnehin alles. Formatter bleiben pure Funktionen in `format.ts`.

**Kür (`select.ts`):** statt einer `formatKuer`-Nachricht zwei Sends:
- **Signal (`trade`):** Header `🦍 Mr Ape — Kür {Tag}[ · {Markt}]`; pro Order
  drei Zeilen: `🟢 LONG AMD — Limit 472,50 €` / `SL 451 · TP 515 · 3x ·
  Einsatz 380 € (19 %)` / `Tradegate · US0079031078 · gültig bis 2026-07-03`
  (+ `Leiter-Rung`). Venue = Klarteil aus `deSymbol` („TRADEGATE:AMD" →
  „Tradegate"); Prozent = stake/Equity zur Platzierung (Equity wird dem
  Formatter übergeben). 0 Orders → „Heute keine neuen Trades …" bleibt Signal.
  Disclaimer-Zeile bleibt am Signal.
- **Story (`research`):** Kür-Journal + Thesen pro Order + Risiko-Check-
  Ablehnungen. Der bestehende Research/Debatte-Spiegel bleibt unverändert
  `research`.

**Manager-Tick (`tickPipeline.ts` + `format.ts`):** `formatManagerNote` wird
aufgeteilt:
- **Signal (`trade`):** nur wenn Anpassungen/Closes passiert sind — Header +
  `🔧`-Zeilen + Close-Events.
- **Story (`research`):** Journal-Notiz, Band-Riss-Kontext, abgelehnte
  Anpassungen.
- **Wake-Hold (`alert`):** Band gerissen und KEINE Aktion → eigene
  Alert-Nachricht (Riss-Zeilen + Halte-Notiz bzw. „hält ohne Begründung") —
  damit endet ein Weckruf auch mit Default-Verbosity nie still (ADR 0003).

**Intraday (`intraday.ts`):** Platzierungs-Send wird gesplittet: Orderzeile
(Signal-Stil wie oben) als `trade`; Journal-/Thesen-Text als `research`.

**Events/Tagesabschluss:** `formatEvent`-Zeilen (Fill/Stop/TP/Liquidation)
sind schon Signal-Stil → unverändert `trade`; Tagesabschluss unverändert
`digest`. ADR-0003-Amendment ergänzen (Wake-Hold-Kanal), CONTEXT.md-Glossar
(Tagesabschluss/Manager-Tick) kurz nachziehen.

## Slice 5 — Doppel-Kür-Koexistenz (Beschluss 1)

Beide Kürs bleiben; geteiltes Budget (3/Tag) bleibt bewusst bestehen.

**Artefakt pro Tag+Markt (`kuerArtifact.ts`):**
- `KuerArtifact.market?: string` (z. B. `xetra`/`us`); Dateiname
  `${day}-${market}.json`, ohne Markt weiterhin `${day}.json`
  (Alt-Dateien bleiben lesbar).
- `listKuerDays` → `listKuerKeys`: Dateistämme, neueste zuerst (Regex
  `^\d{4}-\d{2}-\d{2}(-[a-z]+)?$`); `loadKuerArtifact(dir, key)`.
- `server.ts /api/kuer?day=` akzeptiert den erweiterten Key;
  `/api/kuer/days` liefert Keys. `app.js`: Dropdown zeigt Keys; außerdem
  werden die Stati `skipped-limit`/`skipped-timeout` gerendert (heute nur
  `skipped-unreadable` — Limit-Tage zeigen sonst eine leere Begründung).
- `runKuer` bekommt `market` über `KuerOptions` (Aufrufer `scan/index.ts`
  kennt es aus `marketForScanLabel`); Markt erscheint auch im
  Kür-Signal-Header (Slice 4).

**Watchlist mergen statt ersetzen (`watchlist.ts` + `select.ts`):**
- Neu `mergeWatchlist(existing, day, entries)`: gleicher Tag → bestehende
  Einträge (samt `firedKinds`) bleiben, neue Ticker werden ergänzt,
  `lastQuotes` bleibt erhalten; anderer/kein Tag → frischer Seed
  (heutiges `seedWatchlist`-Verhalten).
- `KuerDeps.loadWatchlist?: () => WatchlistState | null` (Wiring in
  `scan/index.ts`); `trySeedWatchlist` nutzt merge. Ticker, die inzwischen
  gehalten/beordert sind, filtert weiterhin der Radar zur Laufzeit.

## Slice 6 — Radar-Ausbau (Beschluss 6)

**Neue Scanner-Spalten** (beide Quote-Pfade: `quotes.ts` US + Germany sowie
der Radar-/Kür-Pfad in `eurPricing.ts`): `volume`,
`average_volume_10d_calc`, `price_52_week_high`, `price_52_week_low` →
`TickQuote.volume? / avgVolume10d? / high52w? / low52w?` (optNum-Guard:
fehlende Zellen bleiben `undefined`, nie 0). Fehlen die Spalten auf einem
Venue, bleiben die neuen Trigger dort einfach stumm — gleiche Degradation
wie EMA/RSI heute.

**Neue Trigger-Arten (`setupRadar.ts`, je einmal pro Tag/Ticker via
`firedKinds`):**
- `ema20-pullback-long`: Aufwärtstrend (close > ema20, ema10 ≥ ema20) UND
  Tagestief ≤ ema20 — der Rücksetzer an die EMA20, den der Kür-Prompt als
  Limit-Zone empfiehlt. Spiegelbildlich `ema20-pullback-short`.
- `ema50-reclaim` / `ema50-loss`: Close kreuzt EMA50 von unten/oben
  (prev→now, wie `emaCross`).
- `high52w-breakout` / `low52w-breakdown`: Close überschreitet das
  52-Wochen-Hoch des VORHERIGEN Snapshots (bzw. unterschreitet das Tief) —
  die prev-Referenz macht es zur echten Kreuzung, auch wenn die Spalte den
  heutigen Extremwert schon enthält.
- `volume-spike`: Verhältnis volume/avgVolume10d kreuzt den Faktor
  `OPPORTUNISM.volumeSpikeFactor` (Default 2, „tune from live data") von
  unten. Untertags akkumuliertes Volumen macht den Trigger konservativ
  (feuert eher spät) — bewusst okay.
- `SetupThresholds` um `volumeSpikeFactor` erweitern; Labels in `KIND_LABEL`.

**Watchlist-Seeding aus den Screenern (Masterplan-Beschluss 2026-06-18):**
- `runScan` gibt zusätzlich zu `challenge` die Screener-Kandidaten zurück
  (neues Rückgabe-Interface `ScanResult { challenge, screenerCandidates }`;
  Kandidaten aus Momentum + Ready-to-Trend, long UND short, Note z. B.
  „Momentum-Screener (long)"). Aufrufer anpassen (`scan/index.ts`,
  `listener.ts` ignoriert das Ergebnis).
- `KuerOptions.screenerCandidates?: Array<{ticker, note}>`;
  `trySeedWatchlist` hängt sie hinter die Dossier-Reste. **Cap: max. 10
  Einträge gesamt** (Dossier-Reste zuerst) — begrenzt Radar-Quote-Last und
  Alert-Volumen.

## Tests & Abnahme

- Bestehende Suite bleibt grün (547 Tests); jeder Slice bringt eigene Tests
  (Formatter-Snapshots, Trigger-Kreuzungen, Merge-Semantik, Artefakt-Keys,
  EUR-`/journal`).
- Manuelle Abnahme nach Deploy: `/journal` zeigt EUR-P&L; Kür-Post kommt als
  Signal+Story-Paar; Order-Karten im UI zeigen Einsatz/Gültigkeit; nach der
  nächsten Doppel-Kür existieren zwei Artefakte; Radar meldet neue
  Trigger-Arten (research) bzw. öffnet gegated (Stufe 3).
- Deploy: Kern via `git pull && npm ci` (Timer stoppen), UI-Container neu
  bauen (immer `--network my-lab-net`).
