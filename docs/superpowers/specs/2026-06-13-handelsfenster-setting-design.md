# Spec — A2 Handelsfenster-Setting (konfigurierbare Session)

Datum: 2026-06-13 · Status: genehmigt (Brainstorming abgeschlossen)
Backlog: `docs/BACKLOG.md` → A2

## Ziel

Das Handelsfenster, in dem Mr Ape agiert, konfigurierbar machen statt fest
US 15:30–22:00 Europe/Berlin. Eine aktive Session zur Zeit, Presets `us` und
`xetra` als Startpunkt, Einzelwerte überschreibbar. Das Tick-Intervall ist ein
Laufzeit-Wert, der zusätzlich live per Telegram (`/ticker N`) anpassbar ist.

## Entscheidungen (aus dem Brainstorming)

- **Flexibilität (C):** Presets + Override.
- **Genau eine Session zur Zeit (A)** — kein paralleler US+Xetra-Betrieb (das
  wäre ein gemischtes Tickeruniversum und ein eigenes, größeres Vorhaben).
- **Generator (Ansatz 1):** Die Session-Config erzeugt die systemd-Timer.
- **Zeitzone bleibt `Europe/Berlin`** (beide Presets in Berlin-Wall-Clock;
  `store.ts`/`berlinDay`/`berlinStamp` unverändert). Die kleine
  US-Sommerzeit-Verschiebung bei EU/US-DST-Versatz bleibt wie heute unkorrigiert
  (YAGNI).
- **Tick-Intervall vom Timer entkoppelt:** Der Tick-Timer feuert fix **jede
  Minute** im Fenster; das effektive Intervall ist ein **Laufzeit-Wert**
  (Drossel in der Tick-Pipeline), live per `/ticker N` änderbar. Hard-Floor
  1 min, Default 5, Doku-Empfehlung „≥ 5, um TradingView nicht zu belagern".
- **Aus Scope raus → Backlog:** Trending-Scan-Überarbeitung (immer gleiche
  Ticker, geringer Nutzen; Kür + Paper-Trading sind effizienter).

## Scope

**Drin:**
- Session-Config (`SESSION` + Overrides) inkl. Validierung.
- Timer-Generator für die **drei session-getriebenen** Timer (Kür-Scan, Tick,
  Close).
- Laufzeit-Drossel für das Tick-Intervall + Persistenz + `/ticker`-Command.
- Session-neutrale Prompt-Formulierungen + Doctor-Anzeige + Doku.

**Draußen:**
- Paralleler Mehr-Session-Betrieb.
- Konfigurierbare Zeitzone.
- Der Morgen-PreOpen-Scan (08:45) bleibt fix/unangetastet (kommt mit der
  Trending-Überarbeitung dran).
- Trending-Scan-Überarbeitung selbst.

## Architektur

### 1. Config-Modell — `src/config/session.ts`

```ts
export interface SessionConfig {
  open: string;        // "HH:MM" Europe/Berlin
  close: string;       // "HH:MM"
  kuerScan: string;    // "HH:MM" — wann der PreUS-Scan (Kür-Trigger) feuert
  tickIntervalMin: number; // Laufzeit-DEFAULT (nicht Timer-Input)
}
```

- **Presets:**
  - `us` = { open: "15:30", close: "22:00", kuerScan: "15:15", tickIntervalMin: 5 } (heute exakt)
  - `xetra` = { open: "09:00", close: "17:30", kuerScan: "08:45", tickIntervalMin: 5 }
- **Auswahl:** `SESSION=us|xetra` (unset → `us`).
- **Overrides** (env, optional, überschreiben einzelne Preset-Felder):
  `SESSION_OPEN`, `SESSION_CLOSE`, `SESSION_KUER_SCAN`, `TICK_INTERVAL_MIN`.
- **`loadSession(source)`** lädt Preset, legt Overrides drüber, validiert:
  - `open`/`close`/`kuerScan`: striktes `HH:MM` (00:00–23:59).
  - `open < close`; `kuerScan ≤ open`.
  - `tickIntervalMin`: ganze Zahl, 1 ≤ n ≤ 60.
  - Ungültig → `throw` mit klarer Meldung (fail-fast, wie `APE_LANGUAGE`).
- **Unbekannter `SESSION`-Wert** → `throw` (erlaubte Presets nennen).

### 2. Timer-Generator — `src/config/genTimers.ts`

- **Reiner Kern** `buildTimerFiles(session: SessionConfig): Record<string,string>`
  (unit-getestet), liefert Dateiname → Inhalt für:
  - `ape-signal-scan-preus.timer` → `OnCalendar=Mon..Fri *-*-* <kuerScan>:00 Europe/Berlin`,
    `Persistent=true`, `Unit=ape-signal-scan@PreUS.service`.
  - `ape-signal-tick.timer` → **fixes 1-min-Raster** von `open` bis
    `close − 1min`: eine Zeile pro Stunde mit Minutenliste
    (`OnCalendar=Mon..Fri *-*-* HH:00,01,…,59:00 Europe/Berlin`); erste Stunde
    ab `open`-Minute, letzte Stunde bis `close − 1min` getrimmt. Kein
    `Persistent`. `Unit=ape-signal-tick@Tick.service`.
  - `ape-signal-tick-close.timer` → `OnCalendar=Mon..Fri *-*-* <close>:00 Europe/Berlin`,
    `Persistent=true`, `Unit=ape-signal-tick@Close.service`.
- **Thin main** (`npm run gen-timers`): liest Config (env / `/etc/ape-signal.env`
  bzw. `--env-file=`, analog `doctor.ts`), schreibt die drei Dateien nach
  `--out=<dir>` (Default `/etc/systemd/system/`). Danach manuell
  `systemctl daemon-reload`.
