# Session-Modi (xetra | us | xetra+us) + Börsen-Feiertage

**Datum:** 2026-06-23 · **Branch:** `feat/session-modes-and-holidays` (auf `origin/master`)
**Status:** umgesetzt, 475 Tests grün, typecheck clean

## Problem

1. Die Session war **single-market** (`us` ODER `xetra`). Ziel: an einem Tag
   **beide** Märkte handeln — eine Kür vor Xetra-Open **und** eine vor US-Open,
   mit dem opportunistischen Mini-Kür-/Tick-Lauf durchgehend dazwischen.
2. Die Timer feuerten stumpf `Mon..Fri` **ohne Feiertags-Wissen**. An
   Juneteenth (2026-06-19: US zu, Xetra offen) lief die US-Kür ins Leere und
   verwirrte den Entscheider.

## Lösung

### Markt-Modell — `src/config/session.ts`
- `MARKETS` = `xetra` + `us`, je `{ open, close, kuerScan, scanLabel, display }`.
- `SESSION` ∈ `{ us, xetra, xetra+us }` → `activeMarkets()` (chronologisch sortiert).
- `loadSession()` bleibt **rückwärtskompatibel**: liefert das **kombinierte**
  Fenster (Vereinigung); Single-Market-Modi liefern exakt die alten Werte +
  Overrides. `xetra+us`: Fenster **09:00–22:00**, Kürs **08:45 + 15:15**.
- `marketForScanLabel("PreUS"|"PreXetra")` → Markt; `marketDisplay()`.

### Timer — `src/config/genTimers.ts`
- **Pro aktivem Markt** ein Pre-Session-Kür-Timer (`PreXetra` / `PreUS`) am `kuerScan`.
- Ein **kombinierter** Tick übers Vereinigungsfenster + Close am spätesten Close.
- `xetra+us` → 4 Timer; `us`/`xetra` → 3 (`preus` bzw. `prexetra`).

### Feiertage — `src/config/marketCalendar.ts` (NEU)
- **Statische** NYSE- + Xetra-Tabellen 2026/2027 (jährlich pflegen — Kommentar im Code).
- `marketIsOpen(market, date)`: Wochenende **+** Feiertag (Europe/Berlin).
- **Scan** (`scan/index.ts`): `Pre<Markt>`-Lauf an dessen Feiertag → komplett
  übersprungen (eine Telegram-Notiz). Nicht-Markt-Labels (PreOpen/Manual) laufen normal.
- **Tick** (`paper/tick.ts`): pausiert nur, wenn **ALLE** aktiven Märkte zu sind.
- Kür-Trigger generalisiert von `LABEL === "PreUS"` auf `marketForScanLabel(LABEL)`.

### Diagnose & Doku
- `doctor` zeigt aktive Märkte + Fenster + „heute geschlossen"-Hinweis.
- `.env.example` + `systemd/README.md`: `xetra+us`, Migration, Feiertagsverhalten.

## Bewusst NICHT in v1 (Folge-PRs)
- Intraday-Tick/Opportunismus **pro Markt** im Mischfenster gaten (z. B. US-Teil
  15:30–22:00 an US-Feiertag still). v1 gated nur die Kürs + den Ganztag.
- Per-Markt Zeit-Overrides in `xetra+us` (nutzt Presets).
- Halbe Handelstage (early closes) — als „offen" behandelt.

## Migration auf dem Server
1. `SESSION=xetra+us` in `/etc/ape-signal.env`.
2. `npm run gen-timers && systemctl daemon-reload`.
3. Neuen Kür-Timer aktivieren: `systemctl enable --now ape-signal-scan-prexetra.timer`
   (der `ape-signal-scan-preus.timer` bleibt aktiv).

## Tests
- `marketCalendar.test.ts`: Juneteenth, Labour Day, Wochenende, Normaltag, Tabellen.
- `session.test.ts`: us/xetra/xetra+us, kombiniertes Fenster, Label-Mapping.
- `genTimers.test.ts`: `xetra+us` = 4 Timer, zwei Kürs, Vereinigungsfenster.
- Gesamt: **475 Tests grün**, `tsc --noEmit` clean.
