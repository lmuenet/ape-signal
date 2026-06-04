# ape-signal → Analyst-Hub — Roadmap & Design

> **Status: Accepted design (brainstorm outcome 2026-06-04), pre-implementation.**
> Supersedes the Reddit-crawl portions of `docs/2026-06-02-vps-daily-loop-design.md`.
> Reddit off-radar is **dropped** (see §2). This doc re-frames ape-signal from a
> "2× daily briefing" tool into an **event-driven analyst hub** and decomposes the
> work into shippable slices v1–v4.

Date: 2026-06-04
Author: lmueller (with Claude Code)

---

## 1. Where we are

- Merge SHA `2c3d93b` on `master`: OAuth Reddit runner live in code, 55 tests green,
  `tsc` clean, same `CrawlRunner` contract — everything else unchanged.
- VPS (`lm-gateway`) so far only had agent-browser experiments; we are moving away
  from that. **Nothing of the new pipeline runs on the VPS yet.**
- Core philosophy unchanged: **Node/TS gathers data deterministically, Claude
  reasons where it adds value.** LLM runs via the **Claude *subscription* (Claude
  Code CLI `claude -p`), not the paid API.** This constraint is load-bearing — it
  has already eliminated two alternatives (Vibe-Trading, n8n-native AI nodes).

## 2. Decision: Reddit direct-crawl is DROPPED

We spent two checkpoints proving the Reddit data path is dead from the VPS:

- **Reddit OAuth app registration is gated.** Self-serve `prefs/apps` now resets
  with a "Responsible Builder Policy" notice; the legacy Data API requires an
  approval request scoped to *moderation use cases* — which a market scanner is not.
- **Scrapling spike (Checkpoint 5) from the VPS IP → hard `403`.** Both the
  TLS-impersonation `Fetcher` *and* the full stealth browser (`StealthyFetcher`)
  got Reddit's **"whoa there, pardner! — network policy"** block. This is an
  **IP-reputation block on the datacenter IP**, not a fingerprint block — so stealth
  is the wrong tool. Only residential proxies (ongoing €) or an authenticated
  session (ban risk) could beat it.

**Verdict:** Reddit was only ever *optional off-radar enrichment* on top of
Apewisdom (which already aggregates WSB mentions). Paying for proxies or risking a
ban for marginal enrichment — *before the rest of the pipeline is even live* — is a
bad trade. Reddit stays in the code as an **optional, disabled** Phase-2 hook
(`ENABLE_REDDIT_CRAWL=0`); the pipeline relies on Apewisdom + Tradestie + StockTwits
+ Finnhub. Revisiting Reddit later costs only a proxy decision.

## 3. The vision: an event-driven analyst hub

ape-signal becomes a hub with **multiple input types** that all flow through the
**same brain** (existing pipeline + `claude -p`) and out to **Telegram**:

```
EINGÄNGE                                  HIRN                       AUSGANG
⏰ Crons (collect daily context) ─┐
🌐 Webhook /signal ───────────────┼─► ape-signal pipeline ─► claude ─► 📱 Telegram
   (TradingView alerts, etc.)     │      + ContextOfTheDay.md  (verdict)  (original + analysis)
🧮 Own RS/RW scanner ─────────────┤
💬 /strategie, /trade ────────────┘                                 ▲
                                                                    │
              📓 Trade journal (entry / size / exit / P&L) ─────────┘  → feeds context back
```

**Two new primitives** beyond the existing design:

1. **Webhook ingress** — a tiny token-protected `POST /signal` HTTP endpoint on the
   VPS. Takes a forwarded signal, runs it through the analysis, returns
   **original + AI verdict** to Telegram. The existing long-running Telegram-listener
   service can host this endpoint too.
2. **`ContextOfTheDay.md`** — a rolling daily context file the crons (and incoming
   signals) append to; on-demand analyses *read* it so Claude knows what already
   happened today. Cheap, makes every single-stock verdict smarter.

**n8n is NOT needed** as the core. What pulled toward n8n was webhook reactivity —
which the `/signal` endpoint covers natively. n8n remains *optional* as merely one
possible upstream *forwarder* posting into `/signal`; the hub is n8n-independent.

## 4. Signal-source landscape (evaluated 2026-06-04)