- **Repo behält** die heutigen `systemd/*.timer` als **US-Baseline** — ohne
  Generator-Lauf bleibt das Verhalten exakt wie heute.
- **PreOpen-Timer wird nicht erzeugt/angefasst.**

### 3. Laufzeit-Drossel für das Tick-Intervall

- **State-Datei** im Daten-Verzeichnis (z.B. `<dataDir>/tickInterval.json`,
  Form `{ "minutes": 5 }`).
- **Auflösung des effektiven Intervalls** (`resolveTickInterval`):
  State-Datei → sonst `TICK_INTERVAL_MIN` (env) → sonst Preset-Default (5).
  Korrupte/ungültige State-Datei → Fallback + `console.warn` (kein Crash).
- **Drossel in `tickPipeline.ts`:** Vor dem Quote-Abruf prüfen, ob seit dem
  letzten *echten* Tick `≥ interval` Minuten vergangen sind. Wenn nicht (und es
  ist **kein** Close-Tick) → früh aussteigen, **bevor** `fetchQuotes` läuft
  (schont TradingView). Der Close-Tick drosselt nie.
  - Zeitbasis: neues Feld `lastTickAt` im Portfolio (analog `lastManagerCallAt`),
    gesetzt bei jedem nicht-gedrosselten Tick. Fehlt es → nicht drosseln.
- **`interval` wird in `TickDeps` injiziert** (Entry-Point `tick.ts` ruft
  `resolveTickInterval(dir, env)`), damit `tickPipeline` rein/testbar bleibt.

### 4. Telegram `/ticker`-Command

- Parser in `telegram/commands.ts` + Handling im Listener.
- `/ticker <n>`: setzt das Intervall (schreibt State-Datei), Reply
  „⏱️ Tick-Intervall jetzt N min." Wirkt ab dem nächsten Tick.
- `/ticker` ohne Arg: Reply mit aktuellem Intervall.
- **Edge-Cases:** Nicht-Zahl, Dezimalzahl, `< 1`, `> 60`, leer → Fehler-Reply
  („Bitte ganze Zahl 1–60.") ohne Änderung. Whitelist (nur konfigurierter Chat)
  wie bei anderen Commands.
- Schreiben macht nur der Listener; der Tick-Prozess liest nur → kein Konflikt.

### 5. App-Kosmetik & Diagnose

- **`prompts.ts`** session-neutral: „kurz vor US-Open" → „kurz vor
  Handelsstart"; „LETZTER Tick des Tages, US-Close" → „LETZTER Tick des Tages,
  Handelsschluss"; „US-Session läuft" → „Handelssession läuft". Kein Threading
  nötig.
- **`doctor.ts`:** aktives Fenster + Intervall ausweisen (z.B. „Session:
  15:30–22:00, Kür-Scan 15:15, Tick 5min").
- **`isClose` bleibt label-getrieben**; `berlinDay`/Tages-Key unverändert (Open
  und Close liegen bei beiden Presets am selben Berlin-Tag).

## Datenfluss

```
Setup: SESSION + Overrides (+ TICK_INTERVAL_MIN) in /etc/ape-signal.env
  → loadSession() validiert → SessionConfig
    → npm run gen-timers → 3 Timer nach /etc/systemd/system → daemon-reload
  Laufzeit:
    Tick-Timer (jede Minute) → tick.ts: resolveTickInterval(dir, env)
      → tickPipeline drosselt (skip vor fetchQuotes, wenn < interval)
    /ticker N (Telegram) → State-Datei → nächster Tick nutzt N
```

## Fehlerbehandlung

- Ungültige Session-Config (`loadSession`) → Dienst/Generator startet nicht
  (sichtbar beim Setup), nicht erst zur Laufzeit.
- Korrupte Tick-Intervall-State-Datei → Fallback auf Config-Default + Warnung.
- `/ticker` mit Mist-Argument → Fehler-Reply, keine Änderung.

## Tests

- `session.test.ts`: Presets `us`/`xetra`; Overrides einzeln; Validierung
  (HH:MM-Format, `open<close`, `kuerScan≤open`, Intervall-Range; unbekannte
  Session) → wirft.
- `genTimers.test.ts`: `buildTimerFiles(us)` → Tick-Fenster 15:30–21:59 im
  1-min-Raster (erste Stunde ab :30), `kuerScan`-Timer 15:15, Close-Timer 22:00;
  `buildTimerFiles(xetra)` → 09:00–17:29, Kür-Scan 08:45, Close 17:30 (letzte
  Stunde 17 auf :00–:29 getrimmt); korrekte `Persistent`/`Unit`-Zeilen.
- Tick-Drossel: `resolveTickInterval` (State → env → Default; korrupt →
  Fallback); `tickPipeline` steigt bei gedrosseltem Tick **vor** `fetchQuotes`
  aus; Close-Tick drosselt nie; `lastTickAt` wird gesetzt.
- `/ticker`-Parser + Handler inkl. aller Edge-Cases.
- `doctor`-Zeile; `prompts`-Neutralisierung.
- Vorgehen: TDD red-green, ein Commit pro Task.

## Nicht-Ziele / YAGNI

- Kein paralleler Mehr-Session-Betrieb.
- Keine konfigurierbare Zeitzone.
- Keine DST-Versatz-Korrektur für die US-Session.
- Keine Änderung am PreOpen-Scan oder am Trending-Report.

## Deploy-Hinweis

`SESSION` (+ optionale Overrides, `TICK_INTERVAL_MIN`) in `/etc/ape-signal.env`.
Nach Änderung: `npm run gen-timers && systemctl daemon-reload`. Ohne
Generator-Lauf gelten die committeten US-Baseline-Timer. Gehört in den
systemd-Kern (nicht in `ape-ui`).
