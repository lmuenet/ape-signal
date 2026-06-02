# Scan / Routine 1 (Pre-Open Scan & Challenge) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable `npm run scan` that fetches today's trending tickers, has Claude (via the subscription CLI) classify each as signal/noise/watch, and pushes a formatted report to Telegram.

**Architecture:** Node + tsx. Deterministic data gathering reuses the `ape-intel` submodule's pure `lib` functions (`fetchApewisdomSnapshot`, `assembleTrendingBriefing`, `TRENDING_EXPORT_PROMPT`, `parseTrendingChallenge`). The pipeline is dependency-injected (fetch, Claude runner, Telegram sender) so every unit is testable without network or the real CLI. The entry file wires real dependencies.

**Tech Stack:** TypeScript, tsx, vitest, Node `child_process`, Telegram Bot HTTP API, Claude Code CLI (`claude -p`).

**Scope note:** This plan delivers trending + challenge + Telegram delivery. Reddit-crawl extras (Routine 2) and Finnhub catalyst/earnings enrichment land in Plan 2; the on-demand Telegram listener in Plan 3; systemd/VPS go-live in Plan 4. Spec §C3 (Finnhub) and §E (Reddit) are therefore intentionally deferred to Plan 2.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/core/ape-intel.ts` | Barrel re-exporting the submodule's pure lib functions/types — single import point |
| `src/config/env.ts` | Load + validate required environment variables |
| `src/scan/trending.ts` | Turn an Apewisdom snapshot into a ranked `TrendingRow[]` |
| `src/telegram/client.ts` | `sendMessage` over the Telegram Bot API, with 4096-char chunking |
| `src/claude/invoke.ts` | Run `claude -p` (stdin prompt) and capture stdout; injectable runner |
| `src/scan/format.ts` | Render rows + challenge verdicts into a mobile-friendly message |
| `src/scan/pipeline.ts` | Orchestrate fetch → briefing → Claude → parse → format → send (DI) |
| `src/scan/index.ts` | Wire real dependencies and run the pipeline |

All test files sit beside their source as `*.test.ts` (matches the ape-intel convention).

---

## Task 0: Install dependencies

**Files:** none (uses existing `package.json`)

- [ ] **Step 1: Install**

Run from `C:\Users\lmueller\ape-signal`:
```bash
npm install
```
Expected: `node_modules/` created, `tsx`, `typescript`, `vitest`, `@types/node` present, exit 0.

- [ ] **Step 2: Verify the toolchain runs**

Run:
```bash
npx vitest run
```
Expected: vitest starts and reports "No test files found" (exit 0) — confirms the runner works before any tests exist.

- [ ] **Step 3: Commit**

```bash
git add package-lock.json
git commit -m "chore: install dev toolchain (tsx, vitest, typescript)"
```

---

## Task 1: Core barrel over the submodule lib

**Files:**
- Create: `src/core/ape-intel.ts`
- Test: `src/core/ape-intel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/ape-intel.test.ts
import { describe, it, expect } from "vitest";
import {
  fetchApewisdomSnapshot,
  assembleTrendingBriefing,
  TRENDING_EXPORT_PROMPT,
  buildTrendingClipboardPayload,
  parseTrendingChallenge,
} from "./ape-intel";

