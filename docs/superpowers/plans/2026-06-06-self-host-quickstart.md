# Self-host Quickstart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public `ape-signal` repo runnable in a few commands on a Debian/Ubuntu+systemd VPS via a config `doctor` diagnostics command, a thin idempotent `setup.sh`, a polished `.env.example`, and a README quickstart.

**Architecture:** One new TDD-able code unit `src/config/doctor.ts` (pure, dependency-injected check functions + an orchestrator + formatting, plus a thin `main` entrypoint). Everything else is glue/docs: `scripts/setup.sh`, `.env.example`, `README.md`. The Claude Code CLI (installed + logged in) is a documented prerequisite, not packaged.

**Tech Stack:** TypeScript, Node ≥20, vitest, `tsx` runtime, bash. No new runtime dependencies (uses built-in `fetch`, `node:fs`, `node:child_process`).

**Spec:** `docs/superpowers/specs/2026-06-06-self-host-quickstart-design.md`

**Working-dir note (Windows dev box):** the Bash cwd can drift into the `vendor/ape-intel` submodule. Prefix Bash with `cd /c/Users/lmueller/ape-signal &&` and use `git -C /c/Users/lmueller/ape-signal …`. Never modify `vendor/`.

---

## File Structure

- **Create** `src/config/doctor.ts` — diagnostics: `CheckResult` type, pure check functions (env/claude/telegram/finnhub/tradingview/reddit), `parseEnvFile`, `withTimeout`, `runDoctor` orchestrator, `formatResults`, `hasFailure`, and a thin `main()` entrypoint.
- **Create** `src/config/doctor.test.ts` — unit tests for the pure functions with injected `fetch`/runner.
- **Modify** `package.json` — add `"doctor"` script.
- **Modify** `.env.example` — Claude-prerequisite note + `SCAN_LIMIT`/`OFFSET_PATH`.
- **Create** `scripts/setup.sh` — idempotent bootstrap with a `--check` mode.
- **Modify** `README.md` — "Self-hosting in a few commands" section.

Type/signature contract (used across tasks — keep names identical):

```ts
export type CheckStatus = "ok" | "warn" | "fail";
export interface CheckResult { name: string; status: CheckStatus; detail: string; }
export type Runner = (prompt: string) => Promise<string>;

export function parseEnvFile(content: string): Record<string, string>;
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T>;
export function formatResults(results: CheckResult[]): string;
export function hasFailure(results: CheckResult[]): boolean;

export function checkRequiredEnv(source: Record<string, string | undefined>): CheckResult;
export function checkClaude(runner: Runner): Promise<CheckResult>;
export function checkTelegram(botToken: string, chatId: string, fetchFn: typeof fetch): Promise<CheckResult>;
export function checkFinnhub(apiKey: string, fetchFn: typeof fetch): Promise<CheckResult>;
export function checkTradingView(fetchFn: typeof fetch): Promise<CheckResult>;
export function checkReddit(clientId: string, clientSecret: string, userAgent: string, fetchFn: typeof fetch): Promise<CheckResult>;

export interface DoctorDeps {
  source: Record<string, string | undefined>;
  fetchFn: typeof fetch;
  claudeRunner: Runner;
  sendTest?: boolean;
}
export function runDoctor(deps: DoctorDeps): Promise<CheckResult[]>;
```

---

## Task 1: Doctor pure utilities (`parseEnvFile`, `withTimeout`, `formatResults`, `hasFailure`)

