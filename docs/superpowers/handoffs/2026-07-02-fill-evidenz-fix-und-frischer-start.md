# Handoff 2026-07-02 — Fill-Evidenz-Fix (PR #12) + frischer EUR-Start deployed

## Was passiert ist

- **Review des Mr-Ape-Flows** (Fokus Datenkorrektheit): Lars' Verdacht „Orders
  schießen los" bestätigt und empirisch verifiziert — die Limit-Fill-Regel
  `touchedDown || touchedUp` war für JEDES Niveau trivialerweise wahr. Am ersten
  Tick des Tages füllte jede Limit-Order; jedes neue Tages-Extrem füllte alle
  Limits auf der Gegenseite (Phantom-Fills auf nie gehandelten Niveaus).
- **PR #12 gemerged** (`0573d06`, Branch `fix/paper-fill-evidence`):
  - **B1** `levelTraded()` ersetzt `touched()`: Fill nur bei nachweislich
    gehandeltem Niveau (Tagesspanne für Orders von Vortagen, sonst echte
    Level-Kreuzung von Extrem oder Close). ADR-0001-Formulierung jetzt korrekt
    implementiert; Stops/TPs/Liquidationen unverändert.
  - **B2** Platzierungs-Baseline: Orders tragen den Quote-Snapshot ihrer
    Platzierung (`EntryOrder.baseline`); am Erstellungstag zählt nur Evidenz
    NACH der Platzierung (Kür ~15:00 vs. Tradegate-Handel seit 08:00 —
    Look-back-Bias behoben). Ab Folgetag Tagesspannen-Regel.
  - **B3** Quote-Validierung beide Pfade: `toQuote` verwirft Zeilen mit
    `close/low <= 0` oder `high < low` (vorher wurden fehlende Zellen zu 0 —
    ein 0-Low hätte jeden Stop gefeuert).
  - **M1/M2** Market-Guards: kein Fill auf kollabiertem Print (`high == low`)
    und kein Fill bei > 3 % Drift vom Platzierungs-Close
    (`GUARDRAILS.maxMarketDrift`); Order wartet, verfällt am Close.
  - **Pauschalgebühr:** jede Ausführung 0,99 € (500er-Freigrenze raus);
    Smartbroker+-Derivate-Anbindung bewusst **verworfen**.
  - Doku: Amendments ADR 0001 + 0002, CONTEXT.md-Fill-Glossar. 547 Tests grün.
- **Frischer EUR-Start deployed** (Runbook aus der EUR-Pricing-Spec befolgt):
  Timer/Listener gestoppt → Depot archiviert nach
  `data/archive/2026-07-02-fill-fix/` (portfolio, journal, ticks, kuer,
  watchlist, health — nichts gelöscht) → `git pull` auf `0573d06` + `npm ci`
  → `ape-ui` neu gebaut und **mit `--network my-lab-net`** neu gestartet
  (UI intern HTTP 200) → alle 4 Timer + Listener wieder aktiv.

## Zustand bei Übergabe

- Server (`root@159.69.202.146`, `/opt/ape-signal`): Kern auf `0573d06`,
  frisches EUR-Depot entsteht beim ersten Lauf (`PAPER_START_BALANCE` 2000).
- Timer: Tick minütlich, PreUS 15:15, PreXetra 08:45, Close 22:00 — alle aktiv.
- Lokal: Branch `fix/paper-fill-evidence` (gemerged, kann weg); lokaler
  `master` ist veraltet. Projekt-`CLAUDE.md` (gitignored) neu angelegt mit
  SSH-/Deploy-Referenz.

## Verifikation (heute fällig)

- [ ] 15:15 PreUS-Lauf: Kür läuft, legt `portfolio.json` (EUR, 2000) an.
- [ ] Erwartung mit neuem Code: **weniger/keine Sofort-Fills** direkt nach der
      Kür; Orders verfallen ggf. regulär am Close. Sofort-Fill am ersten Tick
      nach der Kür wäre jetzt ein Bug-Signal.
- [ ] 22:00 Tagesabschluss auf Telegram (unbedingtes Lebenszeichen).
- [ ] Journal-Log des ersten Ticks wurde wegen SSH-Drossel nicht mehr geprüft —
      bei Gelegenheit: `journalctl -u 'ape-signal-tick@Tick.service' -n 10`.

## Offene Punkte (bewusst nicht umgesetzt)

- **M3:** Stops füllen bei Overnight-Gaps zum Stop-Level statt zum schlechteren
  Open (zu optimistisch, asymmetrisch zur konservativen Philosophie).
- **Gebühr im Prompt:** Mr Ape erfährt in der Kür nichts von den 0,99 €/Leg —
  könnte sie bei kleinen Positionen einpreisen.
- Falls nach dem Fix GAR nichts mehr füllt: Drift-Band (3 %) und Evidenzregel
  gemeinsam nachjustieren.
- Optional: SSH-`ControlMaster` in Lars' `~/.ssh/config` für den VPS
  (Server drosselt viele kurze Verbindungen — Details in CLAUDE.md).

## Stolperfallen (heute gelernt)

- VPS blockt ICMP (Ping kein Erreichbarkeits-Test) und drosselt gehäufte kurze
  SSH-Verbindungen (kex-Timeouts) — SSH-Befehle bündeln, keine Poll-Schleifen.
- Docker-Build auf dem VPS > 5 min: bei SSH-Abbruch stirbt er mit — serverseitig
  per `nohup sh -c '…' > /tmp/log 2>&1 &` starten.
- `ape-ui`-Neustart: vorher `UI_USER`/`UI_PASS`/`UI_PORT` per `docker inspect`
  auslesen und wieder mitgeben; immer `--network my-lab-net`.
