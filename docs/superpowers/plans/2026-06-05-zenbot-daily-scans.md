# ZenBot Daily-Bar RS Scans (Strong Daily + Momentum) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two daily-bar relative-strength scans — Strong Daily (trend quality) and Momentum (acceleration) — to the bi-daily briefing as TradingView scanner queries.

**Architecture:** Two new `fetch*` exports in `src/scan/rsScreener.ts` reuse the existing template (`liquidity`, `fetchSpyPerfM`, `mapCandidates`, `COLUMNS`) via a new shared `dualScan` helper. They return the existing `RsResult` shape and render through the existing `renderCandidateBlock` in `pipeline.ts`. All four candidate blocks are trimmed to 5 at the wiring layer.

**Tech Stack:** TypeScript, Node 22, vitest, the free TradingView scanner endpoint (`https://scanner.tradingview.com/america/scan`, POST, no key).

**Spec:** `docs/superpowers/specs/2026-06-05-zenbot-daily-scans-design.md`

**Working directory note (Windows dev box):** the Bash cwd drifts into the submodule. Prefix Bash with `cd /c/Users/lmueller/ape-signal &&` and use `git -C /c/Users/lmueller/ape-signal …`.

---

## File Structure

- **Modify** `src/scan/rsScreener.ts` — add private `dualScan` helper + `fetchStrongDaily` + `fetchMomentum` exports. (~60 lines added.)
- **Modify** `src/scan/rsScreener.test.ts` — add `describe` blocks for the two new scans.
- **Modify** `src/scan/pipeline.ts` — add two `ScanDeps` fields, two title/note constants, two `safeCandidates` fetches, two `renderCandidateBlock` calls.
- **Modify** `src/scan/pipeline.test.ts` — add two render tests + extend the degrade test.
- **Modify** `src/scan/index.ts` — wire the two new deps; add `{ limit: 5 }` to all four candidate call sites.
- **Modify** `src/telegram/listener.ts` — same wiring as `index.ts`.

---

## Task 0: Pre-flight — verify both filters live (no code, no commit)

Project discipline: a too-tight filter silently returns nothing. Confirm each scan's filter returns a sane `totalCount` with realistic rows **before** freezing thresholds into tests. If a filter returns 0 (or a tiny count), loosen the threshold and update the values used in Tasks 1–2 consistently (filter operands, the design doc, and the curl values you eyeball).

- [ ] **Step 1: Verify Strong Daily long filter (MA stack + positive RS)**

Run (assumes SPY 1M ≈ a few %, so RS cutoff `Perf.1M > 3` is a stand-in for `> spyPerfM` just to gauge population):

```bash
cd /c/Users/lmueller/ape-signal && curl -s -X POST https://scanner.tradingview.com/america/scan -H "Content-Type: application/json" -d '{"filter":[{"left":"market_cap_basic","operation":"egreater","right":2000000000},{"left":"average_volume_90d_calc","operation":"egreater","right":500000},{"left":"type","operation":"equal","right":"stock"},{"left":"close","operation":"egreater","right":"SMA20"},{"left":"SMA20","operation":"egreater","right":"SMA50"},{"left":"SMA50","operation":"egreater","right":"SMA200"},{"left":"Perf.1M","operation":"egreater","right":3}],"sort":{"sortBy":"Perf.1M","sortOrder":"desc"},"range":[0,5],"columns":["name","close","change","Perf.W","Perf.1M"]}'
```