**Files:**
- Create: `src/config/doctor.ts`
- Test: `src/config/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/doctor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseEnvFile, withTimeout, formatResults, hasFailure, type CheckResult } from "./doctor";

describe("parseEnvFile", () => {
  it("parses KEY=VALUE lines, ignoring blanks and # comments", () => {
    const out = parseEnvFile("# comment\n\nA=1\nB = two \n#X=skip\nC=eq=in=value\n");
    expect(out).toEqual({ A: "1", B: "two", C: "eq=in=value" });
  });

  it("strips surrounding quotes from values", () => {
    expect(parseEnvFile(`A="quoted"\nB='single'`)).toEqual({ A: "quoted", B: "single" });
  });
});

describe("withTimeout", () => {
  it("resolves when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "x")).resolves.toBe("ok");
  });

  it("rejects with the label when it times out", async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, "claude -p")).rejects.toThrow(/claude -p.*timed out/i);
  });
});

describe("formatResults + hasFailure", () => {
  const results: CheckResult[] = [
    { name: "Env", status: "ok", detail: "all present" },
    { name: "Finnhub", status: "warn", detail: "no key" },
    { name: "Claude", status: "fail", detail: "exit 1" },
  ];

  it("formats one emoji-prefixed line per result", () => {
    const text = formatResults(results);
    expect(text).toContain("✅ Env: all present");
    expect(text).toContain("⚠️ Finnhub: no key");
    expect(text).toContain("❌ Claude: exit 1");
  });

  it("hasFailure is true only when a result has status fail", () => {
    expect(hasFailure(results)).toBe(true);
    expect(hasFailure([{ name: "x", status: "warn", detail: "" }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/config/doctor.test.ts`
Expected: FAIL — cannot find module `./doctor`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/config/doctor.ts`:

```ts
// src/config/doctor.ts — self-host diagnostics ("npm run doctor").
// Pure, dependency-injected checks + a thin entrypoint. No new runtime deps.

export type CheckStatus = "ok" | "warn" | "fail";
export interface CheckResult { name: string; status: CheckStatus; detail: string; }
export type Runner = (prompt: string) => Promise<string>;

/** Parse a KEY=VALUE env file: skip blank/`#` lines, trim, strip matching quotes. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key !== "") out[key] = value;
  }
  return out;
}

/** Reject if `p` does not settle within `ms`, so a diagnostic can't hang forever. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const EMOJI: Record<CheckStatus, string> = { ok: "✅", warn: "⚠️", fail: "❌" };

/** Render one emoji-prefixed line per check result. */
export function formatResults(results: CheckResult[]): string {
  return results.map((r) => `${EMOJI[r.status]} ${r.name}: ${r.detail}`).join("\n");
}

