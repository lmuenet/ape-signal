# Design — Replicate ZenBot daily-bar RS scans (Strong Daily + Momentum)

Date: 2026-06-05
Status: Approved (brainstorming) → ready for implementation plan
Repo: `ape-signal` (branch `master`)

## Goal

Extend the bi-daily briefing with two more relative-strength scan archetypes
inspired by ZenBotScanner / the Real Day Trading method, expressed as
TradingView scanner queries. We are capturing the **intent** of ZenBot's scans,
not byte-replicating their proprietary indicators (RS = "% move vs SPY";
ZenTrend is undocumented).

## Scoping decisions (made during brainstorming)

1. **Intraday scans are dropped.** Both scan slots fire *before* the US open
   (08:45 Berlin = pre-market; 15:15 Berlin = 15 min before the 15:30 open), so
   any scan keyed off the live session — Price Pops, Big Move Up, the live Gap
   scans, intraday RS, High Relative Volume — is blind at our scan times. We only
   replicate **daily-bar / multi-day** scans.
2. **Two new archetypes** beyond what we already have (Established-RS via
   `fetchRsLongShort`, Coiled/Ready-to-Trend via `fetchReadyToTrend`):
   - **Strong Daily** — trend quality (clean uptrend above moving averages + RS).
   - **Momentum** — acceleration (RS freshly heating up: strong week).
   Earnings Soon, ZenTrend, and all intraday scans are explicitly out of scope.
3. **Briefing crowding** — trim **all four** long/short blocks (RS,
   Ready-to-Trend, Strong Daily, Momentum) to a limit of **5** candidates each
   (down from 8) so the briefing stays scannable.

## Live-verified TradingView facts (curl, 2026-06-05)

- Fields exist and return numbers: `SMA20`, `SMA50`, `SMA200`, `EMA20`,
  `relative_volume_10d_calc`, `Recommend.All`.
- **Column-to-column comparison works** in the filter: `{left:"close",
  operation:"egreater", right:"SMA50"}` returned 274 valid large-cap rows, every
  `close` actually above its `SMA50`. So the moving-average stack can be enforced
  **server-side** — no client-side filtering needed.
- Known wart (pre-existing, out of scope): preferred shares (e.g. `APO/PA`,
  `HPE/PC`) pass `type=stock`. The existing two scans already have this; we do
  not address it here.

## Architecture

Both scans reuse the existing template in `src/scan/rsScreener.ts` wholesale:
`liquidity()`, `fetchSpyPerfM()`, `mapCandidates()` (already computes `rsM`), the
shared `COLUMNS` array, and `renderCandidateBlock` in `pipeline.ts`. Each new
scan is just a **filter-builder + a new exported `fetch*`** returning the
existing `RsResult` shape. No new types, no renderer changes, no new columns.

### `fetchStrongDaily(fetchFn, opts)` — trend quality

Mid-cap universe (default `minMarketCap` $2B, `minAvgVol` 500k) so it surfaces
names outside the mega-cap RS leaderboard.

Long filter:
- liquidity base (`market_cap_basic`, `average_volume_90d_calc`, `type=stock`)
- MA stack (server-side): `close > SMA20`, `SMA20 > SMA50`, `SMA50 > SMA200`
- positive RS: `Perf.1M > spyPerfM` (benchmark injected, as today)
- sort `Perf.1M` desc

Short = full mirror: `close < SMA20`, `SMA20 < SMA50`, `SMA50 < SMA200`,
`Perf.1M < spyPerfM`, sort `Perf.1M` asc.

### `fetchMomentum(fetchFn, opts)` — acceleration

Mid-cap universe (default $2B / 500k). Catches RS freshly heating up — the
opposite of Ready-to-Trend's consolidation.

Long filter:
- liquidity base
- strong month + positive RS: `Perf.1M > 10` **and** `Perf.1M > spyPerfM`
- accelerating week: `Perf.W > 4`
- **sort `Perf.W` desc** ← key differentiator from Established-RS (sorted by 1M)

Short = mirror: `Perf.1M < -10`, `Perf.W < -4`, sort `Perf.W` asc.

> Thresholds (MA stack tightness, `Perf.1M`/`Perf.W` cutoffs) will be
> **re-verified live with curl during implementation** — a too-tight filter
> silently returns nothing, so each scan's `totalCount` and sample rows get
> eyeballed before the test is frozen, exactly as was done for `type=stock` and
> the Ready-to-Trend ranges.

### Wiring

- `src/scan/pipeline.ts`: add `fetchStrongDaily` / `fetchMomentum` to `ScanDeps`,
  fetch each via the existing `safeCandidates(...)` (failure → null → block
  skipped), render two more `renderCandidateBlock(title, note, rs)` sections with
  German titles/notes consistent with the existing two.
- `src/scan/index.ts` and `src/telegram/listener.ts`: wire the two new deps as
  `() => fetchStrongDaily(fetch, { limit: 5 })` etc., and add `{ limit: 5 }` to
  the existing `fetchRsLongShort` / `fetchReadyToTrend` call sites to apply the
  crowding trim to all four.

## Testing (TDD)

Mirror the existing `rsScreener` tests: unit tests with a stub `fetchFn` that
asserts the **filter shape** (MA-stack operands, RS/Perf thresholds, sort field
and order, `limit`/`range`) and that `mapCandidates` maps cells → `RsCandidate`
with correct `rsM`. A pipeline test asserts the two new blocks render when deps
return data and are skipped when a dep throws (degrade-to-null). `npm test` +
`npm run typecheck` must stay green.

## Constraints honoured

- No LLM API key — unchanged; these are pure TradingView fetches.
- `vendor/ape-intel` untouched — all changes in `ape-signal/src`.
- TradingView scanner only (free, no key, VPS-reachable).
- Outputs labelled as mechanical candidates / not signals, like the existing
  sections.

## Out of scope

Intraday scans, Earnings Soon, ZenTrend, the preferred-share `type=stock` wart,
a US-market-hours scan slot, and any live ZenBot scraping.
