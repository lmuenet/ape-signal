# systemd deployment

Copy units and enable. Requires Node LTS at `/usr/bin`, repo at `/opt/ape-signal`,
secrets at `/etc/ape-signal.env` (chmod 600).

**Install dependencies WITH dev deps** — `tsx` (the runtime used by `ExecStart`) is a
devDependency. Use `npm ci` (NOT `npm ci --omit=dev`); a production-only install
omits `tsx` and both services fail to start.

The `OnCalendar` lines carry an explicit `Europe/Berlin` suffix, so the timers fire
at Berlin wall-clock (DST-aware) regardless of the server's system timezone. Setting
`timedatectl set-timezone Europe/Berlin` is still recommended so logs read in local
time, but is no longer required for correct scheduling.

```bash
cp /opt/ape-signal/systemd/ape-signal-scan@.service /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-scan-preopen.timer /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-scan-preus.timer /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-listener.service /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-tick@.service /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-tick.timer /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-tick-close.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ape-signal-scan-preopen.timer ape-signal-scan-preus.timer
systemctl enable --now ape-signal-tick.timer ape-signal-tick-close.timer
systemctl enable --now ape-signal-listener.service
```

Verify:

```bash
systemctl list-timers 'ape-signal-*'        # NEXT times at 08:45 / 15:15 Europe/Berlin
systemctl status ape-signal-listener        # active (running)
journalctl -u ape-signal-listener -f        # [listener] started; offset=...
```

Run one scan immediately (any label):

```bash
systemctl start ape-signal-scan@Manual.service
journalctl -u 'ape-signal-scan@*' -n 20 --no-pager
```

Notes:
- The scan service is a template (`@`); the timers invoke the `PreOpen` / `PreUS`
  instances. `Persistent=true` runs a missed scan after downtime.
- The paper-trading tick service is also a template: `ape-signal-tick.timer` fires
  the `Tick` instance every 5 minutes Mon–Fri 15:30–21:55 Europe/Berlin (the
  deterministic monitor tick, ADR 0003 — the LLM manager runs only on fills,
  breached wake bands or the close), `ape-signal-tick-close.timer` fires the
  `Close` instance at 22:00 (expires day orders, posts the daily summary).
  Both no-op unless `ENABLE_PAPER_TRADING=1` is set in the env file, so
  enabling the timers is safe by default. Regular ticks are not `Persistent`
  (a missed tick is stale; the next is ≤5 min away); the close tick is.
- The listener is long-running with `Restart=always` (single Telegram poll
  connection per bot token). It persists the `getUpdates` offset to
  `/opt/ape-signal/.telegram-offset` (set via `OFFSET_PATH` in the env file).
- `CLAUDE_CODE_OAUTH_TOKEN` (subscription, from `claude setup-token`) lives in
  `/etc/ape-signal.env`. It is valid ~1 year — renew around day 350. Token expiry
  is silent; the scan's Telegram failure alert is the backstop.
- `SESSION` (`us` | `xetra` | `xetra+us`, Default `us`) wählt die aktiven Märkte.
  Single-Market-Modi erlauben Overrides (`SESSION_OPEN`/`SESSION_CLOSE`/
  `SESSION_KUER_SCAN`, `TICK_INTERVAL_MIN`); `xetra+us` nutzt die Preset-Zeiten
  beider Märkte (Fenster 09:00–22:00, Kürs 08:45 + 15:15). Daraus generiert
  `npm run gen-timers` (schreibt nach `/etc/systemd/system`, `--out=<dir>` für
  Tests) → danach `systemctl daemon-reload`: PRO aktivem Markt einen Kür-Timer
  (`ape-signal-scan-preus` und/oder `ape-signal-scan-prexetra`) plus
  `ape-signal-tick` (kombiniertes Fenster) und `ape-signal-tick-close`. Beim
  Moduswechsel zusätzlich die neu erzeugten Kür-Timer aktivieren bzw. alte
  deaktivieren, z. B. `systemctl enable --now ape-signal-scan-prexetra.timer`.
  Ohne Generator-Lauf gelten die committeten US-Baseline-Timer. Der Tick feuert
  jede Minute im Fenster; das effektive Intervall drosselt zur Laufzeit (live per
  Telegram `/ticker N`). Der PreOpen-Scan (08:45) ist nicht session-getrieben.
- **Börsen-Feiertage:** NYSE + Xetra liegen statisch in
  `src/config/marketCalendar.ts` (2026/2027 — jährlich pflegen). Eine
  Pre-Session-Kür wird an einem Feiertag IHRES Marktes übersprungen (Telegram-
  Notiz); der Tick pausiert nur, wenn ALLE aktiven Märkte zu sind. So läuft z. B.
  an Juneteenth (US zu) die Xetra-Kür normal, die US-Kür nicht.
- `APE_LANGUAGE` (optional, `de` | `en`, default `de`) sets the language of ALL
  AI free text (Persona-Journal/Kür/Tick, Scan- und Strategie-Freitexte). It
  belongs in `/etc/ape-signal.env` (read by the systemd core: scan/tick/listener)
  — NOT in the `ape-ui` container, which is a read-only viewer and calls no LLM.
  An unsupported value makes the affected service fail fast at startup; `npm run
  doctor` reports the active language. JSON keys/enums stay English in every
  language.