/** True if any check hard-failed (used for the process exit code). */
export function hasFailure(results: CheckResult[]): boolean {
  return results.some((r) => r.status === "fail");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/config/doctor.test.ts && npm run typecheck`
Expected: PASS (6 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/lmueller/ape-signal && git add src/config/doctor.ts src/config/doctor.test.ts && git commit -m "feat(doctor): env-file parser + timeout + result formatting utils"
```

---

## Task 2: Required checks (env, Claude, Telegram)

These are the hard-fail (❌) checks.

**Files:**
- Modify: `src/config/doctor.ts`
- Test: `src/config/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/config/doctor.test.ts` (and extend the import on line 2 to add the three new names: `checkRequiredEnv, checkClaude, checkTelegram`):

```ts
import { checkRequiredEnv, checkClaude, checkTelegram } from "./doctor";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("checkRequiredEnv", () => {
  it("ok when Telegram vars are present", () => {
    const r = checkRequiredEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });
    expect(r.status).toBe("ok");
  });
  it("fails listing the missing vars", () => {
    const r = checkRequiredEnv({});
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(r.detail).toMatch(/TELEGRAM_CHAT_ID/);
  });
});

describe("checkClaude", () => {
  it("ok when the runner returns non-empty output", async () => {
    const r = await checkClaude(async () => "OK");
    expect(r.status).toBe("ok");
  });
  it("fails when the runner throws (CLI missing or not logged in)", async () => {
    const r = await checkClaude(async () => { throw new Error("spawn claude ENOENT"); });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/ENOENT|login/i);
  });
  it("fails when the runner returns empty output", async () => {
    const r = await checkClaude(async () => "   ");
    expect(r.status).toBe("fail");
  });
});

describe("checkTelegram", () => {
  it("ok when getMe and getChat both succeed", async () => {
    const fetchFn = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("getMe")) return jsonResponse({ ok: true, result: { username: "mybot" } });
      if (u.includes("getChat")) return jsonResponse({ ok: true, result: { id: 5, type: "private" } });
      return jsonResponse({ ok: false }, false, 404);
    }) as unknown as typeof fetch;
    const r = await checkTelegram("tok", "5", fetchFn);
    expect(r.status).toBe("ok");
    expect(r.detail).toMatch(/mybot/);
  });
  it("fails when getMe rejects the token", async () => {
    const fetchFn = (async () => jsonResponse({ ok: false, description: "Unauthorized" }, false, 401)) as unknown as typeof fetch;
    const r = await checkTelegram("bad", "5", fetchFn);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/Unauthorized|getMe/i);
  });
  it("fails when getChat cannot find the chat id", async () => {
    const fetchFn = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("getMe")) return jsonResponse({ ok: true, result: { username: "mybot" } });
      return jsonResponse({ ok: false, description: "chat not found" }, false, 400);
    }) as unknown as typeof fetch;
    const r = await checkTelegram("tok", "999", fetchFn);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/chat/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/config/doctor.test.ts -t "checkRequiredEnv|checkClaude|checkTelegram"`
Expected: FAIL — `checkRequiredEnv` etc. not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/config/doctor.ts` (the import of `loadEnv` goes at the top of the file with the other imports — there are none yet, so add it as the first line):

```ts
import { loadEnv } from "./env";
```

```ts
/** Required env present (Telegram). Hard-fail with the list of what's missing. */
export function checkRequiredEnv(source: Record<string, string | undefined>): CheckResult {
  try {
    loadEnv(source);
    return { name: "Required env", status: "ok", detail: "TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID present" };
  } catch (err) {
    return { name: "Required env", status: "fail", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Claude CLI installed AND authenticated as the current user (one probe). */
export async function checkClaude(runner: Runner): Promise<CheckResult> {
  try {
    const out = await runner("Reply with the single word: OK");
    if (out.trim() === "") {
      return { name: "Claude CLI", status: "fail", detail: "claude -p returned empty output" };
    }
    return { name: "Claude CLI", status: "ok", detail: "claude -p responded" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: "Claude CLI", status: "fail", detail: `${msg} — is Claude Code installed and logged in as this user?` };
  }
}

const TG_API = "https://api.telegram.org";

interface TgResponse { ok?: boolean; description?: string; result?: { username?: string; type?: string } }

async function tgGet(url: string, fetchFn: typeof fetch): Promise<TgResponse> {
  const res = await fetchFn(url);
  return (await res.json().catch(() => ({}))) as TgResponse;
}

/** Telegram bot token valid (getMe) + chat reachable (getChat). Silent. */
export async function checkTelegram(botToken: string, chatId: string, fetchFn: typeof fetch): Promise<CheckResult> {
  try {
    const me = await tgGet(`${TG_API}/bot${botToken}/getMe`, fetchFn);
    if (!me.ok) return { name: "Telegram", status: "fail", detail: `getMe: ${me.description ?? "token rejected"}` };
    const chat = await tgGet(`${TG_API}/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`, fetchFn);
    if (!chat.ok) return { name: "Telegram", status: "fail", detail: `getChat: ${chat.description ?? "chat not found"}` };
    return { name: "Telegram", status: "ok", detail: `bot @${me.result?.username ?? "?"} → chat ${chatId} (${chat.result?.type ?? "?"})` };
  } catch (err) {
    return { name: "Telegram", status: "fail", detail: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/config/doctor.test.ts && npm run typecheck`
Expected: PASS (all doctor tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/lmueller/ape-signal && git add src/config/doctor.ts src/config/doctor.test.ts && git commit -m "feat(doctor): required env + Claude + Telegram checks"
```

---

## Task 3: Optional checks (Finnhub, TradingView, Reddit)

These warn (⚠️) on failure — they never block the briefing.

**Files:**
- Modify: `src/config/doctor.ts`
- Test: `src/config/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/config/doctor.test.ts` (extend the import to add `checkFinnhub, checkTradingView, checkReddit`):

```ts
import { checkFinnhub, checkTradingView, checkReddit } from "./doctor";

describe("checkFinnhub", () => {
  it("ok when /quote returns a positive current price", async () => {
    const fetchFn = (async () => jsonResponse({ c: 191.5 })) as unknown as typeof fetch;
    const r = await checkFinnhub("key", fetchFn);
    expect(r.status).toBe("ok");
  });
  it("warns (not fails) when the quote call errors", async () => {
    const fetchFn = (async () => jsonResponse({}, false, 401)) as unknown as typeof fetch;
    const r = await checkFinnhub("badkey", fetchFn);
    expect(r.status).toBe("warn");
  });
});

describe("checkTradingView", () => {
  it("ok when the scanner returns data", async () => {
    const fetchFn = (async () => jsonResponse({ data: [{ s: "AMEX:SPY", d: [500] }] })) as unknown as typeof fetch;
    const r = await checkTradingView(fetchFn);
    expect(r.status).toBe("ok");
  });
  it("warns when the scanner is unreachable", async () => {
    const fetchFn = (async () => jsonResponse({}, false, 503)) as unknown as typeof fetch;
    const r = await checkTradingView(fetchFn);
    expect(r.status).toBe("warn");
  });
});

describe("checkReddit", () => {
  it("ok when an app-only token is granted", async () => {
    const fetchFn = (async () => jsonResponse({ access_token: "abc", token_type: "bearer" })) as unknown as typeof fetch;
    const r = await checkReddit("id", "secret", "ua", fetchFn);
    expect(r.status).toBe("ok");
  });
  it("warns when the token request is refused", async () => {
    const fetchFn = (async () => jsonResponse({ error: "invalid_grant" }, false, 401)) as unknown as typeof fetch;
    const r = await checkReddit("id", "bad", "ua", fetchFn);
    expect(r.status).toBe("warn");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/config/doctor.test.ts -t "checkFinnhub|checkTradingView|checkReddit"`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Write the minimal implementation**

Add the `postScan` import to the top of `src/config/doctor.ts` (next to the `loadEnv` import):

```ts
import { postScan } from "../core/tvScanner";
```

Append:

```ts
/** Finnhub key works: a /quote probe returns a positive current price. Optional → warn. */
export async function checkFinnhub(apiKey: string, fetchFn: typeof fetch): Promise<CheckResult> {
  try {
    const res = await fetchFn(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(apiKey)}`);
    const data = (await res.json().catch(() => ({}))) as { c?: number };
    if (res.ok && typeof data.c === "number" && data.c > 0) {
      return { name: "Finnhub", status: "ok", detail: `quote AAPL=${data.c}` };
    }
    return { name: "Finnhub", status: "warn", detail: `quote probe failed (HTTP ${res.status}) — earnings/news will be skipped` };
  } catch (err) {
    return { name: "Finnhub", status: "warn", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** TradingView scanner reachable (no key). Optional → warn (the briefing degrades). */
export async function checkTradingView(fetchFn: typeof fetch): Promise<CheckResult> {
  try {
    const resp = await postScan(fetchFn, {
      symbols: { tickers: ["AMEX:SPY"], query: { types: [] } },
      columns: ["close"],
    });
    if (resp.data && resp.data.length > 0) {
      return { name: "TradingView", status: "ok", detail: "scanner reachable" };
    }
    return { name: "TradingView", status: "warn", detail: "scanner returned no data" };
  } catch (err) {
    return { name: "TradingView", status: "warn", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Reddit app-only OAuth (client_credentials) yields a token. Optional → warn. */
export async function checkReddit(clientId: string, clientSecret: string, userAgent: string, fetchFn: typeof fetch): Promise<CheckResult> {
  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetchFn("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body: "grant_type=client_credentials",
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (res.ok && data.access_token) {
      return { name: "Reddit", status: "ok", detail: "app-only token granted" };
    }
    return { name: "Reddit", status: "warn", detail: `token request failed: ${data.error ?? res.status}` };
  } catch (err) {
    return { name: "Reddit", status: "warn", detail: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/config/doctor.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/lmueller/ape-signal && git add src/config/doctor.ts src/config/doctor.test.ts && git commit -m "feat(doctor): optional Finnhub + TradingView + Reddit checks"
```

---

## Task 4: Orchestrator (`runDoctor`) + entrypoint + npm script

**Files:**
- Modify: `src/config/doctor.ts`
- Modify: `package.json`
- Test: `src/config/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/config/doctor.test.ts` (extend the import to add `runDoctor`):

```ts
import { runDoctor } from "./doctor";

describe("runDoctor", () => {
  const okFetch = (async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("getMe")) return jsonResponse({ ok: true, result: { username: "b" } });
    if (u.includes("getChat")) return jsonResponse({ ok: true, result: { type: "private" } });
    if (u.includes("finnhub")) return jsonResponse({ c: 100 });
    if (u.includes("scanner.tradingview")) return jsonResponse({ data: [{ s: "AMEX:SPY", d: [1] }] });
    if (u.includes("reddit")) return jsonResponse({ access_token: "x" });
    return jsonResponse({}, false, 404);
  }) as unknown as typeof fetch;

  it("runs env+claude+telegram+tradingview by default; skips finnhub/reddit when unconfigured", async () => {
    const results = await runDoctor({
      source: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" },
      fetchFn: okFetch,
      claudeRunner: async () => "OK",
    });
    const names = results.map((r) => r.name);
    expect(names).toEqual(["Required env", "Claude CLI", "Telegram", "TradingView"]);
    expect(results.every((r) => r.status === "ok")).toBe(true);
  });

  it("includes Finnhub and Reddit checks when those are configured", async () => {
    const results = await runDoctor({
      source: {
        TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c",
        FINNHUB_API_KEY: "fk", ENABLE_REDDIT_CRAWL: "1",
        REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "sec",
      },
      fetchFn: okFetch,
      claudeRunner: async () => "OK",
    });
    const names = results.map((r) => r.name);
    expect(names).toContain("Finnhub");
    expect(names).toContain("Reddit");
  });

  it("sends a test message when sendTest is set (extra ok result)", async () => {
    const sent: string[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("sendMessage")) { sent.push(String(init?.body ?? "")); return jsonResponse({ ok: true }); }
      if (u.includes("getMe")) return jsonResponse({ ok: true, result: { username: "b" } });
      if (u.includes("getChat")) return jsonResponse({ ok: true, result: { type: "private" } });
      if (u.includes("scanner.tradingview")) return jsonResponse({ data: [{ s: "x", d: [1] }] });
      return jsonResponse({}, false, 404);
    }) as unknown as typeof fetch;
    const results = await runDoctor({
      source: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" },
      fetchFn, claudeRunner: async () => "OK", sendTest: true,
    });
    expect(sent.length).toBe(1);
    expect(results.some((r) => r.name === "Telegram test message" && r.status === "ok")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/lmueller/ape-signal && npx vitest run src/config/doctor.test.ts -t "runDoctor"`
Expected: FAIL — `runDoctor` not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/config/doctor.ts` (the `isTruthy` helper is defined inline here — no import needed):

```ts
export interface DoctorDeps {
  source: Record<string, string | undefined>;
  fetchFn: typeof fetch;
  claudeRunner: Runner;
  sendTest?: boolean;
}

function isTruthy(v: string | undefined): boolean {
  const t = (v ?? "").trim().toLowerCase();
  return t === "1" || t === "true" || t === "on" || t === "yes";
}

async function sendTestMessage(botToken: string, chatId: string, fetchFn: typeof fetch): Promise<CheckResult> {
  try {
    const res = await fetchFn(`${TG_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "✅ ape-signal doctor: Test-Nachricht — Bot→Chat funktioniert." }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (res.ok && data.ok) return { name: "Telegram test message", status: "ok", detail: "sent" };
    return { name: "Telegram test message", status: "fail", detail: data.description ?? `HTTP ${res.status}` };
  } catch (err) {
    return { name: "Telegram test message", status: "fail", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Run every applicable check and return the results, in display order. */
export async function runDoctor(deps: DoctorDeps): Promise<CheckResult[]> {
  const { source, fetchFn, claudeRunner } = deps;
  const results: CheckResult[] = [];
  results.push(checkRequiredEnv(source));
  results.push(await checkClaude(claudeRunner));

  const botToken = source.TELEGRAM_BOT_TOKEN;
  const chatId = source.TELEGRAM_CHAT_ID;
  if (botToken && chatId) {
    results.push(await checkTelegram(botToken, chatId, fetchFn));
    if (deps.sendTest) results.push(await sendTestMessage(botToken, chatId, fetchFn));
  }

  if (source.FINNHUB_API_KEY) results.push(await checkFinnhub(source.FINNHUB_API_KEY, fetchFn));
  results.push(await checkTradingView(fetchFn));
  if (isTruthy(source.ENABLE_REDDIT_CRAWL) && source.REDDIT_CLIENT_ID && source.REDDIT_CLIENT_SECRET) {
    results.push(await checkReddit(source.REDDIT_CLIENT_ID, source.REDDIT_CLIENT_SECRET, source.REDDIT_USER_AGENT ?? "ape-signal/doctor", fetchFn));
  }
  return results;
}
```

> Note the resulting display order is: Required env, Claude CLI, Telegram, [Telegram test message], [Finnhub], TradingView, [Reddit]. The default-case test asserts `["Required env", "Claude CLI", "Telegram", "TradingView"]`.

- [ ] **Step 4: Add the thin `main()` entrypoint at the END of `src/config/doctor.ts`**

Add these imports to the top of the file (with the others):

```ts
import { readFileSync, existsSync } from "node:fs";
import { spawnClaudeRunner } from "../claude/invoke";
```

Append at the end:

```ts
/** Resolve and read an env file into a record. Order: explicit path, /etc, ./.env. */
function loadEnvFile(explicit: string | undefined): Record<string, string> {
  const candidates = explicit ? [explicit] : ["/etc/ape-signal.env", "./.env"];
  for (const path of candidates) {
    if (existsSync(path)) {
      return parseEnvFile(readFileSync(path, "utf8"));
    }
  }
  return {};
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const envFileArg = args.find((a) => a.startsWith("--env-file="))?.slice("--env-file=".length);
  const sendTest = args.includes("--send-test");

  // File values fill only gaps — ambient/systemd env wins so we never clobber it.
  const fileEnv = loadEnvFile(envFileArg);
  for (const [k, v] of Object.entries(fileEnv)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  const results = await runDoctor({
    source: process.env,
    fetchFn: fetch,
    claudeRunner: (prompt) => withTimeout(spawnClaudeRunner(prompt), 60_000, "claude -p"),
    sendTest,
  });
  console.log(formatResults(results));
  process.exitCode = hasFailure(results) ? 1 : 0;
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith("doctor.ts")) {
  void main();
}
```

- [ ] **Step 5: Add the npm script**

In `package.json`, add to `"scripts"` (after `"listener"`):

```json
    "doctor": "tsx src/config/doctor.ts",
```

- [ ] **Step 6: Run tests + typecheck + a real smoke**

```bash
cd /c/Users/lmueller/ape-signal && npx vitest run src/config/doctor.test.ts && npm run typecheck
```
Expected: all doctor tests pass, typecheck clean.

Optional real smoke (will show ❌ for Telegram/Claude locally if unconfigured — that's expected):
```bash
cd /c/Users/lmueller/ape-signal && npm run doctor
```
Expected: prints the emoji result lines and exits.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/lmueller/ape-signal && git add src/config/doctor.ts src/config/doctor.test.ts package.json && git commit -m "feat(doctor): runDoctor orchestrator + entrypoint + npm script"
```

---

## Task 5: Polish `.env.example` + README quickstart (docs)

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

No tests (docs only). Verification is visual.

- [ ] **Step 1: Update `.env.example`**

Replace the top comment block and append two vars. The file should read:

```bash
# Ape Signal — environment template.
# Copy to /etc/ape-signal.env on the VPS (chmod 600). NEVER commit real values.
#
# PREREQUISITE — Claude needs NO key here. It runs via the Claude Code CLI under
# your subscription. Install the CLI and run `claude login` (paste the token) ONCE
# as the SAME OS user the systemd services run as. Verify with `npm run doctor`.

# Telegram (BotFather)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Finnhub (earnings + news) — optional; the briefing degrades without it.
FINNHUB_API_KEY=

# Reddit off-radar crawl via the Reddit OAuth API (opt-in).
# Create a "script" app at https://www.reddit.com/prefs/apps to get id + secret.
# Application-only OAuth (client_credentials) works from datacenter/VPS IPs,
# unlike scraping old.reddit.com which Reddit blocks by network policy.
ENABLE_REDDIT_CRAWL=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=ape-signal/0.1 (off-radar scan)
REDDIT_SUBREDDITS=wallstreetbets,wallstreetbetsGER,shortsqueeze

# Tuning (optional)
SCAN_LIMIT=15
# Where the listener persists its Telegram getUpdates offset.
OFFSET_PATH=/opt/ape-signal/.telegram-offset
```

- [ ] **Step 2: Add the README quickstart**

Open `README.md`, find a sensible spot near the top (after the project intro/heading), and insert this section verbatim:

```markdown
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

**Steps**
```bash
git clone --recurse-submodules https://github.com/lmuenet/ape-signal.git
cd ape-signal
./scripts/setup.sh            # installs deps + systemd units; creates /etc/ape-signal.env on first run
sudo nano /etc/ape-signal.env # fill in your Telegram (and optional) secrets
./scripts/setup.sh            # re-run: enables the services and validates everything
```

Validate config at any time:
```bash
npm run doctor                       # uses /etc/ape-signal.env or ./.env
npm run doctor -- --send-test        # also posts a visible Telegram test message
```

The scans run as systemd timers (Mon–Fri 08:45 & 15:15 Europe/Berlin); the
listener is a long-running service. See [`systemd/README.md`](systemd/README.md)
for the per-unit details.
```

- [ ] **Step 3: Verify rendering**

Run: `cd /c/Users/lmueller/ape-signal && npm run typecheck`
Expected: clean (no code changed, but confirms nothing broke). Eyeball the README section renders as intended.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/lmueller/ape-signal && git add .env.example README.md && git commit -m "docs: self-host quickstart + Claude-prerequisite + env tuning vars"
```

---

## Task 6: `scripts/setup.sh` (idempotent bootstrap)

**Files:**
- Create: `scripts/setup.sh`

No unit tests (bash). Verification: `bash -n` (syntax) + `--check` mode.

- [ ] **Step 1: Create the script**

Create `scripts/setup.sh`:

```bash
#!/usr/bin/env bash
# ape-signal self-host bootstrap (Debian/Ubuntu + systemd).
# Idempotent: re-runnable, never overwrites an existing /etc/ape-signal.env.
# Prerequisite: Claude Code CLI installed and logged in as THIS user.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_PATH="/etc/ape-signal.env"
UNIT_SRC="$REPO_DIR/systemd"
UNIT_DST="/etc/systemd/system"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

say()  { printf '\n=== %s ===\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

say "Checking prerequisites"
command -v git  >/dev/null 2>&1 || fail "git not found"
command -v node >/dev/null 2>&1 || fail "node not found (need >= 20)"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || fail "Node $(node -v) is too old; need >= 20"
command -v claude >/dev/null 2>&1 \
  || fail "claude CLI not found. Install Claude Code and run 'claude login' as this user."
echo "OK: git, node $(node -v), claude present"

if [ "$CHECK_ONLY" = "1" ]; then
  say "Running doctor (check-only)"
  npm --prefix "$REPO_DIR" run --silent doctor -- --env-file="$ENV_PATH" || true
  exit 0
fi

say "Fetching submodule + dependencies"
git -C "$REPO_DIR" submodule update --init --recursive
npm --prefix "$REPO_DIR" ci   # WITH dev deps: tsx is the runtime

if [ ! -f "$ENV_PATH" ]; then
  say "Creating $ENV_PATH from template"
  sudo cp "$REPO_DIR/.env.example" "$ENV_PATH"
  sudo chmod 600 "$ENV_PATH"
  echo "Created $ENV_PATH. Fill in your secrets, then re-run this script."
  exit 0
fi
echo "Found existing $ENV_PATH (left untouched)."

say "Installing systemd units"
sudo cp "$UNIT_SRC/ape-signal-scan@.service" "$UNIT_DST/"
sudo cp "$UNIT_SRC/ape-signal-scan-preopen.timer" "$UNIT_DST/"
sudo cp "$UNIT_SRC/ape-signal-scan-preus.timer" "$UNIT_DST/"
sudo cp "$UNIT_SRC/ape-signal-listener.service" "$UNIT_DST/"
sudo systemctl daemon-reload
sudo systemctl enable --now ape-signal-scan-preopen.timer ape-signal-scan-preus.timer
sudo systemctl enable --now ape-signal-listener.service

say "Validating configuration"
npm --prefix "$REPO_DIR" run --silent doctor -- --env-file="$ENV_PATH"

say "Done"
echo "Scans: Mon-Fri 08:45 & 15:15 Europe/Berlin. Listener: systemctl status ape-signal-listener"
```

- [ ] **Step 2: Make it executable + syntax-check**

```bash
cd /c/Users/lmueller/ape-signal && git update-index --add --chmod=+x scripts/setup.sh 2>/dev/null; chmod +x scripts/setup.sh 2>/dev/null; bash -n scripts/setup.sh && echo "syntax OK"
```
Expected: `syntax OK` (no parse errors). The `chmod`/`git update-index` ensure the executable bit is tracked (no-op on Windows filesystems — that's fine; Step 3 sets it explicitly).

- [ ] **Step 3: Ensure the executable bit is recorded in git**

```bash
cd /c/Users/lmueller/ape-signal && git add scripts/setup.sh && git update-index --chmod=+x scripts/setup.sh && git ls-files -s scripts/setup.sh
```
Expected: mode shows `100755` (executable) in the output.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/lmueller/ape-signal && git commit -m "feat(setup): idempotent self-host bootstrap script (Debian/Ubuntu + systemd)"
```

---

## Task 7: Full green gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `cd /c/Users/lmueller/ape-signal && npm test`
Expected: all tests pass — the original 117 plus the new doctor tests (env-file/timeout/format/hasFailure + the six checks + runDoctor).

- [ ] **Step 2: Typecheck**

Run: `cd /c/Users/lmueller/ape-signal && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm clean tree**

Run: `cd /c/Users/lmueller/ape-signal && git status`
Expected: clean (everything committed).

---

## Notes for the implementer

- **No new runtime deps** — `fetch`, `node:fs`, `node:child_process` are built in; `Buffer` is global in Node.
- **`main()` guard:** the `process.argv[1].endsWith("doctor.ts")` check keeps `main` from running during vitest imports. Under `tsx` the entry path ends in `doctor.ts`, so it runs when invoked via `npm run doctor`.
- **Env precedence:** the entrypoint fills only *missing* `process.env` keys from the file, so a value already exported (or injected by systemd) always wins.
- **Deploy (after merge):** this is dev-tooling/docs; nothing on the running VPS changes until the operator chooses to use `setup.sh`/`doctor`. The existing services are unaffected.
```
