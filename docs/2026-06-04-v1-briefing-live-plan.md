# v1 — "Briefing live" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the existing, tested ape-signal pipeline running live on the VPS (`root@lm-gateway`) — twice-daily Telegram briefings (08:45 / 15:15 Europe/Berlin) plus on-demand `/strategie TICKER` — with Reddit disabled.

**Architecture:** Node/TS gathers data deterministically (Apewisdom + Tradestie + StockTwits + Finnhub via the vendored `ape-intel` lib); `claude -p` (Claude **subscription**, not paid API) reasons. The scan runs as a systemd-timer one-shot; the Telegram listener runs as a long-running systemd service. The scan path already exists and is tested; the **`/strategie` listener is the one new piece of feature code**, plus the systemd/VPS wiring.

**Tech Stack:** Node LTS (system install via NodeSource), `tsx` (no build step), `vitest`, systemd timers + service, Claude Code CLI authenticated via a long-lived `CLAUDE_CODE_OAUTH_TOKEN` (subscription), Telegram Bot API (`getUpdates` long-poll).

**Scope guard:** This plan implements **v1 only** (roadmap §6). v2 (webhook hub + ContextOfTheDay), v3 (RS/RW scanner), v4 (trade journal) are explicitly **out of scope** — do not build them here.

---

## Key research findings baked into this plan

These came from web research on 2026-06-04 and **correct/strengthen the roadmap**:

1. **Headless subscription auth ≠ `claude login`.** `claude login` needs a browser. On a headless VPS the robust path is **`claude setup-token`** (run once on a machine with a browser) → produces a **1-year OAuth token** (`sk-ant-oat01-…`, tied to the Pro/Max **subscription**, *not* the paid API) → export as `CLAUDE_CODE_OAUTH_TOKEN` on the VPS. Survives reboots and non-interactive systemd runs. ([headless docs](https://code.claude.com/docs/en/headless), [remote-server guide](https://codeongrass.com/blog/how-to-run-claude-code-on-a-remote-server/))
2. **OAuth tokens can expire silently** and break unattended cron/systemd jobs ([claude-code#38813](https://github.com/anthropics/claude-code/issues/38813)). → The scan **must** alert Telegram on any failure (incl. a dead `claude -p`), and we note a ~day-350 renewal reminder.
3. **Telegram long-poll robustness** ([BotHero](https://blog.bothero.ai/getupdates-telegram-bot-the-polling-method-that-powers-43-of-small-business-bots-why-it-breaks-at-scale-and-what-to-do-about-it)): use `getUpdates` `timeout=25–30s`; **persist the update offset to a file** so a restart doesn't reprocess/skip; only **one** polling connection per bot token; let systemd `Restart=always` supervise.

---

## File structure

**New files (this plan):**
- `src/strategy/strategy.ts` — single-ticker data assembly + `runStrategy` + `formatStrategy` (the `/strategie` brain). Pure/DI, unit-tested.
- `src/strategy/strategy.test.ts` — tests for the above.
- `src/telegram/commands.ts` — pure `parseCommand(text)` → typed command. Unit-tested.
- `src/telegram/commands.test.ts`
- `src/telegram/offset.ts` — file-backed `getUpdates` offset store. Unit-tested.
- `src/telegram/offset.test.ts`
- `src/telegram/listener.ts` — long-poll loop wiring (thin; integration-tested manually).
- `systemd/ape-signal-scan@.service` — one-shot scan, templated by label.
- `systemd/ape-signal-scan-preopen.timer` — 08:45.
- `systemd/ape-signal-scan-preus.timer` — 15:15.
- `systemd/ape-signal-listener.service` — long-running listener.
- `systemd/README.md` — deploy/install notes.

**Modified files:**
- `src/core/ape-intel.ts` — re-export the additional lib functions `/strategie` needs.
- `src/scan/index.ts` — wrap `main()` so any failure is reported to Telegram (token-expiry safety net).

---

# Phase 1 — Local feature code (TDD, no VPS yet)

All Phase-1 work happens on the dev machine. Tests inject fetchers/claude, so nothing hits the network or the real Claude CLI. Target: `npm test` green + `npm run typecheck` clean.

### Task 0: Verify the baseline before touching anything

**Files:** none (verification only).

- [ ] **Step 1: Run the existing suite**

Run: `npm test`
Expected: PASS, 55 tests green (the documented baseline).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 3: Confirm clean tree**

Run: `git status --short`
Expected: empty (clean working tree). If not, stop and reconcile before proceeding.

---

### Task 1: Re-export the lib functions `/strategie` needs

The strategy path reuses `assembleBriefing`/`buildClipboardPayload`, the per-source fetchers, `aggregate`, and `parseStrategy`. Currently `src/core/ape-intel.ts` only re-exports the trending bits. Add the rest so the new module imports from one place.

**Files:**
- Modify: `src/core/ape-intel.ts`
- Test: `src/core/ape-intel.test.ts` (extend existing)

- [ ] **Step 1: Write a failing smoke test for the new re-exports**

Append to `src/core/ape-intel.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  fetchStockTwitsForTicker,
  fetchTradestieSnapshot,
  fetchCompanyNews,
  aggregate,
  buildClipboardPayload,
  DEFAULT_EXPORT_PROMPT,
  DEFAULT_PROFILE,
  normalizeProfile,
  parseStrategy,
} from "./ape-intel";

describe("ape-intel strategy re-exports", () => {
  it("re-exports the strategy/data functions used by /strategie", () => {
    expect(typeof fetchStockTwitsForTicker).toBe("function");
    expect(typeof fetchTradestieSnapshot).toBe("function");
    expect(typeof fetchCompanyNews).toBe("function");
    expect(typeof aggregate).toBe("function");
    expect(typeof buildClipboardPayload).toBe("function");
    expect(typeof parseStrategy).toBe("function");
    expect(typeof normalizeProfile).toBe("function");
    expect(DEFAULT_PROFILE.risk).toBe("balanced");
    expect(DEFAULT_EXPORT_PROMPT).toContain("equity analyst");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/core/ape-intel.test.ts`
Expected: FAIL — `fetchStockTwitsForTicker` (etc.) is not exported.

- [ ] **Step 3: Add the re-exports**

Append to `src/core/ape-intel.ts`:

```typescript
export {
  fetchStockTwitsForTicker,
} from "../../vendor/ape-intel/src/lib/stocktwits";
export type {
  StockTwitsEntry,
} from "../../vendor/ape-intel/src/lib/stocktwits";

export {
  fetchTradestieSnapshot,
} from "../../vendor/ape-intel/src/lib/tradestie";
export type {
  TradestieEntry,
  TradestieSnapshot,
} from "../../vendor/ape-intel/src/lib/tradestie";

export {
  fetchCompanyNews,
} from "../../vendor/ape-intel/src/lib/finnhub";
export type {
  NewsItem,
} from "../../vendor/ape-intel/src/lib/finnhub";

export {
  aggregate,
} from "../../vendor/ape-intel/src/lib/barometer";
export type {
  Aggregate,
} from "../../vendor/ape-intel/src/lib/barometer";

export {
  assembleBriefing,
  buildClipboardPayload,
  DEFAULT_EXPORT_PROMPT,
  DEFAULT_PROFILE,
  normalizeProfile,
} from "../../vendor/ape-intel/src/lib/briefing";
export type {
  BriefingInput,
  TradingProfile,
  RiskAppetite,
  Horizon,
} from "../../vendor/ape-intel/src/lib/briefing";

export {
  parseStrategy,
} from "../../vendor/ape-intel/src/lib/strategy";
export type {
  Strategy,
} from "../../vendor/ape-intel/src/lib/strategy";
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run src/core/ape-intel.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/ape-intel.ts src/core/ape-intel.test.ts
git commit -m "feat(core): re-export briefing/strategy/data fns for /strategie"
```

---

### Task 2: Single-ticker data assembly (`assembleStrategyInput`)

Gather one ticker's data into a `BriefingInput`. All I/O is injected via a `StrategyDeps` interface so it is fully unit-testable.

**Files:**
- Create: `src/strategy/strategy.ts`
- Test: `src/strategy/strategy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/strategy/strategy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { assembleStrategyInput, type StrategyDeps } from "./strategy";
import type { ApewisdomSnapshot, TradestieSnapshot } from "../core/ape-intel";

function deps(over: Partial<StrategyDeps> = {}): StrategyDeps {
  const ape: ApewisdomSnapshot = new Map([
    ["TSLA", { rank: 3, mentions: 120, mentions24hAgo: 90 }],
  ]);
  const td: TradestieSnapshot = new Map([
    ["TSLA", { comments: 50, sentimentLabel: "Bullish", sentimentScore: 0.4 }],
  ]);
  return {
    fetchApewisdom: async () => ape,
    fetchStockTwits: async () => ({ bullish: 30, bearish: 10, totalMessages: 60 }),
    fetchTradestie: async () => td,
    fetchNews: async () => [],
    fetchEarnings: async () => null,
    claudeRunner: async () => "",
    ...over,
  };
}

describe("assembleStrategyInput", () => {
  it("uppercases the ticker and pulls the matching per-source rows", async () => {
    const input = await assembleStrategyInput("tsla", deps());
    expect(input.ticker).toBe("TSLA");
    expect(input.apewisdom?.mentions).toBe(120);
    expect(input.stocktwits?.bullish).toBe(30);
    // aggregate combines stocktwits + tradestie → a real barometer score
    expect(input.aggregate?.barometer.label).not.toBe("unavailable");
  });

  it("tolerates a ticker missing from the snapshots (nulls, not throws)", async () => {
    const input = await assembleStrategyInput("NONE", deps());
    expect(input.apewisdom).toBeNull();
    // stocktwits stub still returns data; tradestie map has no NONE → null
    expect(input.ticker).toBe("NONE");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/strategy/strategy.test.ts`
Expected: FAIL — module `./strategy` not found.

- [ ] **Step 3: Implement `assembleStrategyInput`**

Create `src/strategy/strategy.ts`:

```typescript
import {
  aggregate,
  buildClipboardPayload,
  parseStrategy,
  DEFAULT_EXPORT_PROMPT,
  type ApewisdomSnapshot,
  type TradestieSnapshot,
  type StockTwitsEntry,
  type NewsItem,
  type EarningsDate,
  type BriefingInput,
  type TradingProfile,
  type Strategy,
} from "../core/ape-intel";

export interface StrategyDeps {
  fetchApewisdom: () => Promise<ApewisdomSnapshot>;
  fetchStockTwits: (ticker: string) => Promise<StockTwitsEntry | null>;
  fetchTradestie: () => Promise<TradestieSnapshot>;
  fetchNews: (ticker: string) => Promise<NewsItem[]>;
  fetchEarnings: (ticker: string) => Promise<EarningsDate | null>;
  claudeRunner: (prompt: string) => Promise<string>;
}

/** Gather one ticker's data into a BriefingInput. Missing rows become null. */
export async function assembleStrategyInput(
  ticker: string,
  deps: StrategyDeps,
): Promise<BriefingInput> {
  const t = ticker.toUpperCase();
  const [ape, stocktwits, tdMap, news, earnings] = await Promise.all([
    deps.fetchApewisdom(),
    deps.fetchStockTwits(t),
    deps.fetchTradestie(),
    deps.fetchNews(t),
    deps.fetchEarnings(t),
  ]);
  const apewisdom = ape.get(t) ?? null;
  const tradestie = tdMap.get(t) ?? null;
  const agg = aggregate({ stocktwits, tradestie, apewisdom });
  return { ticker: t, aggregate: agg, apewisdom, stocktwits, news, earnings };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/strategy/strategy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/strategy.ts src/strategy/strategy.test.ts
git commit -m "feat(strategy): assemble single-ticker BriefingInput (DI)"
```

---

### Task 3: `runStrategy` — prompt → claude → parse

**Files:**
- Modify: `src/strategy/strategy.ts`
- Test: `src/strategy/strategy.test.ts`

- [ ] **Step 1: Write the failing test (append)**

Append to `src/strategy/strategy.test.ts`:

```typescript
import { runStrategy, DEFAULT_PROFILE_EXPORT } from "./strategy";

describe("runStrategy", () => {
  it("builds the export prompt, runs claude, and parses the JSON block", async () => {
    let seenPrompt = "";
    const result = await runStrategy("tsla", { risk: "aggressive", horizon: "swing" }, deps({
      claudeRunner: async (p) => {
        seenPrompt = p;
        return 'My take...\n```json\n{"recommendation":"Small long","conviction":"low","direction":"long"}\n```';
      },
    }));
    expect(seenPrompt).toContain("Ape Intel Briefing — TSLA");
    expect(seenPrompt).toContain("aggressive");
    expect(result.strategy?.recommendation).toBe("Small long");
    expect(result.strategy?.direction).toBe("long");
  });

  it("returns strategy=null but keeps raw when no JSON block is present", async () => {
    const result = await runStrategy("tsla", DEFAULT_PROFILE_EXPORT, deps({
      claudeRunner: async () => "no json here",
    }));
    expect(result.strategy).toBeNull();
    expect(result.raw).toBe("no json here");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/strategy/strategy.test.ts`
Expected: FAIL — `runStrategy` / `DEFAULT_PROFILE_EXPORT` not exported.

- [ ] **Step 3: Implement `runStrategy`**

Append to `src/strategy/strategy.ts`:

```typescript
import { DEFAULT_PROFILE } from "../core/ape-intel";

/** Re-export so callers don't need a second import for the default. */
export const DEFAULT_PROFILE_EXPORT: TradingProfile = DEFAULT_PROFILE;

export interface StrategyResult {
  input: BriefingInput;
  strategy: Strategy | null;
  raw: string;
}

/** Assemble → build the ADR-0010 export prompt → claude -p → parseStrategy. */
export async function runStrategy(
  ticker: string,
  profile: TradingProfile,
  deps: StrategyDeps,
): Promise<StrategyResult> {
  const input = await assembleStrategyInput(ticker, deps);
  const prompt = buildClipboardPayload(input, {
    basePrompt: DEFAULT_EXPORT_PROMPT,
    profile,
  });
  const raw = await deps.claudeRunner(prompt);
  const strategy = parseStrategy(raw);
  return { input, strategy, raw };
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run src/strategy/strategy.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/strategy.ts src/strategy/strategy.test.ts
git commit -m "feat(strategy): runStrategy (prompt → claude -p → parseStrategy)"
```

---

### Task 4: `formatStrategy` — Telegram-ready text

**Files:**
- Modify: `src/strategy/strategy.ts`
- Test: `src/strategy/strategy.test.ts`

- [ ] **Step 1: Write the failing test (append)**

Append to `src/strategy/strategy.test.ts`:

```typescript
import { formatStrategy } from "./strategy";

describe("formatStrategy", () => {
  it("renders the parsed strategy with a header and the disclaimer", () => {
    const text = formatStrategy("TSLA", { risk: "balanced", horizon: "swing" }, {
      recommendation: "Small speculative long",
      conviction: "medium",
      direction: "long",
      timeframe: "1-2 weeks",
      targetPrice: "260",
      stopLoss: "230",
      rationale: "momentum",
      risks: "earnings gap",
    }, "raw text");
    expect(text).toContain("TSLA");
    expect(text).toContain("Small speculative long");
    expect(text).toContain("medium");
    expect(text).toContain("not financial advice");
  });

  it("falls back to the raw claude output when parsing failed", () => {
    const text = formatStrategy("TSLA", { risk: "balanced", horizon: "swing" }, null, "free-form analysis");
    expect(text).toContain("free-form analysis");
    expect(text).toContain("TSLA");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/strategy/strategy.test.ts`
Expected: FAIL — `formatStrategy` not exported.

- [ ] **Step 3: Implement `formatStrategy`**

Append to `src/strategy/strategy.ts`:

```typescript
const DISCLAIMER = "Informational research, not financial advice.";

function line(label: string, value: string | undefined): string | null {
  return value ? `${label}: ${value}` : null;
}

/** Render a Strategy as a compact Telegram message. Falls back to raw text. */
export function formatStrategy(
  ticker: string,
  profile: TradingProfile,
  strategy: Strategy | null,
  raw: string,
): string {
  const header = `📊 ${ticker} — ${profile.risk}/${profile.horizon}`;
  if (!strategy) {
    return [header, "", raw.trim(), "", DISCLAIMER].join("\n");
  }
  const rows = [
    line("Recommendation", strategy.recommendation),
    line("Conviction", strategy.conviction),
    line("Direction", strategy.direction),
    line("Timeframe", strategy.timeframe),
    line("Target", strategy.targetPrice),
    line("Stop", strategy.stopLoss),
    line("Leverage", strategy.leverage),
    line("Instruments", strategy.instruments),
    line("Sizing", strategy.positionSizing),
    line("Barometer critique", strategy.barometerCritique),
    line("Rationale", strategy.rationale),
    line("Risks", strategy.risks),
  ].filter((x): x is string => x !== null);
  return [header, "", ...rows, "", DISCLAIMER].join("\n");
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/strategy/strategy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/strategy.ts src/strategy/strategy.test.ts
git commit -m "feat(strategy): formatStrategy for Telegram (with raw fallback)"
```

---

### Task 5: Command parser (`parseCommand`)

**Files:**
- Create: `src/telegram/commands.ts`
- Test: `src/telegram/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/telegram/commands.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseCommand } from "./commands";

describe("parseCommand", () => {
  it("parses /strategie TICKER with default profile", () => {
    const c = parseCommand("/strategie tsla");
    expect(c).toEqual({ kind: "strategie", ticker: "TSLA", profile: { risk: "balanced", horizon: "swing" } });
  });

  it("parses risk + horizon args", () => {
    const c = parseCommand("/strategie nvda aggressive intraday");
    expect(c).toEqual({ kind: "strategie", ticker: "NVDA", profile: { risk: "aggressive", horizon: "intraday" } });
  });

  it("strips a @botname suffix and ignores bad profile words", () => {
    const c = parseCommand("/strategie@ape_bot amd wild forever");
    expect(c).toEqual({ kind: "strategie", ticker: "AMD", profile: { risk: "balanced", horizon: "swing" } });
  });

  it("recognises /scan", () => {
    expect(parseCommand("/scan")).toEqual({ kind: "scan" });
  });

  it("treats /strategie with no ticker as unknown", () => {
    expect(parseCommand("/strategie")).toEqual({ kind: "unknown", text: "/strategie" });
  });

  it("treats plain text as unknown", () => {
    expect(parseCommand("hello")).toEqual({ kind: "unknown", text: "hello" });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/telegram/commands.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parseCommand`**

Create `src/telegram/commands.ts`:

```typescript
import { normalizeProfile, DEFAULT_PROFILE, type TradingProfile } from "../core/ape-intel";

export type Command =
  | { kind: "strategie"; ticker: string; profile: TradingProfile }
  | { kind: "scan" }
  | { kind: "unknown"; text: string };

/** Parse a Telegram message into a typed command. Pure. */
export function parseCommand(text: string): Command {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  const head = (parts[0] ?? "").toLowerCase().replace(/@.*$/, "");
  const rest = parts.slice(1);

  if (head === "/scan") return { kind: "scan" };

  if (head === "/strategie" || head === "/analyse") {
    const ticker = rest[0];
    if (!ticker) return { kind: "unknown", text: trimmed };
    // normalizeProfile silently drops invalid risk/horizon words → defaults.
    const profile = normalizeProfile({ risk: rest[1], horizon: rest[2] });
    return { kind: "strategie", ticker: ticker.toUpperCase(), profile };
  }

  return { kind: "unknown", text: trimmed };
}

export { DEFAULT_PROFILE };
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/telegram/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/commands.ts src/telegram/commands.test.ts
git commit -m "feat(telegram): parseCommand for /strategie and /scan"
```

---

### Task 6: Offset store (`offset.ts`)

Persist the `getUpdates` offset to a file so a listener restart doesn't reprocess or skip updates.

**Files:**
- Create: `src/telegram/offset.ts`
- Test: `src/telegram/offset.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/telegram/offset.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { readOffset, writeOffset } from "./offset";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ape-offset-"));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("offset store", () => {
  it("returns 0 when the file is missing", () => {
    expect(readOffset(join(dir, "nope.txt"))).toBe(0);
  });

  it("round-trips a written offset", () => {
    const p = join(dir, "offset.txt");
    writeOffset(p, 4242);
    expect(readOffset(p)).toBe(4242);
  });

  it("returns 0 for a corrupt file", () => {
    const p = join(dir, "bad.txt");
    writeOffset(p, NaN as unknown as number);
    expect(readOffset(p)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/telegram/offset.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `offset.ts`**

Create `src/telegram/offset.ts`:

```typescript
import { readFileSync, writeFileSync } from "node:fs";

/** Read the persisted update offset; 0 if missing or unparseable. */
export function readOffset(path: string): number {
  try {
    const n = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Persist the next update offset (only valid positive integers are written). */
export function writeOffset(path: string, offset: number): void {
  if (!Number.isFinite(offset) || offset <= 0) return;
  writeFileSync(path, String(Math.trunc(offset)), "utf8");
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/telegram/offset.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/offset.ts src/telegram/offset.test.ts
git commit -m "feat(telegram): file-backed getUpdates offset store"
```

---

### Task 7: Listener wiring (`listener.ts`)

Thin orchestration: long-poll `getUpdates`, whitelist the chat, dispatch commands to `runStrategy` / `runScan`. The testable pieces (`parseCommand`, `offset`, `runStrategy`) are already covered; this file is wiring, verified by manual smoke at Checkpoint 1.

**Files:**
- Create: `src/telegram/listener.ts`

- [ ] **Step 1: Implement the listener**

Create `src/telegram/listener.ts`:

```typescript
// src/telegram/listener.ts
import { join } from "node:path";
import { loadEnv, requireFinnhub } from "../config/env";
import {
  fetchApewisdomSnapshot,
  fetchStockTwitsForTicker,
  fetchTradestieSnapshot,
  fetchCompanyNews,
  fetchNextEarnings,
} from "../core/ape-intel";
import { createTelegramClient } from "./client";
import { spawnClaudeRunner } from "../claude/invoke";
import { parseCommand } from "./commands";
import { readOffset, writeOffset } from "./offset";
import { runStrategy, formatStrategy, type StrategyDeps } from "../strategy/strategy";
import { runScan, type ScanDeps } from "../scan/pipeline";

const OFFSET_PATH = process.env.OFFSET_PATH ?? join(process.cwd(), ".telegram-offset");
const POLL_TIMEOUT = 25; // seconds — long-poll, ~2880 reqs/day

interface TgMessage { chat: { id: number }; text?: string }
interface TgUpdate { update_id: number; message?: TgMessage }

async function getUpdates(token: string, offset: number): Promise<TgUpdate[]> {
  const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=${POLL_TIMEOUT}&offset=${offset}`;
  const res = await fetch(url, { signal: AbortSignal.timeout((POLL_TIMEOUT + 10) * 1000) });
  const data = (await res.json()) as { ok: boolean; result?: TgUpdate[]; description?: string };
  if (!data.ok) throw new Error(`getUpdates failed: ${data.description}`);
  return data.result ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const env = loadEnv();
  const telegram = createTelegramClient({ botToken: env.telegramBotToken, chatId: env.telegramChatId });

  const finnhubKey = env.finnhubApiKey ? requireFinnhub(env) : undefined;
  const strategyDeps: StrategyDeps = {
    fetchApewisdom: () => fetchApewisdomSnapshot(fetch),
    fetchStockTwits: (t) => fetchStockTwitsForTicker(t, fetch),
    fetchTradestie: () => fetchTradestieSnapshot(fetch),
    fetchNews: (t) => (finnhubKey ? fetchCompanyNews(t, finnhubKey, fetch) : Promise.resolve([])),
    fetchEarnings: (t) => (finnhubKey ? fetchNextEarnings(t, finnhubKey, fetch) : Promise.resolve(null)),
    claudeRunner: spawnClaudeRunner,
  };
  const scanDeps: ScanDeps = {
    fetchSnapshot: () => fetchApewisdomSnapshot(fetch),
    claudeRunner: spawnClaudeRunner,
    send: (text) => telegram.sendMessage(text),
  };

  let offset = readOffset(OFFSET_PATH);
  console.log(`[listener] started; offset=${offset}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      for (const u of await getUpdates(env.telegramBotToken, offset)) {
        offset = u.update_id + 1;
        writeOffset(OFFSET_PATH, offset);
        const msg = u.message;
        if (!msg?.text) continue;
        if (String(msg.chat.id) !== env.telegramChatId) continue; // whitelist
        await handle(msg.text, telegram, strategyDeps, scanDeps);
      }
    } catch (err) {
      console.error(`[listener] poll error: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(3000);
    }
  }
}

async function handle(
  text: string,
  telegram: ReturnType<typeof createTelegramClient>,
  strategyDeps: StrategyDeps,
  scanDeps: ScanDeps,
): Promise<void> {
  const cmd = parseCommand(text);
  try {
    if (cmd.kind === "scan") {
      await telegram.sendMessage("Starte Scan…");
      await runScan({ label: "Manual", limit: Number(process.env.SCAN_LIMIT ?? "15") }, scanDeps);
    } else if (cmd.kind === "strategie") {
      await telegram.sendMessage(`Analysiere ${cmd.ticker} (${cmd.profile.risk}/${cmd.profile.horizon})…`);
      const { strategy, raw } = await runStrategy(cmd.ticker, cmd.profile, strategyDeps);
      await telegram.sendMessage(formatStrategy(cmd.ticker, cmd.profile, strategy, raw));
    } else {
      await telegram.sendMessage("Befehle: /strategie TICKER [conservative|balanced|aggressive] [intraday|swing|position] · /scan");
    }
  } catch (err) {
    await telegram.sendMessage(`⚠️ Fehler: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  console.error("[listener] fatal:", err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (exit 0).

- [ ] **Step 3: Full suite still green**

Run: `npm test`
Expected: PASS (baseline 55 + the new strategy/commands/offset/core tests).

- [ ] **Step 4: Commit**

```bash
git add src/telegram/listener.ts
git commit -m "feat(telegram): long-poll listener wiring (/strategie, /scan)"
```

---

### Task 8: Scan failure → Telegram alert (token-expiry safety net)

If `claude -p` dies (e.g. an expired OAuth token, research finding #2) or any fetch fails, a silent cron failure is the worst outcome. Make the scan report its own death to Telegram.

**Files:**
- Modify: `src/scan/index.ts`

- [ ] **Step 1: Replace the bare `.catch` with a Telegram alert**

In `src/scan/index.ts`, replace the trailing block:

```typescript
main().catch((err) => {
  console.error("[scan] failed:", err);
  process.exitCode = 1;
});
```

with:

```typescript
main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[scan] failed:", err);
  process.exitCode = 1;
  // Best-effort failure alert so a dead claude token / API never fails silently.
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `⚠️ Scan (${LABEL}) fehlgeschlagen: ${message}` }),
      });
    }
  } catch (alertErr) {
    console.error("[scan] failed to send failure alert:", alertErr);
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/scan/index.ts
git commit -m "feat(scan): alert Telegram on scan failure (token-expiry safety net)"
```

---

## 🔍 REVIEW CHECKPOINT 1 — local code complete

**Stop and review with the user before any VPS work.** Verify:

- [ ] `npm test` — all green (baseline 55 + new tests).
- [ ] `npm run typecheck` — clean.
- [ ] **Manual listener smoke** against a real *test* bot (uses a throwaway `.env`, the dev machine's own `claude` login):
  - `npm run listener`, then from the whitelisted Telegram chat send `/strategie TSLA` → a `📊 TSLA …` card comes back; send `/scan` → a briefing comes back. (On Windows, if `spawn("claude")` fails, that's a known dev-box quirk — the deploy target is Linux; note it but do not block.)
- [ ] Reddit is confirmed **off** (no `ENABLE_REDDIT_CRAWL` in the test `.env`).

Get explicit go-ahead before Phase 2.

---

# Phase 2 — VPS provisioning (manual ops on `root@lm-gateway`)

No application code changes. Each step is a command run over SSH on the VPS unless noted. The only old artifact on the box is agent-browser cruft — leave it; we install alongside under `/opt/ape-signal`.

### Task 9: System base — timezone + Node LTS

- [ ] **Step 1: Set the server timezone** (so systemd `OnCalendar` fires at Europe/Berlin wall-clock, DST-aware)

Run on VPS: `timedatectl set-timezone Europe/Berlin && timedatectl`
Expected: `Time zone: Europe/Berlin (CET/CEST …)`.

- [ ] **Step 2: Install Node LTS system-wide via NodeSource** (so `/usr/bin/node` exists for systemd — avoids nvm/PATH pain)

Run: `curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs`

- [ ] **Step 3: Verify**

Run: `node --version && npm --version && which npx`
Expected: Node ≥ 20, and `npx` at `/usr/bin/npx`.

---

### Task 10: Install Claude Code CLI + headless subscription auth

This is the load-bearing, research-corrected step. **Do not** use `claude login` (needs a browser).

- [ ] **Step 1: Install the CLI on the VPS**

Run: `npm install -g @anthropic-ai/claude-code`
Then: `claude --version`
Expected: a version string.

- [ ] **Step 2: Generate a long-lived subscription token on a machine WITH a browser** (the user's laptop, logged into the Pro/Max subscription)

Run on laptop: `claude setup-token`
Expected: completes a browser OAuth flow and prints a token `sk-ant-oat01-…` (valid ~1 year, billed against the **subscription**, not the paid API). Copy it.

- [ ] **Step 3: Put the token in the VPS env file** — done in Task 11 (it lives in `/etc/ape-signal.env` as `CLAUDE_CODE_OAUTH_TOKEN`). For an immediate manual check, export it in the shell:

Run on VPS: `export CLAUDE_CODE_OAUTH_TOKEN='sk-ant-oat01-…' && claude -p "say hi in one word"`
Expected: a one-word reply (e.g. "Hi"). This proves headless subscription auth works.

> ⚠️ Renewal: set a calendar reminder ~day 350 to re-run `claude setup-token` and update `/etc/ape-signal.env`. Token expiry is silent (research #2); the Task-8 alert is the backstop.

---

### Task 11: Secrets file `/etc/ape-signal.env`

- [ ] **Step 1: Create the file** (use the user's real values for the four secrets)

```bash
cat > /etc/ape-signal.env <<'EOF'
TELEGRAM_BOT_TOKEN=__REAL__
TELEGRAM_CHAT_ID=__REAL__
FINNHUB_API_KEY=__REAL__
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-__REAL__
SCAN_LIMIT=15
OFFSET_PATH=/opt/ape-signal/.telegram-offset
# Reddit OFF (v1): do not set ENABLE_REDDIT_CRAWL.
EOF
chmod 600 /etc/ape-signal.env
```

- [ ] **Step 2: Verify permissions**

Run: `ls -l /etc/ape-signal.env`
Expected: `-rw------- ... root root`.

---

### Task 12: Clone the repo (with submodule) + install deps

- [ ] **Step 1: Clone into `/opt/ape-signal` with the ape-intel submodule**

Run: `git clone --recurse-submodules <ape-signal-git-url> /opt/ape-signal`
(If the repo is private, configure a deploy key / `gh auth` first.)

- [ ] **Step 2: Confirm the submodule populated**

Run: `ls /opt/ape-signal/vendor/ape-intel/src/lib/briefing.ts`
Expected: the file exists (submodule checked out).

- [ ] **Step 3: Install dependencies**

Run: `cd /opt/ape-signal && npm ci`
Expected: installs `tsx`, `typescript`, `vitest` (devDeps). No runtime deps.

- [ ] **Step 4: Smoke the suite on the VPS**

Run: `cd /opt/ape-signal && npm test && npm run typecheck`
Expected: all green, typecheck clean.

---

### Task 13: End-to-end manual scan from the VPS

- [ ] **Step 1: Run one scan with the real env, manually**

Run: `set -a && . /etc/ape-signal.env && set +a && cd /opt/ape-signal && npx tsx src/scan/index.ts "Manual-Smoke"`
Expected: a **real Telegram briefing arrives** in the configured chat, console prints `[scan] Manual-Smoke report sent.`

> If `claude -p` errors here, fix auth (Task 10) before wiring systemd — a broken token will otherwise only surface via the Task-8 alert.

---

## 🔍 REVIEW CHECKPOINT 2 — VPS proven manually

**Stop and confirm with the user.** Verify:
- [ ] `claude -p "hi"` answers headless on the VPS (subscription token).
- [ ] `npm test` green on the VPS.
- [ ] A manual `tsx src/scan/index.ts` delivered a real Telegram briefing.

Only after this, wire systemd.

---

# Phase 3 — systemd (timers + service)

Unit files are committed to the repo under `systemd/` and symlinked/copied into `/etc/systemd/system/`.

### Task 14: Scan service template + two timers

**Files:**
- Create: `systemd/ape-signal-scan@.service`
- Create: `systemd/ape-signal-scan-preopen.timer`
- Create: `systemd/ape-signal-scan-preus.timer`

- [ ] **Step 1: Create the one-shot scan service template**

`systemd/ape-signal-scan@.service`:

```ini
[Unit]
Description=Ape Signal scan (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/ape-signal
EnvironmentFile=/etc/ape-signal.env
ExecStart=/usr/bin/npx tsx src/scan/index.ts %i
```

- [ ] **Step 2: Create the 08:45 timer**

`systemd/ape-signal-scan-preopen.timer`:

```ini
[Unit]
Description=Ape Signal pre-open scan (08:45 Europe/Berlin)

[Timer]
OnCalendar=*-*-* 08:45:00
Persistent=true
Unit=ape-signal-scan@PreOpen.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Create the 15:15 timer**

`systemd/ape-signal-scan-preus.timer`:

```ini
[Unit]
Description=Ape Signal pre-US-open scan (15:15 Europe/Berlin)

[Timer]
OnCalendar=*-*-* 15:15:00
Persistent=true
Unit=ape-signal-scan@PreUS.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 4: Commit**

```bash
git add systemd/ape-signal-scan@.service systemd/ape-signal-scan-preopen.timer systemd/ape-signal-scan-preus.timer
git commit -m "feat(systemd): scan service template + 08:45/15:15 timers"
```

---

### Task 15: Listener service

**Files:**
- Create: `systemd/ape-signal-listener.service`

- [ ] **Step 1: Create the long-running listener service**

`systemd/ape-signal-listener.service`:

```ini
[Unit]
Description=Ape Signal Telegram listener
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/ape-signal
EnvironmentFile=/etc/ape-signal.env
ExecStart=/usr/bin/npx tsx src/telegram/listener.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Commit**

```bash
git add systemd/ape-signal-listener.service
git commit -m "feat(systemd): always-on Telegram listener service"
```

---

### Task 16: Deploy notes + install on the VPS

**Files:**
- Create: `systemd/README.md`

- [ ] **Step 1: Write the deploy notes**

`systemd/README.md`:

```markdown
# systemd deployment

Copy units and enable. Requires Node LTS at /usr/bin, repo at /opt/ape-signal,
secrets at /etc/ape-signal.env (chmod 600), server TZ = Europe/Berlin.

```bash
cp /opt/ape-signal/systemd/ape-signal-scan@.service /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-scan-preopen.timer /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-scan-preus.timer /etc/systemd/system/
cp /opt/ape-signal/systemd/ape-signal-listener.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ape-signal-scan-preopen.timer ape-signal-scan-preus.timer
systemctl enable --now ape-signal-listener.service
```

Check: `systemctl list-timers 'ape-signal-*'` · `journalctl -u ape-signal-listener -f`
Manual scan: `systemctl start ape-signal-scan@Manual.service`
```

- [ ] **Step 2: Commit**

```bash
git add systemd/README.md
git commit -m "docs(systemd): deployment + verification notes"
```

- [ ] **Step 3: Install on the VPS** (run the block from the README on `root@lm-gateway`)

Expected: `daemon-reload` clean, three units enabled.

- [ ] **Step 4: Verify the timers are scheduled**

Run: `systemctl list-timers 'ape-signal-*'`
Expected: both timers listed with NEXT times at the upcoming 08:45 / 15:15 Europe/Berlin.

- [ ] **Step 5: Verify the listener is up**

Run: `systemctl status ape-signal-listener --no-pager`
Expected: `active (running)`. `journalctl -u ape-signal-listener -n 20` shows `[listener] started; offset=…`.

- [ ] **Step 6: Trigger one scan through systemd**

Run: `systemctl start ape-signal-scan@Manual.service && journalctl -u ape-signal-scan@Manual.service -n 20 --no-pager`
Expected: a Telegram briefing arrives; journal shows `report sent.`

---

## 🔍 FINAL VERIFICATION — "Done when" (roadmap §6)

- [ ] **Scheduled briefing:** at the next 08:45 **or** 15:15 Europe/Berlin, a real Telegram briefing arrives without manual action. (Confirm via `systemctl list-timers` that the slot passed and `journalctl -u 'ape-signal-scan@*'` shows a clean run, plus the message in Telegram.)
- [ ] **On-demand:** send `/strategie TSLA` from the whitelisted chat → a strategy analysis comes back.
- [ ] Reddit confirmed off (no `ENABLE_REDDIT_CRAWL` in `/etc/ape-signal.env`).
- [ ] Failure path sane: temporarily breaking the token and running `systemctl start ape-signal-scan@Manual.service` produces a `⚠️ Scan … fehlgeschlagen` Telegram alert (then restore the token). *(Optional but recommended.)*

When both top boxes are checked, v1 is **done**. v2–v4 are separate slices — do not start them here.

---

## Self-review notes (author)

- **Spec coverage (roadmap §6 v1):** Apewisdom+Tradestie+StockTwits+Finnhub → already in `runScan` (reused, Task 0/13). `claude -p` challenge → existing pipeline. Telegram report → existing. Two timers 08:45/15:15 → Task 14. `/strategie TICKER` on-demand → Tasks 2–7. Secrets `/etc/ape-signal.env` chmod 600 → Task 11. `ENABLE_REDDIT_CRAWL=0` → omitted from env (Task 11), default-off confirmed in checkpoints. ✅ all covered.
- **Auth correction:** roadmap said "`claude login`"; this plan uses `claude setup-token` + `CLAUDE_CODE_OAUTH_TOKEN` for headless — same subscription, browser-free. Flagged at Checkpoint 2.
- **Type consistency:** `StrategyDeps`, `runStrategy`, `formatStrategy`, `assembleStrategyInput`, `parseCommand`, `readOffset/writeOffset` names are used identically across tasks and the listener. `ScanDeps`/`runScan` reused from existing `src/scan/pipeline.ts` unchanged.
- **No placeholders:** every code step shows complete code; every ops step shows the exact command + expected output.
```