| Source | Delivers signals how? | Verdict |
|---|---|---|
| **TradingView** (alerts) | **Native outbound webhook** on Pine-Script alerts | ✅ cleanest "external scanner → webhook"; first real source for v2 |
| **[TradingView-Screener](https://github.com/shner-elmo/TradingView-Screener)** (py lib) | SQL-like query of TV screener data incl. relative strength, **no paid plan** | ✅ makes an *own* RS/RW scanner cheap → v3 |
| **[xang1234/stock-screener](https://github.com/xang1234/stock-screener)** | IBD-style RS across 197 industries, yfinance/Finviz | reference for RS logic |
| ZenBot ($25/mo) | Desktop/in-app alerts only; data is client-rendered (internal JSON could be reversed) | ❌ paywalled, ToS, brittle — no need given TV-Screener |
| TC2000 | No clean public API/webhook for alerts | ❌ dead end |
| zenbot-wrapper (GitHub) | macOS UI-automation, no API/output | ❌ unusable |

**Takeaway:** closed scanners (ZenBot/TC2000/Stockpulse) are built for a human at a
screen, so tapping them needs brittle bridges (email-alert parsing / phone-push
forwarding). **TradingView is the one widely-used retail scanner with native
outbound webhooks**, and **TradingView-Screener makes a paywall-free own scanner
viable** — matching ape-signal's "compute deterministically, let Claude judge" model.

## 5. Reference methodology

The r/RealDayTrading **"From 38% to 81% after 18 months"** 4-part series
(Preparation / Indicators / Alerts / Trading Journal) is the conceptual backbone:
**relative strength/weakness vs SPY** (stock–market–sector alignment), a small
indicator set (EMAs, VWAP, 200-SMA, RS line), alerts on a **curated watchlist**, and
a disciplined **trade journal** as the learning loop. v3 (scanner) and v4 (journal)
implement the computable parts of this.

## 6. Decomposition — shippable slices

Each slice is its own spec → plan → implementation cycle.

### v1 — Briefing live (DO THIS FIRST)
Get the **existing** pipeline running on the VPS, Reddit off.
- **Scope:** Apewisdom + Tradestie + StockTwits + Finnhub → `TrendingRow[]` →
  `claude -p` challenge (signal/noise/watch per ticker) → formatted Telegram report.
  Two systemd timers (08:45 / 15:15 Europe/Berlin). On-demand `/strategie TICKER`
  via the Telegram listener. `ENABLE_REDDIT_CRAWL=0`.
- **State:** ~80% built and tested already — this slice is mostly **VPS setup +
  wiring**, not new feature code.
- **Tasks:** install Node LTS + Claude Code CLI on VPS; `claude login` (subscription)
  and verify `claude -p "hi"`; clone `ape-signal --recurse-submodules`; secrets in
  `/etc/ape-signal.env` (chmod 600: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
  `FINNHUB_API_KEY`); systemd timers for the scan; systemd service for the listener;
  one end-to-end live run delivering a report to Telegram.
- **Done when:** a real Telegram briefing arrives at the scheduled time AND
  `/strategie TSLA` returns an analysis on demand.

### v2 — Webhook hub + ContextOfTheDay
- `POST /signal` (token-protected) hosted by the listener service: accept a forwarded
  payload → run analysis → reply to Telegram with **original + verdict**.
- **First real source:** a TradingView alert firing its native webhook at `/signal`.
- Crons write a rolling `ContextOfTheDay.md`; on-demand analyses read it as context.
- **Done when:** a TradingView alert produces a Telegram message containing the
  original alert plus Claude's take, and the daily context file is being populated.

### v3 — Own RS/RW scanner
- Use **TradingView-Screener** (Python lib, no paid plan) to compute
  relative-strength/weakness-vs-SPY candidates; expose results through the same
  `CrawlRunner`-style contract / as a hub source. Python slots in as a subprocess
  (same pattern as the old agent-browser bridge).
- **Done when:** the scanner produces RS/RW candidates that flow into the daily
  briefing without any paywalled/external dependency.

### v4 — Trade-journal loop
- `/trade` Telegram command to log entry / size / exit / P&L; persist it; feed it
  back into `ContextOfTheDay.md` / a learning context the analyses can reference.
- **Done when:** logged trades are stored and visibly inform later context/analysis.

## 7. Constraints & non-goals (carry-over)
- **Subscription, not paid API** for all LLM reasoning (`claude -p`). Any design that
  needs an LLM API key is rejected (this killed Vibe-Trading and n8n-native AI).
- **Reuse the tested TS logic**; don't reimplement it in a visual tool.
- **Read-only**: no trade execution, no broker write-actions.
- Telegram only (no WhatsApp in scope).
- n8n optional, never the core.

## 8. Open questions (deferred, not blocking)
- Exact RS/RW formula + watchlist construction for v3 (tune with real data).
- `/signal` payload schema + auth token rotation for v2.
- Whether Reddit ever returns (only if a proxy budget is approved).
- Mobile report layout density (iterate after first live runs).
- **Datacenter-IP blocks (v2+ proxy decision):** the VPS IP is hard-blocked by
  StockTwits (403) and Tradestie (fetch failed), same class as the dropped Reddit
  crawl. v1/v1.1 degrade these to "no data" gracefully; the barometer for single
  stocks leans on Tradestie+Apewisdom (when reachable) + Claude's own research.
  Restoring StockTwits/Tradestie (and possibly a second price source) would need a
  residential/clean-IP proxy — a budget decision, deferred.
