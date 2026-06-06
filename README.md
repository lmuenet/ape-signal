# Ape Signal

Private companion to the [ape-intel](https://github.com/lmuenet/ape-intel)
Firefox extension. A set of **scheduled Claude Code routines** that run on a VPS
under the user's **Claude subscription** and turn Ape Intel's data sources into a
daily, Telegram-delivered trading workflow.

> Design spec: [`docs/2026-06-02-vps-daily-loop-design.md`](docs/2026-06-02-vps-daily-loop-design.md)
> Implementation plan: see `docs/plans/` (added during writing-plans).

## What it does

1. **Pre-Open Scan & Challenge** — twice daily (08:45 before Xetra, 15:15 before
   US open, `Europe/Berlin`): a market-wide trending scan with a per-ticker
   `signal / noise / watch` verdict, pushed to Telegram.
2. **Reddit Sentiment Crawl** — finds hot candidates the ranked Apewisdom list
   misses (incl. r/wallstreetbetsGER, r/shortsqueeze), feeding the scan.
3. **On-Demand Strategy** — reply on Telegram (`/strategie TICKER ...`) for a
   deep single-stock analysis; mirrors ape-intel's copy-out flow, fully
   automated (Claude runs locally, so it does the copy *and* the paste-back).

## Architecture

```
            VPS (24/7, Europe/Berlin)
 systemd timer 08:45 / 15:15 ─► Scan pipeline (Node, one-shot)
   1 ape-intel lib fetchers (Apewisdom + Tradestie + StockTwits)
   2 Reddit crawl (OAuth) → extra candidates
   3 Finnhub catalysts / earnings today
   4 claude -p (subscription) → signal/noise/watch challenge
   5 format → Telegram 📱

 systemd service ─► Telegram listener (long-running)
   "/strategie TSLA aggressive swing"
     → briefing.ts → claude -p (bull/bear + profile) → parseStrategy → 📱
```

Code reuse: `ape-intel` is embedded as a git **submodule** at
`vendor/ape-intel`; the server imports its pure, Node-safe `src/lib` functions
(no browser APIs) — single source of truth, no duplication.

## Layout

| Path | Purpose |
|---|---|
| `src/scan/` | Scan pipeline (data → challenge → report) |
| `src/reddit/` | Reddit OAuth client + ticker extraction |
| `src/telegram/` | Telegram client + long-poll listener |
| `src/claude/` | `claude -p` invoker (stdout capture + JSON parse) |
| `systemd/` | Timer + service unit files |
| `config/` | Subreddit list, runtime config |
| `vendor/ape-intel/` | git submodule (shared `lib`) |
| `docs/` | Design spec + implementation plans |

## Self-hosting in a few commands

Runs on a **Debian/Ubuntu VPS with systemd**. You run your own Claude
subscription and your own API keys.

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

The scans run as systemd timers (Mon–Fri 08:45 & 15:15 Europe/Berlin); the
listener is a long-running service. See [`systemd/README.md`](systemd/README.md)
for the per-unit details.

## Disclaimer

For personal informational research and decision-making. **Not** financial
advice. Read-only against the broker — no trade execution.
