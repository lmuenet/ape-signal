# VPS Daily Loop — Design Spec

> **Status: Accepted design, pre-implementation.**
> Implements (and concretises) the parking-lot vision in
> `docs/superpowers/specs/2026-05-29-daily-trading-loop-design.md`. The browser
> extension stays a *collector / frontend*; this spec covers the external
> *analyst* layer that runs on the user's VPS. It introduces no changes to the
> extension's binding v1 scope (PRD/ADRs win on any v1 conflict).

Date: 2026-06-02
Author: lmueller (with Claude Code)

---

## 1. Purpose

A pair of scheduled **Claude Code routines** plus an on-demand conversational
analyst, all running on the user's **VPS** and authenticated against the user's
**Claude subscription** (not the paid API). They turn Ape Intel's data sources
into a daily, mobile-delivered trading briefing and an on-demand single-stock
strategy service.

Three jobs:

1. **Pre-Open Scan & Challenge** — twice daily (08:45 before Xetra, 15:15 before
   US open), a market-wide trending scan with a per-ticker `signal / noise /
   watch` challenge, delivered to Telegram.
2. **Reddit Sentiment Crawl** — finds hot candidates that the ranked Apewisdom
   list misses (incl. subreddits Apewisdom does not cover), feeding the scan.
3. **On-Demand Strategy** — the user replies on Telegram to request a deep
   single-stock analysis / strategy, mirroring the extension's copy-out flow but
   fully automated (Claude runs locally, so it does the copy *and* the paste-back).

## 2. Goals / Non-Goals

**Goals**
- Use the **Claude subscription** via the Claude Code CLI (`claude login`, then
  headless `claude -p`). No paid-API billing.
- Reuse the extension's tested, dependency-injected `src/lib` fetchers in Node.
- Deterministic data gathering (Node) + LLM reasoning only where it adds value
  (Claude). Mirrors the repo philosophy: *extension = collector, routine = analyst*.
- Two scheduled reports + unlimited on-demand requests, all via Telegram.

**Non-Goals**
- No trade execution, no broker write-actions (read-only — consistent with PRD §2).
- No in-extension push notifications or backend (the routine respects that boundary).
- No WhatsApp in v1 (Telegram only; WhatsApp deferred — see §9).
- No crawl4ai in v1 (Reddit OAuth API instead; crawl4ai deferred to phase 2).

## 3. Runtime decision

| Requirement | How met |
|---|---|
| Use subscription, not API billing | Claude Code CLI + `claude login` (OAuth), invoked headless via `claude -p` |
| Always on, no PC dependency | VPS runs 24/7 |
| Reliable scheduling | systemd timers (`OnCalendar`, TZ `Europe/Berlin`) |
| crawl4ai feasible later | local Playwright on the VPS (phase 2) |
| Stable IP for Reddit | VPS IP + Reddit OAuth |
| Reuse repo code | Node imports the pure `src/lib` functions |

**Telegram over WhatsApp:** free Bot API, instant, trivial two-way. WhatsApp
needs Meta Cloud API (business registration, 24h-window rules) or ban-risky
unofficial libs — deferred.

## 4. Architecture (data flow)

```
                    VPS (24/7, Europe/Berlin)
 ┌──────────────────────────────────────────────────────────────┐
 │  systemd-timer 08:45 ─┐                                        │
 │  systemd-timer 15:15 ─┤──► Scan-Pipeline (Node, one-shot)      │
 │                       │      1 ape-intel lib fetchers          │
 │                       │        Apewisdom+Tradestie+StockTwits  │
 │                       │        → TrendingRow[]                  │
 │                       │      2 Reddit crawl (OAuth) → extras    │
 │                       │      3 Finnhub catalysts / earnings     │
 │                       │      4 claude -p → challenge            │
 │                       │        (signal/noise/watch per ticker)  │
 │                       │      5 format → Telegram ───────────────┼──► 📱
 │                                                                │
 │  Telegram-Listener (Node, systemd service, long-running)       │
 │      "/strategie TSLA aggressive swing"                        │
 │       → briefing.ts (barometer+news+earnings+per-source)       │
 │       → claude -p (ADR-0010 export prompt: bull/bear+profile)  │
 │       → parseStrategy() → formatted card ──────────────────────┼──► 📱
 └──────────────────────────────────────────────────────────────┘
```

**How the two routines support each other:** the Reddit crawl (2) surfaces
candidates absent from Apewisdom's ranked list ("other interesting stocks").
Those are merged into the same challenge (4) and get their own
signal/noise/watch verdict. Conversely the Apewisdom list gives crawl hits a
mention-volume cross-check. A shared `snapshot.json` is the interface.

## 5. Components

### A — VPS base setup
- **A1** Node.js LTS + pnpm; `git clone` the repo onto the VPS.
- **A2** Install Claude Code CLI; `claude login` (OAuth → subscription); verify
  `claude -p "hi"` answers headless.
- **A3** systemd timers `08:45` & `15:15` (`OnCalendar`, TZ `Europe/Berlin`) for
  the scan pipeline.
- **A4** systemd **service** (persistent, auto-restart) for the Telegram listener.
- **A5** Secrets in `/etc/ape-signal.env` (chmod 600): `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_CHAT_ID`, `REDDIT_CLIENT_ID/SECRET/USER_AGENT`, `FINNHUB_API_KEY`.
  Claude needs no key (subscription).

