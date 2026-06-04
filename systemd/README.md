# systemd deployment

Copy units and enable. Requires Node LTS at `/usr/bin`, repo at `/opt/ape-signal`,
secrets at `/etc/ape-signal.env` (chmod 600), and server timezone = `Europe/Berlin`
(`timedatectl set-timezone Europe/Berlin`).

```bash
cp /opt/ape-signal/systemd/ape-signal-scan@.service /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-scan-preopen.timer /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-scan-preus.timer /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-listener.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ape-signal-scan-preopen.timer ape-signal-scan-preus.timer
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
- The listener is long-running with `Restart=always` (single Telegram poll
  connection per bot token). It persists the `getUpdates` offset to
  `/opt/ape-signal/.telegram-offset` (set via `OFFSET_PATH` in the env file).
- `CLAUDE_CODE_OAUTH_TOKEN` (subscription, from `claude setup-token`) lives in
  `/etc/ape-signal.env`. It is valid ~1 year — renew around day 350. Token expiry
  is silent; the scan's Telegram failure alert is the backstop.