Expected: `totalCount` in the tens-to-hundreds, rows are recognizable common stocks in uptrends. If `totalCount` < ~10, the full SMA20>SMA50>SMA200 stack is too tight — drop the `SMA50>SMA200` line and re-run; whatever stack survives becomes the filter used in Task 1 (update Task 1's code + the spec to match).

- [ ] **Step 2: Verify Momentum long filter (strong month + accelerating week)**

```bash
cd /c/Users/lmueller/ape-signal && curl -s -X POST https://scanner.tradingview.com/america/scan -H "Content-Type: application/json" -d '{"filter":[{"left":"market_cap_basic","operation":"egreater","right":2000000000},{"left":"average_volume_90d_calc","operation":"egreater","right":500000},{"left":"type","operation":"equal","right":"stock"},{"left":"Perf.1M","operation":"egreater","right":10},{"left":"Perf.W","operation":"egreater","right":4}],"sort":{"sortBy":"Perf.W","sortOrder":"desc"},"range":[0,5],"columns":["name","close","change","Perf.W","Perf.1M"]}'
```

Expected: `totalCount` ≥ ~10 with rows showing both a strong `Perf.1M` (>10) and a strong `Perf.W` (>4). If near-zero, lower `Perf.1M` to 8 and/or `Perf.W` to 3 and update Task 2's code + spec to the values you settle on.

- [ ] **Step 3: Record the final thresholds** you will hard-code into Tasks 1–2 (write them in this checkbox as a note so the implementer of later tasks uses the verified numbers, not the originals if they changed).

---

## Task 1: `fetchStrongDaily` — trend-quality scan

**Files:**
- Modify: `src/scan/rsScreener.ts`
- Test: `src/scan/rsScreener.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/scan/rsScreener.test.ts` (after the existing `fetchReadyToTrend` describe block). Update the import on line 2 to also import `fetchStrongDaily`:

```ts
// line 2 becomes:
import { fetchRsLongShort, fetchReadyToTrend, fetchStrongDaily, fetchMomentum } from "./rsScreener";
```

```ts
describe("fetchStrongDaily", () => {
  it("returns uptrend longs + downtrend shorts using a moving-average stack + RS", async () => {
    const bodies: string[] = [];
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      bodies.push(body);
      if (body.includes("AMEX:SPY")) return jsonResponse({ data: [{ s: "AMEX:SPY", d: [4.0] }] });
      if (body.includes('"asc"')) return jsonResponse({ data: [{ s: "NYSE:DOWN", d: ["DOWN", 10, -1, -6, -20] }] });
      return jsonResponse({ data: [{ s: "NASDAQ:UPTR", d: ["UPTR", 100, 1.0, 5, 30] }] });
    }) as unknown as typeof fetch;

    const r = await fetchStrongDaily(fetchFn, { limit: 3 });
    expect(r.spyPerfM).toBe(4);
    expect(r.longs[0]).toMatchObject({ ticker: "UPTR", perfM: 30, rsM: 26 });
    expect(r.shorts[0]).toMatchObject({ ticker: "DOWN", perfM: -20, rsM: -24 });

    const candidateBodies = bodies.filter((b) => b.includes("sortBy"));
    expect(candidateBodies.length).toBe(2);
    // long query carries the bullish MA stack: close>SMA20>SMA50>SMA200
    const longBody = candidateBodies.find((b) => b.includes('"desc"'))!;
    expect(longBody).toContain('"SMA20"');
    expect(longBody).toContain('"SMA50"');
    expect(longBody).toContain('"SMA200"');
    expect(longBody).toContain('"egreater"');
    expect(longBody).toContain('"sortBy":"Perf.1M"');
    // common-stock universe applies
    expect(candidateBodies.every((b) => b.includes('"type"') && b.includes('"stock"'))).toBe(true);
  });

  it("throws when SPY's benchmark is missing (shared guard)", async () => {
    const noSpy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("AMEX:SPY")) return jsonResponse({ data: [] });
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;
    await expect(fetchStrongDaily(noSpy)).rejects.toThrow("SPY");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/scan/rsScreener.test.ts -t "fetchStrongDaily"`
Expected: FAIL — `fetchStrongDaily is not a function` / import error.

- [ ] **Step 3: Add the shared `dualScan` helper + `fetchStrongDaily`**

In `src/scan/rsScreener.ts`, add the helper just above `fetchRsLongShort` (after the existing `longShort` helper):

```ts
interface DualScanArgs {
  longFilter: Filter;
  shortFilter: Filter;
  sortBy: string;
  limit: number;
  spyPerfM: number;
}

/** Run a long (desc) + short (asc) pair with DISTINCT filters and a chosen sort field. */
async function dualScan(fetchFn: FetchFn, args: DualScanArgs): Promise<Pick<RsResult, "longs" | "shorts">> {
  const query = (filter: Filter, sortOrder: "desc" | "asc") => ({
    filter,
    sort: { sortBy: args.sortBy, sortOrder },
    range: [0, args.limit],
    columns: COLUMNS,
  });
  const [longs, shorts] = await Promise.all([
    postScan(fetchFn, query(args.longFilter, "desc")),
    postScan(fetchFn, query(args.shortFilter, "asc")),
  ]);
  return { longs: mapCandidates(longs, args.spyPerfM), shorts: mapCandidates(shorts, args.spyPerfM) };
}
```

Then add the exported function at the end of the file (use the MA stack confirmed in Task 0):

```ts
/**
 * "Strong Daily": a clean uptrend in motion — price stacked above its 20/50/200
 * moving averages with positive relative strength vs SPY (1M). Shorts are the
 * full mirror (price below a falling MA stack, negative RS). Mid-cap universe so
 * it surfaces names beyond the mega-cap RS leaderboard. Daily-bar only, so it is
 * meaningful at both the 08:45 and the pre-US-open 15:15 scans.
 */
export async function fetchStrongDaily(fetchFn: FetchFn = fetch, opts: RsOptions = {}): Promise<RsResult> {
  const limit = opts.limit ?? 8;
  const base = liquidity(opts.minMarketCap ?? 2_000_000_000, opts.minAvgVol ?? 500_000);
  const spyPerfM = await fetchSpyPerfM(fetchFn);

  const longFilter: Filter = [
    ...base,
    { left: "close", operation: "egreater", right: "SMA20" },
    { left: "SMA20", operation: "egreater", right: "SMA50" },
    { left: "SMA50", operation: "egreater", right: "SMA200" },
    { left: "Perf.1M", operation: "egreater", right: spyPerfM }, // positive RS vs market
  ];
  const shortFilter: Filter = [
    ...base,
    { left: "close", operation: "eless", right: "SMA20" },
    { left: "SMA20", operation: "eless", right: "SMA50" },
    { left: "SMA50", operation: "eless", right: "SMA200" },
    { left: "Perf.1M", operation: "eless", right: spyPerfM },
  ];

  const { longs, shorts } = await dualScan(fetchFn, { longFilter, shortFilter, sortBy: "Perf.1M", limit, spyPerfM });
  return { longs, shorts, spyPerfM };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/scan/rsScreener.test.ts -t "fetchStrongDaily"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/lmueller/ape-signal && git add src/scan/rsScreener.ts src/scan/rsScreener.test.ts && git commit -m "feat(scan): Strong Daily (trend-quality MA-stack + RS) candidates"
```

---

## Task 2: `fetchMomentum` — acceleration scan

**Files:**
- Modify: `src/scan/rsScreener.ts`
- Test: `src/scan/rsScreener.test.ts`

(The import on line 2 already includes `fetchMomentum` from Task 1, Step 1.)

- [ ] **Step 1: Write the failing test**

Add to `src/scan/rsScreener.test.ts`:

```ts
describe("fetchMomentum", () => {
  it("returns accelerating longs (strong month + week) sorted by Perf.W, shorts mirror", async () => {
    const bodies: string[] = [];
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      bodies.push(body);
      if (body.includes("AMEX:SPY")) return jsonResponse({ data: [{ s: "AMEX:SPY", d: [4.0] }] });
      if (body.includes('"asc"')) return jsonResponse({ data: [{ s: "NYSE:DUMP", d: ["DUMP", 10, -3, -9, -25] }] });
      return jsonResponse({ data: [{ s: "NASDAQ:HOT", d: ["HOT", 100, 4, 12, 35] }] });
    }) as unknown as typeof fetch;

    const r = await fetchMomentum(fetchFn, { limit: 3 });
    expect(r.longs[0]).toMatchObject({ ticker: "HOT", perfW: 12, perfM: 35, rsM: 31 });
    expect(r.shorts[0]).toMatchObject({ ticker: "DUMP", perfW: -9, perfM: -25, rsM: -29 });

    const candidateBodies = bodies.filter((b) => b.includes("sortBy"));
    expect(candidateBodies.length).toBe(2);
    // momentum sorts by the WEEK (the acceleration differentiator), and filters on both windows
    expect(candidateBodies.every((b) => b.includes('"sortBy":"Perf.W"'))).toBe(true);
    expect(candidateBodies.every((b) => b.includes("Perf.1M") && b.includes("Perf.W"))).toBe(true);
    expect(candidateBodies.every((b) => b.includes('"type"') && b.includes('"stock"'))).toBe(true);
  });

  it("throws when SPY's benchmark is missing (shared guard)", async () => {
    const noSpy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("AMEX:SPY")) return jsonResponse({ data: [] });
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;
    await expect(fetchMomentum(noSpy)).rejects.toThrow("SPY");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/scan/rsScreener.test.ts -t "fetchMomentum"`
Expected: FAIL — `fetchMomentum is not a function`.

- [ ] **Step 3: Add `fetchMomentum`**

Append to `src/scan/rsScreener.ts` (use the thresholds confirmed in Task 0):

```ts
/**
 * "Momentum": relative strength that is freshly ACCELERATING — a strong month
 * AND a strong week (recent thrust), the opposite of Ready-to-Trend's
 * consolidation. Ranked by the week (Perf.W) so the freshest movers surface
 * first. Shorts mirror (sharp month + week down). Daily-bar only.
 */
export async function fetchMomentum(fetchFn: FetchFn = fetch, opts: RsOptions = {}): Promise<RsResult> {
  const limit = opts.limit ?? 8;
  const base = liquidity(opts.minMarketCap ?? 2_000_000_000, opts.minAvgVol ?? 500_000);
  const spyPerfM = await fetchSpyPerfM(fetchFn);

  const longFilter: Filter = [
    ...base,
    { left: "Perf.1M", operation: "egreater", right: 10 },       // strong month
    { left: "Perf.1M", operation: "egreater", right: spyPerfM }, // positive RS vs market
    { left: "Perf.W", operation: "egreater", right: 4 },         // accelerating week
  ];
  const shortFilter: Filter = [
    ...base,
    { left: "Perf.1M", operation: "eless", right: -10 },
    { left: "Perf.1M", operation: "eless", right: spyPerfM },
    { left: "Perf.W", operation: "eless", right: -4 },
  ];

  const { longs, shorts } = await dualScan(fetchFn, { longFilter, shortFilter, sortBy: "Perf.W", limit, spyPerfM });
  return { longs, shorts, spyPerfM };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/scan/rsScreener.test.ts -t "fetchMomentum"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/lmueller/ape-signal && git add src/scan/rsScreener.ts src/scan/rsScreener.test.ts && git commit -m "feat(scan): Momentum (accelerating relative strength) candidates"
```

---

## Task 3: Render both blocks in the pipeline

**Files:**
- Modify: `src/scan/pipeline.ts`
- Test: `src/scan/pipeline.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/scan/pipeline.test.ts`, inside the first `describe("runScan", …)` block (after the existing Ready-to-Trend test):

```ts
it("appends a Strong Daily block when fetchStrongDaily is provided", async () => {
  let seen = "";
  await runScan(
    { label: "T", limit: 5 },
    {
      fetchSnapshot: async () =>
        new Map([["AVGO", { rank: 1, mentions: 100, mentions24hAgo: 80 }]]) as ApewisdomSnapshot,
      claudeRunner: async (p) => { seen = p; return ""; },
      send: async () => {},
      fetchStrongDaily: async () => ({
        spyPerfM: 4,
        longs: [{ ticker: "UPTR", close: 100, changePct: 1, perfW: 5, perfM: 30, rsM: 26 }],
        shorts: [],
      }),
    },
  );
  expect(seen).toContain("Strong Daily");
  expect(seen).toContain("UPTR");
});

it("appends a Momentum block when fetchMomentum is provided", async () => {
  let seen = "";
  await runScan(
    { label: "T", limit: 5 },
    {
      fetchSnapshot: async () =>
        new Map([["AVGO", { rank: 1, mentions: 100, mentions24hAgo: 80 }]]) as ApewisdomSnapshot,
      claudeRunner: async (p) => { seen = p; return ""; },
      send: async () => {},
      fetchMomentum: async () => ({
        spyPerfM: 4,
        longs: [{ ticker: "HOT", close: 100, changePct: 4, perfW: 12, perfM: 35, rsM: 31 }],
        shorts: [],
      }),
    },
  );
  expect(seen).toContain("Momentum");
  expect(seen).toContain("HOT");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/scan/pipeline.test.ts -t "Strong Daily"`
Expected: FAIL — `fetchStrongDaily` is not a known `ScanDeps` property (TS error) and/or the block isn't rendered.

- [ ] **Step 3: Extend `ScanDeps` and render the blocks**

In `src/scan/pipeline.ts`:

1. Add two fields to the `ScanDeps` interface (after `fetchReadyToTrend`):

```ts
  fetchStrongDaily?: () => Promise<RsResult>;
  fetchMomentum?: () => Promise<RsResult>;
```

2. Add two title/note constant pairs (after `READY_NOTE`):

```ts
const STRONG_TITLE = "Strong Daily (Trend-Qualitaet: Kurs ueber GD20/50/200 + RS, TradingView)";
const STRONG_NOTE =
  "Saubere Aufwaerts- (long) bzw. Abwaertstrends (short) — Kurs ueber/unter dem GD-Stapel 20/50/200 mit relativer Staerke; KEIN Signal, Setup/Katalysator pruefen.";
const MOMENTUM_TITLE = "Momentum (beschleunigende relative Staerke, TradingView)";
const MOMENTUM_NOTE =
  "Starker Monat UND starke Woche (frischer Schub) — moegliches fruehes Momentum; KEIN Signal, Setup/Katalysator pruefen.";
```

3. Replace the `const [rs, ready] = await Promise.all([...])` block with:

```ts
  const [rs, ready, strong, momentum] = await Promise.all([
    safeCandidates("RS candidates", deps.fetchRsLongShort),
    safeCandidates("ready-to-trend", deps.fetchReadyToTrend),
    safeCandidates("strong-daily", deps.fetchStrongDaily),
    safeCandidates("momentum", deps.fetchMomentum),
  ]);
```

4. In the `payload` array, add two render calls after the Ready-to-Trend one:

```ts
    renderCandidateBlock(READY_TITLE, READY_NOTE, ready),
    renderCandidateBlock(STRONG_TITLE, STRONG_NOTE, strong),
    renderCandidateBlock(MOMENTUM_TITLE, MOMENTUM_NOTE, momentum),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/scan/pipeline.test.ts`
Expected: PASS (all pipeline tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/lmueller/ape-signal && git add src/scan/pipeline.ts src/scan/pipeline.test.ts && git commit -m "feat(scan): render Strong Daily + Momentum candidate blocks"
```

---

## Task 4: Wire the two new scans into the entrypoints + trim all four to 5

**Files:**
- Modify: `src/scan/index.ts`
- Modify: `src/telegram/listener.ts`

(No new test — these are composition-root wiring files with no logic; the unit + pipeline tests above cover behaviour. `npm run typecheck` is the guard.)

- [ ] **Step 1: Update `src/scan/index.ts`**

Change the import on line 7:

```ts
import { fetchRsLongShort, fetchReadyToTrend, fetchStrongDaily, fetchMomentum } from "./rsScreener";
```

Replace the two candidate dep lines (35–36) with four, all trimmed to `{ limit: 5 }`:

```ts
    fetchRsLongShort: () => fetchRsLongShort(fetch, { limit: 5 }),
    fetchReadyToTrend: () => fetchReadyToTrend(fetch, { limit: 5 }),
    fetchStrongDaily: () => fetchStrongDaily(fetch, { limit: 5 }),
    fetchMomentum: () => fetchMomentum(fetch, { limit: 5 }),
```

- [ ] **Step 2: Update `src/telegram/listener.ts`**

Change the import on line 19:

```ts
import { fetchRsLongShort, fetchReadyToTrend, fetchStrongDaily, fetchMomentum } from "../scan/rsScreener";
```

Replace the two candidate dep lines (56–57) with four, all trimmed to `{ limit: 5 }`:

```ts
    fetchRsLongShort: () => fetchRsLongShort(fetch, { limit: 5 }),
    fetchReadyToTrend: () => fetchReadyToTrend(fetch, { limit: 5 }),
    fetchStrongDaily: () => fetchStrongDaily(fetch, { limit: 5 }),
    fetchMomentum: () => fetchMomentum(fetch, { limit: 5 }),
```

- [ ] **Step 3: Typecheck**

Run: `cd /c/Users/lmueller/ape-signal && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/lmueller/ape-signal && git add src/scan/index.ts src/telegram/listener.ts && git commit -m "feat(scan): wire Strong Daily + Momentum; trim all four blocks to 5"
```

---

## Task 5: Full green gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `cd /c/Users/lmueller/ape-signal && npm test`
Expected: all tests pass (the original 111 + the 6 new: 2 Strong Daily, 2 Momentum, 2 pipeline render).

- [ ] **Step 2: Run typecheck**

Run: `cd /c/Users/lmueller/ape-signal && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm clean tree**

Run: `cd /c/Users/lmueller/ape-signal && git status`
Expected: clean (everything committed).

---

## Notes for the implementer

- **Degrade-to-null is free:** `safeCandidates` already wraps each fetch in try/catch and logs, so a TradingView outage for either new scan just omits its block. No extra error handling needed (matches the existing two).
- **No renderer changes:** both scans return the existing `RsResult` shape, so `renderCandidateBlock` renders them unchanged (close, 1M, RS, 1W, today).
- **DRY follow-up (optional, not required):** `fetchReadyToTrend` predates the `dualScan` helper and still inlines its own query/`Promise.all`. Refactoring it onto `dualScan` is safe (its tests guard it) but out of this plan's scope — leave it unless you're already touching that function.
- **Deploy (after merge):** commit to `master` → `git pull` on the VPS → `systemctl restart ape-signal-listener` (the scan one-shots pick up new code automatically).
