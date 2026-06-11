# Ape Signal

Scheduled **Claude Code routines** on a VPS that turn
[ape-intel](https://github.com/lmuenet/ape-intel)'s data sources into a
twice-daily, Telegram-delivered trading briefing — all under your own Claude
**subscription** (no LLM API key).

## What it does

- **Pre-open scan** (Mon–Fri 08:45 & 15:15 Europe/Berlin) — market-wide trending
  + relative-strength candidates, each with a `signal / noise / watch` verdict,
  pushed to Telegram.
- **Reddit off-radar crawl** — surfaces hot tickers the ranked lists miss
  (incl. r/wallstreetbetsGER, r/shortsqueeze).
- **On-demand strategy** — reply `/strategie TICKER [profile]` on Telegram for a
  deep single-stock analysis.
- **Paper trading "Mr Ape"** (opt-in, `ENABLE_PAPER_TRADING=1`) — a simulated
  CFD-style depot. After the PreUS scan the LLM picks up to 3 trade candidates;
  a 5-minute monitor tick checks fills/stops deterministically against
  TradingView quotes, and the LLM manager is woken only by fills, breached
  wake-up bands or the close (ADR 0003). Every manager decision is posted to
  Telegram; a daily close summary and an append-only trading journal complete
  the picture (`/journal` to read or talk to it). No real orders, ever.

`ape-intel` is embedded as a git submodule at `vendor/ape-intel` (shared data
fetchers); `claude -p` runs the reasoning locally under your subscription.

## Self-hosting in a few commands

Runs on a **Debian/Ubuntu VPS with systemd**. You bring your own Claude
subscription and API keys.

**Prerequisites**
- Node.js ≥ 20 and `git`.
- **Claude Code CLI installed and logged in** (`claude login`, paste the token)
  **as the same OS user the services run as**. This is the LLM backend; there is
  no API key.
- A Telegram bot + chat id (from [@BotFather](https://t.me/BotFather)).
- Optional: a Finnhub API key (earnings/news) and a Reddit "script" OAuth app.

**Steps** — clone to `/opt/ape-signal` (the systemd units hardcode that path) and
run as root:

```bash
sudo git clone --recurse-submodules https://github.com/lmuenet/ape-signal.git /opt/ape-signal
cd /opt/ape-signal
sudo ./scripts/setup.sh            # installs deps + systemd units; creates /etc/ape-signal.env on first run
sudo nano /etc/ape-signal.env      # fill in your Telegram (and optional) secrets
sudo ./scripts/setup.sh            # re-run: enables the services and validates everything
```

Validate config at any time:

```bash
npm run doctor                       # uses /etc/ape-signal.env or ./.env
npm run doctor -- --send-test        # also posts a visible Telegram test message
```

The scans run as systemd timers; the listener is a long-running service. See
[`systemd/README.md`](systemd/README.md) for the per-unit details.

## Depot UI (optional)

A read-only dashboard for the paper depot — journal, positions with SL/TP and
wake-band overlays, equity curve. Ships as a Docker container that mounts the
data directory read-only; the core keeps running on systemd (see ADR 0004).

```bash
docker build -t ape-signal-ui /opt/ape-signal
docker run -d --name ape-ui --restart unless-stopped \
  -p 8744:8744 \
  -v /opt/ape-signal/data:/data:ro \
  -e UI_USER=ape -e UI_PASS='pick-a-password' \
  ape-signal-ui
```

Open `http://<server>:8744` and log in with `UI_USER`/`UI_PASS`. The UI never
writes — Telegram remains the push channel for fills and manager decisions.
Without Docker: `UI_USER=… UI_PASS=… npm run ui` serves the same dashboard.

## Layout

| Path | Purpose |
|---|---|
| `src/scan/` | Scan pipeline (data → challenge → report) |
| `src/paper/` | Paper trading: depot engine, fill simulation, ticks, journal |
| `src/reddit/` | Reddit OAuth client + ticker extraction |
| `src/telegram/` | Telegram client + long-poll listener |
| `src/ui/` | Read-only depot UI (Docker, basic auth) |
| `src/claude/` | `claude -p` invoker (stdout capture + JSON parse) |
| `src/config/` | Env loading + `doctor` diagnostics |
| `systemd/` | Timer + service unit files |
| `vendor/ape-intel/` | git submodule (shared `lib`) |

## Disclaimer

For personal informational research and decision-making. **Not** financial
advice. Read-only against the broker — no trade execution.