describe("ape-intel barrel", () => {
  it("re-exports the pure lib surface the scan needs", () => {
    expect(typeof fetchApewisdomSnapshot).toBe("function");
    expect(typeof assembleTrendingBriefing).toBe("function");
    expect(typeof buildTrendingClipboardPayload).toBe("function");
    expect(typeof parseTrendingChallenge).toBe("function");
    expect(TRENDING_EXPORT_PROMPT).toContain("signal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/ape-intel.test.ts`
Expected: FAIL — cannot resolve `./ape-intel`.

- [ ] **Step 3: Write the barrel**

```ts
// src/core/ape-intel.ts
// Single import point for the pure, Node-safe functions we reuse from the
// ape-intel submodule. Keeping the long relative paths in one place means the
// rest of the server imports from "../core/ape-intel".
export {
  fetchApewisdomSnapshot,
} from "../../vendor/ape-intel/src/lib/apewisdom";
export type {
  ApewisdomSnapshot,
  ApewisdomEntry,
  FetchFn,
} from "../../vendor/ape-intel/src/lib/apewisdom";

export {
  assembleTrendingBriefing,
  TRENDING_EXPORT_PROMPT,
  buildTrendingClipboardPayload,
} from "../../vendor/ape-intel/src/lib/trending-briefing";

export {
  parseTrendingChallenge,
} from "../../vendor/ape-intel/src/lib/trending-challenge";
export type {
  TrendingChallenge,
  TickerVerdict,
  Verdict,
} from "../../vendor/ape-intel/src/lib/trending-challenge";

export type {
  TrendingRow,
} from "../../vendor/ape-intel/src/background/apewisdom-service";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/ape-intel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/ape-intel.ts src/core/ape-intel.test.ts
git commit -m "feat: barrel re-exporting ape-intel submodule lib"
```

---

## Task 2: Environment loader

**Files:**
- Create: `src/config/env.ts`
- Test: `src/config/env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/config/env.test.ts
import { describe, it, expect } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("returns the config when required vars are present", () => {
    const cfg = loadEnv({
      TELEGRAM_BOT_TOKEN: "tok",
      TELEGRAM_CHAT_ID: "123",
    });
    expect(cfg.telegramBotToken).toBe("tok");
    expect(cfg.telegramChatId).toBe("123");
  });

  it("throws listing every missing required var", () => {
    expect(() => loadEnv({})).toThrowError(
      /TELEGRAM_BOT_TOKEN.*TELEGRAM_CHAT_ID/s,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/env.test.ts`
Expected: FAIL — cannot resolve `./env`.

- [ ] **Step 3: Write the implementation**

```ts
// src/config/env.ts
export interface Env {
  telegramBotToken: string;
  telegramChatId: string;
}

const REQUIRED = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;

/**
 * Validate and shape the process environment. Pass a source object in tests;
 * defaults to process.env. On the VPS, systemd's EnvironmentFile populates
 * process.env; locally run with `node --env-file=.env` (tsx forwards it).
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing = REQUIRED.filter((k) => !source[k] || source[k]!.trim() === "");
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    telegramBotToken: source.TELEGRAM_BOT_TOKEN!,
    telegramChatId: source.TELEGRAM_CHAT_ID!,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/env.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/config/env.test.ts
git commit -m "feat: env loader with required-var validation"
```

---

## Task 3: Snapshot → ranked rows

**Files:**
- Create: `src/scan/trending.ts`
- Test: `src/scan/trending.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/scan/trending.test.ts
import { describe, it, expect } from "vitest";
import { snapshotToRows } from "./trending";
import type { ApewisdomSnapshot } from "../core/ape-intel";

function snap(): ApewisdomSnapshot {
  return new Map([
    ["TSLA", { rank: 2, mentions: 300, mentions24hAgo: 100 }],
    ["GME", { rank: 1, mentions: 500, mentions24hAgo: 600 }],
    ["AMC", { rank: 3, mentions: 50, mentions24hAgo: 50 }],
  ]);
}

describe("snapshotToRows", () => {
  it("sorts by rank ascending and carries ticker + mentions", () => {
    const rows = snapshotToRows(snap());
    expect(rows.map((r) => r.ticker)).toEqual(["GME", "TSLA", "AMC"]);
    expect(rows[0]).toMatchObject({ ticker: "GME", rank: 1, mentions: 500, mentions24hAgo: 600 });
  });

  it("applies the limit", () => {
    expect(snapshotToRows(snap(), 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scan/trending.test.ts`
Expected: FAIL — cannot resolve `./trending`.

- [ ] **Step 3: Write the implementation**

```ts
// src/scan/trending.ts
import type { ApewisdomSnapshot, TrendingRow } from "../core/ape-intel";

const DEFAULT_LIMIT = 15;

/**
 * Flatten an Apewisdom snapshot into ranked TrendingRows. Mirrors what the
 * extension's ApewisdomService.board() does, but without the browser KvStore —
 * the scan holds the snapshot in memory for one run.
 */
export function snapshotToRows(
  snapshot: ApewisdomSnapshot,
  limit: number = DEFAULT_LIMIT,
): TrendingRow[] {
  return Array.from(snapshot.entries())
    .map(([ticker, e]) => ({
      ticker,
      name: (e as { name?: string }).name,
      rank: e.rank,
      mentions: e.mentions,
      mentions24hAgo: e.mentions24hAgo,
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scan/trending.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/scan/trending.ts src/scan/trending.test.ts
git commit -m "feat: snapshot-to-ranked-rows helper"
```

---

## Task 4: Telegram client

**Files:**
- Create: `src/telegram/client.ts`
- Test: `src/telegram/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/telegram/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { createTelegramClient, splitMessage } from "./client";

describe("splitMessage", () => {
  it("keeps a short message as a single chunk", () => {
    expect(splitMessage("hello", 4000)).toEqual(["hello"]);
  });

  it("splits on newlines without exceeding the limit", () => {
    const line = "x".repeat(100);
    const text = Array.from({ length: 50 }, () => line).join("\n"); // ~5049 chars
    const chunks = splitMessage(text, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
    expect(chunks.join("\n")).toBe(text);
  });
});

describe("createTelegramClient.sendMessage", () => {
  it("POSTs each chunk to the bot sendMessage endpoint", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const client = createTelegramClient(
      { botToken: "TKN", chatId: "42" },
      fetchFn as unknown as typeof fetch,
    );
    await client.sendMessage("hi");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botTKN/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ chat_id: "42", text: "hi" });
  });

  it("throws when Telegram returns a non-ok response", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, description: "boom" }), { status: 400 }),
    );
    const client = createTelegramClient(
      { botToken: "TKN", chatId: "42" },
      fetchFn as unknown as typeof fetch,
    );
    await expect(client.sendMessage("hi")).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/telegram/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Write the implementation**

```ts
// src/telegram/client.ts
export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

const TELEGRAM_LIMIT = 4096;

/** Split text into chunks <= limit, breaking on newlines, preserving content. */
export function splitMessage(text: string, limit: number = TELEGRAM_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current === "" ? line : `${current}\n${line}`;
    if (candidate.length <= limit) {
      current = candidate;
    } else {
      if (current !== "") chunks.push(current);
      // A single over-long line is hard-split.
      if (line.length <= limit) {
        current = line;
      } else {
        for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
        current = "";
      }
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

export interface TelegramClient {
  sendMessage(text: string): Promise<void>;
}

export function createTelegramClient(
  config: TelegramConfig,
  fetchFn: typeof fetch = fetch,
): TelegramClient {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  return {
    async sendMessage(text: string): Promise<void> {
      for (const chunk of splitMessage(text)) {
        const res = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: config.chatId, text: chunk }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
        if (!res.ok || data.ok === false) {
          throw new Error(`Telegram sendMessage failed: ${data.description ?? res.status}`);
        }
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/telegram/client.test.ts`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add src/telegram/client.ts src/telegram/client.test.ts
git commit -m "feat: telegram client with message chunking"
```

---

## Task 5: Claude invoker

**Files:**
- Create: `src/claude/invoke.ts`
- Test: `src/claude/invoke.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/claude/invoke.test.ts
import { describe, it, expect, vi } from "vitest";
import { invokeClaude } from "./invoke";

describe("invokeClaude", () => {
  it("passes the prompt to the runner and returns its stdout", async () => {
    const runner = vi.fn(async (prompt: string) => `echoed: ${prompt}`);
    const out = await invokeClaude("classify this", { runner });
    expect(runner).toHaveBeenCalledWith("classify this");
    expect(out).toBe("echoed: classify this");
  });

  it("wraps runner failures with context", async () => {
    const runner = vi.fn(async () => {
      throw new Error("spawn ENOENT");
    });
    await expect(invokeClaude("x", { runner })).rejects.toThrow(/Claude CLI failed: spawn ENOENT/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/claude/invoke.test.ts`
Expected: FAIL — cannot resolve `./invoke`.

- [ ] **Step 3: Write the implementation**

```ts
// src/claude/invoke.ts
import { spawn } from "node:child_process";

export type ClaudeRunner = (prompt: string) => Promise<string>;

export interface InvokeOptions {
  runner?: ClaudeRunner;
}

/**
 * Default runner: spawn the Claude Code CLI in print mode reading the prompt
 * from stdin (avoids command-line length limits for large briefings). Relies on
 * `claude login` having been run once on the host (subscription auth).
 */
export const spawnClaudeRunner: ClaudeRunner = (prompt) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["-p"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`exit ${code}: ${stderr.trim()}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });

/** Run Claude on a prompt and return its raw stdout. */
export async function invokeClaude(prompt: string, options: InvokeOptions = {}): Promise<string> {
  const runner = options.runner ?? spawnClaudeRunner;
  try {
    return await runner(prompt);
  } catch (err) {
    throw new Error(`Claude CLI failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/claude/invoke.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/claude/invoke.ts src/claude/invoke.test.ts
git commit -m "feat: claude -p invoker with injectable runner"
```

---

## Task 6: Report formatter

**Files:**
- Create: `src/scan/format.ts`
- Test: `src/scan/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/scan/format.test.ts
import { describe, it, expect } from "vitest";
import { formatReport } from "./format";
import type { TrendingRow, TrendingChallenge } from "../core/ape-intel";

const rows: TrendingRow[] = [
  { ticker: "GME", rank: 1, mentions: 500, mentions24hAgo: 600 },
  { ticker: "TSLA", rank: 2, mentions: 300, mentions24hAgo: 100 },
];

const challenge: TrendingChallenge = {
  summary: "Mostly noise today.",
  verdicts: [
    { ticker: "GME", verdict: "noise", thesis: "stale meme pump" },
    { ticker: "TSLA", verdict: "signal", thesis: "real delivery beat", watch: "guidance call" },
  ],
};

describe("formatReport", () => {
  it("includes a title, the summary and one line per verdict", () => {
    const out = formatReport(rows, challenge, { label: "Morning" });
    expect(out).toContain("Morning");
    expect(out).toContain("Mostly noise today.");
    expect(out).toContain("GME");
    expect(out).toContain("stale meme pump");
    expect(out).toContain("TSLA");
    expect(out).toContain("real delivery beat");
  });

  it("marks verdicts with distinct symbols and notes a not-financial-advice footer", () => {
    const out = formatReport(rows, challenge, { label: "Pre-US" });
    expect(out).toContain("🚫"); // noise
    expect(out).toContain("✅"); // signal
    expect(out.toLowerCase()).toContain("not financial advice");
  });

  it("falls back to the trending list when there are no verdicts", () => {
    const out = formatReport(rows, { summary: "", verdicts: [] }, { label: "Morning" });
    expect(out).toContain("GME");
    expect(out).toContain("TSLA");
    expect(out).toContain("no challenge");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scan/format.test.ts`
Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 3: Write the implementation**

```ts
// src/scan/format.ts
import type { TrendingRow, TrendingChallenge, Verdict } from "../core/ape-intel";

export interface ReportMeta {
  label: string; // e.g. "Morning" / "Pre-US"
}

const VERDICT_SYMBOL: Record<Verdict, string> = {
  signal: "✅",
  watch: "👀",
  noise: "🚫",
};

function trendArrow(row: TrendingRow): string {
  if (row.mentions > row.mentions24hAgo) return "↑";
  if (row.mentions < row.mentions24hAgo) return "↓";
  return "→";
}

/** Render a compact, mobile-friendly report. Plain text (no Markdown parse mode). */
export function formatReport(
  rows: TrendingRow[],
  challenge: TrendingChallenge,
  meta: ReportMeta,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`📊 Ape Signal — ${meta.label} scan (${date})`, ""];

  if (challenge.summary) {
    lines.push(challenge.summary, "");
  }

  const byTicker = new Map(rows.map((r) => [r.ticker, r]));

  if (challenge.verdicts.length === 0) {
    lines.push("(no challenge available — raw trending list)", "");
    for (const r of rows) {
      lines.push(`#${r.rank} ${r.ticker} — ${r.mentions} mentions ${trendArrow(r)}`);
    }
  } else {
    for (const v of challenge.verdicts) {
      const r = byTicker.get(v.ticker);
      const meta2 = r ? ` (#${r.rank}, ${r.mentions} ${trendArrow(r)})` : "";
      const thesis = v.thesis ? ` — ${v.thesis}` : "";
      lines.push(`${VERDICT_SYMBOL[v.verdict]} ${v.ticker}${meta2}${thesis}`);
      if (v.watch) lines.push(`   👁 watch: ${v.watch}`);
    }
  }

  lines.push("", "For personal research — not financial advice.");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scan/format.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/scan/format.ts src/scan/format.test.ts
git commit -m "feat: scan report formatter"
```

---

## Task 7: Scan pipeline (orchestrator)

**Files:**
- Create: `src/scan/pipeline.ts`
- Test: `src/scan/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/scan/pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { runScan } from "./pipeline";
import type { ApewisdomSnapshot } from "../core/ape-intel";

function fakeSnapshot(): ApewisdomSnapshot {
  return new Map([
    ["GME", { rank: 1, mentions: 500, mentions24hAgo: 600 }],
    ["TSLA", { rank: 2, mentions: 300, mentions24hAgo: 100 }],
  ]);
}

describe("runScan", () => {
  it("fetches, challenges via claude, and sends the formatted report", async () => {
    const fetchSnapshot = vi.fn(async () => fakeSnapshot());
    const claudeRunner = vi.fn(async () =>
      '```json\n{"summary":"ok","verdicts":[{"ticker":"TSLA","verdict":"signal","thesis":"beat"}]}\n```',
    );
    const send = vi.fn(async () => {});

    const result = await runScan(
      { label: "Morning", limit: 10 },
      { fetchSnapshot, claudeRunner, send },
    );

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    // the prompt handed to claude must contain the export prompt + the tickers
    const prompt = claudeRunner.mock.calls[0][0] as string;
    expect(prompt).toContain("signal");
    expect(prompt).toContain("TSLA");
    // the sent message reflects the parsed verdict
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("✅ TSLA");
    expect(result.verdicts).toHaveLength(1);
  });

  it("still sends a report (raw list) when claude output cannot be parsed", async () => {
    const fetchSnapshot = vi.fn(async () => fakeSnapshot());
    const claudeRunner = vi.fn(async () => "sorry, no json here");
    const send = vi.fn(async () => {});

    await runScan({ label: "Morning", limit: 10 }, { fetchSnapshot, claudeRunner, send });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("GME"); // raw fallback list
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scan/pipeline.test.ts`
Expected: FAIL — cannot resolve `./pipeline`.

- [ ] **Step 3: Write the implementation**

```ts
// src/scan/pipeline.ts
import {
  buildTrendingClipboardPayload,
  parseTrendingChallenge,
  type ApewisdomSnapshot,
  type TrendingChallenge,
} from "../core/ape-intel";
import { snapshotToRows } from "./trending";
import { formatReport } from "./format";

export interface ScanOptions {
  label: string;
  limit: number;
}

export interface ScanDeps {
  fetchSnapshot: () => Promise<ApewisdomSnapshot>;
  claudeRunner: (prompt: string) => Promise<string>;
  send: (text: string) => Promise<void>;
}

/**
 * One scan run: fetch trending → ask Claude to challenge each ticker →
 * parse → format → send. If parsing fails, fall back to the raw trending list
 * so the user still gets a report.
 */
export async function runScan(
  options: ScanOptions,
  deps: ScanDeps,
): Promise<TrendingChallenge> {
  const snapshot = await deps.fetchSnapshot();
  const rows = snapshotToRows(snapshot, options.limit);

  const payload = buildTrendingClipboardPayload(rows);
  const raw = await deps.claudeRunner(payload);

  const challenge = parseTrendingChallenge(raw) ?? { summary: "", verdicts: [] };
  const report = formatReport(rows, challenge, { label: options.label });
  await deps.send(report);

  return challenge;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scan/pipeline.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/scan/pipeline.ts src/scan/pipeline.test.ts
git commit -m "feat: scan pipeline orchestrator with parse fallback"
```

---

## Task 8: Entry wiring + manual run

**Files:**
- Create: `src/scan/index.ts`

This file wires real dependencies; it is exercised by the manual run below rather than a unit test (it is pure composition of already-tested units).

- [ ] **Step 1: Write the entry**

```ts
// src/scan/index.ts
import { loadEnv } from "../config/env";
import { fetchApewisdomSnapshot } from "../core/ape-intel";
import { createTelegramClient } from "../telegram/client";
import { spawnClaudeRunner } from "../claude/invoke";
import { runScan } from "./pipeline";

const LABEL = process.argv[2] ?? "Scan";
const LIMIT = Number(process.env.SCAN_LIMIT ?? "15");

async function main(): Promise<void> {
  const env = loadEnv();
  const telegram = createTelegramClient({
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId,
  });

  await runScan(
    { label: LABEL, limit: LIMIT },
    {
      fetchSnapshot: () => fetchApewisdomSnapshot(fetch),
      claudeRunner: spawnClaudeRunner,
      send: (text) => telegram.sendMessage(text),
    },
  );
  console.log(`[scan] ${LABEL} report sent.`);
}

main().catch((err) => {
  console.error("[scan] failed:", err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 4: Manual smoke test (requires real secrets + `claude login`)**

Create `.env` from `.env.example` with a real `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, ensure `claude -p "hi"` works, then run:
```bash
node --env-file=.env --import tsx src/scan/index.ts Morning
```
Expected: a report arrives in your Telegram chat; console prints `[scan] Morning report sent.`

(If you do not have secrets yet, skip this step — Plan 4 covers VPS setup; the unit suite already proves the wiring.)

- [ ] **Step 5: Commit**

```bash
git add src/scan/index.ts
git commit -m "feat: scan entry wiring (npm run scan)"
```

---

## Self-Review

**Spec coverage (this plan's slice):**
- §D1 assemble briefing → `buildTrendingClipboardPayload` in Task 7. ✓
- §D2 export prompt → Claude → Tasks 5 + 7. ✓
- §D3 parse signal/noise/watch → `parseTrendingChallenge` in Task 7. ✓
- §D4 mobile report → Task 6. ✓
- §C1 Apewisdom fetch → Tasks 1 + 8. ✓
- Delivery via Telegram → Task 4. ✓
- Subscription Claude via `claude -p` → Task 5. ✓
- Deferred to Plan 2 (stated up front): §C2 Tradestie/StockTwits sentiment columns, §C3 Finnhub catalysts/earnings, §E Reddit crawl. (Note: `barometer.ts` exists for when C2 is added.)
- Deferred to Plan 3: §F Telegram listener / on-demand strategy.
- Deferred to Plan 4: §A3/A4 systemd, §6 scheduling.

**Placeholder scan:** none — every code step contains full code and exact commands.

**Type consistency:** `TrendingRow`, `TrendingChallenge`, `Verdict`, `ApewisdomSnapshot` are sourced from `src/core/ape-intel` everywhere; `runScan(options, deps)`, `createTelegramClient(config, fetchFn)`, `invokeClaude(prompt, options)`, `formatReport(rows, challenge, meta)`, `snapshotToRows(snapshot, limit)` signatures match between definition and call sites.