### B — Project structure (dedicated private repo + submodule)
- **B1** New **private** repo (working name `ape-signal`). The existing
  `ape-intel` repo is embedded as a **git submodule** (e.g. `vendor/ape-intel`),
  so the server imports `lib/` from a single source of truth without duplication.
  The new repo stays private regardless of `ape-intel`'s visibility.
- **B2** The server imports only the **pure, Node-safe** `lib` functions from the
  submodule (no browser-API code). Pinning the submodule to a commit gives
  reproducible builds; bumping it is an explicit action.
- **B3** Run via `tsx` (no build step). Own `package.json` in `ape-signal`.

### C — Data layer (reused)
- **C1** `fetchApewisdomSnapshot` → ranked trending rows (mentions, 24h trend).
- **C2** Tradestie + StockTwits → per-ticker sentiment; `computeBarometer` /
  `computeTrend` from `barometer.ts`.
- **C3** Finnhub: catalyst-grade news + "earnings today".
- **C4** Output normalised as `TrendingRow[]` (type from `apewisdom-service.ts`).

### D — Routine 1: Pre-Open Scan & Challenge
- **D1** `assembleTrendingBriefing()` (exists) builds the candidate list.
- **D2** `TRENDING_EXPORT_PROMPT` (exists) + briefing → `claude -p`.
- **D3** Response parsed via `parseTrendingChallenge()` (exists) →
  signal/noise/watch + thesis per ticker.
- **D4** Mobile-friendly report formatter for Telegram.

### E — Routine 2: Reddit sentiment crawl
- **E1** Register a Reddit "script app"; obtain OAuth token.
- **E2** Fetch `hot`/`rising`/`top` from `r/wallstreetbets`,
  `r/wallstreetbetsGER`, `r/shortsqueeze` (configurable subreddit list).
- **E3** Ticker extraction ($cashtags + heuristic) + tally + context snippets.
- **E4** Diff against the Apewisdom list → "new / hot other candidates".
- **E5** Writes `snapshot.json` that Routine 1 (D2) reads.

### F — Two-way: on-demand single-stock analysis / strategy
- **F1** Telegram listener (long-poll `getUpdates`); responds **only** to the
  configured `TELEGRAM_CHAT_ID`.
- **F2** Commands: `/scan` (run scan now), `/strategie TICKER
  [conservative|balanced|aggressive] [intraday|swing|position]`,
  `/analyse TICKER`.
- **F3** Builds the single-asset **Briefing** (`briefing.ts`: barometer + news +
  earnings + per-source).
- **F4** `claude -p` with the parameterised export prompt (ADR-0010: bull/bear +
  trading profile).
- **F5** `parseStrategy()` (exists) → formatted strategy card back to Telegram.

### G — Operations & security
- **G1** Per-run logging (file) + Telegram error message on pipeline crash.
- **G2** Rate-limit handling (Apewisdom pagination, Reddit token refresh, Finnhub
  budget).
- **G3** Chat-ID whitelist; no trade execution (read-only).
- **G4** "informational research, not financial advice" footer (already in prompts).

### H — Phase 2 (later, optional)
- Evening Review + **Trade Journal** (from the 2026-05-29 vision).
- crawl4ai as a local crawl enrichment.
- WhatsApp bridge.

## 6. Scheduling

- **08:45 Europe/Berlin** — pre-Xetra report.
- **15:15 Europe/Berlin** — pre-US-open report.
- **On-demand** — any time via Telegram.

## 7. Reused vs. new code

**Reused (extension `src/lib`):** `apewisdom.ts`, `tradestie.ts`,
`stocktwits.ts`, `finnhub.ts`, `barometer.ts`, `trending-briefing.ts`,
`trending-challenge.ts`, `briefing.ts`, `strategy.ts`, `catalyst.ts`,
`coverage.ts`.

**New (in `ape-signal`):** scan pipeline orchestrator, Reddit OAuth client + ticker
extractor, `claude -p` invoker (stdout capture + JSON parse), Telegram client +
listener, report/strategy formatters, systemd unit files, env/secret loading.

## 8. Repository / hosting

**Decision (resolved):** a dedicated **private** repo, working name `ape-signal`,
with the existing `ape-intel` repo embedded as a **git submodule**
(`vendor/ape-intel`). The server imports the pure `lib` functions from the
submodule — single source of truth, no duplication — and stays private
independent of `ape-intel`'s visibility. This keeps the trading workflow and
its overview cleanly separated from the extension while avoiding logic drift.

The VPS clones `ape-signal` with `--recurse-submodules`. Secrets are never
committed — only `/etc/ape-signal.env` on the VPS (chmod 600). Bumping the
submodule pin is an explicit action, giving reproducible builds.

Repo creation requires the GitHub CLI (`gh`), which is **not yet installed** on
this machine — installing `gh` (or creating the repo manually on github.com) is
the first implementation step.

## 9. Open questions / deferred

- Exact subreddit list and ticker-extraction precision (tune with real data).
- Report layout density for mobile (iterate after first live runs).
- Subscription headless fair-use is fine at 2 scheduled runs/day + ad-hoc.
- WhatsApp, crawl4ai, Evening Review/Journal → phase 2.
