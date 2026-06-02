# Plan 2: Reddit Off-Radar (via agent-browser) + Finnhub Earnings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the daily scan with (a) a "🔥 Reddit Off-Radar" section — tickers buzzing on r/wallstreetbets, r/wallstreetbetsGER, r/shortsqueeze that are NOT already in the Apewisdom ranked list, each challenged by Claude — and (b) an "📅 Earnings today" section from Finnhub.

**Architecture:** The Reddit crawl uses **[agent-browser](https://github.com/vercel-labs/agent-browser)** (Vercel Labs) — a native browser-automation CLI installed via npm (`npm i -g agent-browser`). A Node wrapper (`src/reddit/agentBrowser.ts`) spawns the CLI to `open` each public `old.reddit.com` "hot" page and `eval` a small `querySelectorAll('div.thing')` script that returns posts as JSON (`{title, score, comments}`). The runner is dependency-injected, so Node stays unit-testable. A ticker extractor tallies mentions; off-radar candidates (not in Apewisdom) are mapped to `TrendingRow`-shaped entries and merged into the SINGLE existing Claude challenge (one `claude -p` call). The formatter splits verdicts into Apewisdom vs Off-Radar by origin. Finnhub supplies same-day earnings.

**Why agent-browser (vs crawl4ai/Playwright or the Reddit OAuth JSON API):** pure npm install (no Python, no Playwright, no Reddit API app); a real Chrome renders the page so it is resilient to bot walls; the `eval` command gives us structured extraction in one shot. All Reddit/Finnhub features are OPTIONAL in the pipeline, so Plan 1's behaviour is unchanged when they are disabled/absent.

**Tech Stack:** TypeScript, tsx, vitest, Node `child_process`; `agent-browser` CLI (runtime only, on the VPS); Finnhub (`fetchNextEarnings` from the submodule).

**Backward-compat invariant:** `formatReport(rows, challenge, meta)` keeps its 3-arg shape; new behaviour rides on optional `ReportMeta` fields, so existing Plan 1 tests stay green. The pipeline's reddit/earnings deps are optional, and a reddit-crawl failure is caught so the scan still delivers.

---

## Prerequisites (for the final manual run only — NOT for unit tasks)

On the machine that runs the live scan (your VPS, or locally for a smoke test):
```bash
npm install -g agent-browser
agent-browser install        # downloads Chrome for Testing
```
Tasks 1–8 are pure Node TDD and need none of this. Only Task 9 (manual run) uses the real `agent-browser` CLI.

**agent-browser command crib** (verify against your installed version — `agent-browser --help`):
- `agent-browser --session <name> open <url>` — navigate
- `agent-browser --session <name> eval "<js>"` — run JS, print the returned value
The Node↔CLI boundary is the stable JSON contract `Record<sub, RawRedditPost[]>`; if a flag differs in your version, adjust the wrapper, not the contract.

---

## File Structure

| Path | Responsibility | New/Mod |
|---|---|---|
| `src/config/env.ts` | telegram (required) + optional finnhub + `ENABLE_REDDIT_CRAWL` flag + `requireFinnhub` | Mod |
| `src/reddit/agentBrowser.ts` | spawn `agent-browser` (injectable runner) + normalise posts (`toPosts`, `parseScore`, `parseEvalJson`) | New |
| `src/reddit/tickers.ts` | `extractTickers` + `tallyTickers` | New |
| `src/reddit/crawl.ts` | `crawlReddit` — run crawl → tally → ranked candidates | New |
| `src/scan/offradar.ts` | `offRadar` — filter candidates not in Apewisdom, by min mentions | New |
| `src/scan/earnings.ts` | `fetchEarningsToday` — same-day earnings for given tickers | New |
| `src/core/ape-intel.ts` | add `fetchNextEarnings` + `EarningsDate` re-exports | Mod |
| `src/scan/format.ts` | split Off-Radar section + Earnings section via `ReportMeta` | Mod |
| `src/scan/pipeline.ts` | merge off-radar into the single challenge; collect earnings; tolerate crawl failure | Mod |
| `src/scan/index.ts` | wire agent-browser + finnhub deps from env | Mod |
| `.env.example` | reddit-crawl flags (no OAuth) | Mod |

---

## Task 1: Env loader (optional finnhub + reddit-crawl flag)

**Files:** Modify `src/config/env.ts`, `src/config/env.test.ts`, `.env.example`

- [ ] **Step 1: Add failing tests** (append to `src/config/env.test.ts`)

```ts
// add to src/config/env.test.ts
import { loadEnv, requireFinnhub } from "./env";

describe("optional finnhub + reddit-crawl flag", () => {
  it("passes through finnhub key and reddit-crawl flag", () => {
    const cfg = loadEnv({
      TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c",
      FINNHUB_API_KEY: "fk", ENABLE_REDDIT_CRAWL: "1",
    });
    expect(cfg.finnhubApiKey).toBe("fk");
    expect(cfg.redditCrawlEnabled).toBe(true);
  });

  it("defaults reddit-crawl flag to false", () => {
    const cfg = loadEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });
    expect(cfg.redditCrawlEnabled).toBe(false);
  });

  it("requireFinnhub throws when key missing", () => {
    const cfg = loadEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });
    expect(() => requireFinnhub(cfg)).toThrow(/FINNHUB_API_KEY/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/config/env.test.ts`.

- [ ] **Step 3: Implement** — replace `src/config/env.ts` with:

```ts
// src/config/env.ts
export interface Env {
  telegramBotToken: string;
  telegramChatId: string;
  finnhubApiKey?: string;
  redditCrawlEnabled: boolean;
}

const REQUIRED = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;

function val(source: Record<string, string | undefined>, key: string): string | undefined {
  const v = source[key];
  return v && v.trim() !== "" ? v : undefined;
}

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t === "1" || t === "true" || t === "on" || t === "yes";
}

/**
 * Validate and shape the process environment. Telegram vars are required;
 * finnhub is optional (validated on demand by requireFinnhub); the reddit crawl
 * is opt-in via ENABLE_REDDIT_CRAWL so Plan 1 behaviour is the default.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing = REQUIRED.filter((k) => val(source, k) === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    telegramBotToken: source.TELEGRAM_BOT_TOKEN!,
    telegramChatId: source.TELEGRAM_CHAT_ID!,
    finnhubApiKey: val(source, "FINNHUB_API_KEY"),
    redditCrawlEnabled: truthy(source.ENABLE_REDDIT_CRAWL),
  };
}

/** Throw unless the Finnhub key is present; returns it. */
export function requireFinnhub(env: Env): string {
  if (!env.finnhubApiKey) throw new Error("Missing finnhub environment variable: FINNHUB_API_KEY");
  return env.finnhubApiKey;
}
```

- [ ] **Step 4: Update `.env.example`** — replace its contents with:

```
# Ape Signal — environment template.
# Copy to /etc/ape-signal.env on the VPS (chmod 600). NEVER commit real values.
# Claude needs NO key here — it runs via `claude login` (subscription).

# Telegram (BotFather)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Finnhub (earnings + news)
FINNHUB_API_KEY=

# Reddit crawl via agent-browser (opt-in; requires `npm i -g agent-browser && agent-browser install`)
ENABLE_REDDIT_CRAWL=
REDDIT_SUBREDDITS=wallstreetbets,wallstreetbetsGER,shortsqueeze
AGENT_BROWSER_BIN=agent-browser
```

- [ ] **Step 5: Run, expect PASS**, then commit.

```bash
git add src/config/env.ts src/config/env.test.ts .env.example
git commit -m "feat: env finnhub key + reddit-crawl opt-in flag"
```

---

## Task 2: agent-browser wrapper

**Files:** Create `src/reddit/agentBrowser.ts`; Test `src/reddit/agentBrowser.test.ts`

The `spawnAgentBrowser` runner is validated by the manual run (Task 9), same policy as the `claude -p` spawn path. The pure helpers (`parseScore`, `toPosts`, `parseEvalJson`) are unit-tested here.

- [ ] **Step 1: Write failing test**

```ts
// src/reddit/agentBrowser.test.ts
import { describe, it, expect } from "vitest";
import { parseScore, toPosts, parseEvalJson } from "./agentBrowser";

describe("parseScore", () => {
  it("parses plain, k and m suffixes; hidden/garbage -> 0", () => {
    expect(parseScore("12")).toBe(12);
    expect(parseScore("1.2k")).toBe(1200);
    expect(parseScore("3M")).toBe(3_000_000);
    expect(parseScore("•")).toBe(0);
    expect(parseScore(undefined)).toBe(0);
  });
});

describe("toPosts", () => {
  it("normalises raw posts and drops title-less rows", () => {
    const posts = toPosts([
      { title: "$GME squeeze", score: "1.2k", comments: "45 comments" },
      { score: "5", comments: "0 comments" },
      { title: "KSS run", score: "•", comments: "1 comment" },
    ]);
    expect(posts).toEqual([
      { title: "$GME squeeze", selftext: "", score: 1200, numComments: 45 },
      { title: "KSS run", selftext: "", score: 0, numComments: 1 },
    ]);
  });
});

describe("parseEvalJson", () => {
  const arr = [{ title: "$GME", score: "5", comments: "1 comment" }];
  it("parses a raw JSON array printed by eval", () => {
    expect(parseEvalJson(JSON.stringify(arr))).toEqual(arr);
  });
  it("parses a double-encoded JSON string (eval returned a string)", () => {
    expect(parseEvalJson(JSON.stringify(JSON.stringify(arr)))).toEqual(arr);
  });
  it("parses a {result: ...} wrapper (--json style)", () => {
    expect(parseEvalJson(JSON.stringify({ result: JSON.stringify(arr) }))).toEqual(arr);
    expect(parseEvalJson(JSON.stringify({ result: arr }))).toEqual(arr);
  });
  it("recovers an array embedded in surrounding log noise", () => {
    expect(parseEvalJson(`some log\n${JSON.stringify(arr)}\nbye`)).toEqual(arr);
  });
  it("returns [] when no array can be found", () => {
    expect(parseEvalJson("no json here")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — cannot resolve `./agentBrowser`.

- [ ] **Step 3: Implement**

```ts
// src/reddit/agentBrowser.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RawRedditPost {
  title?: string;
  score?: string;
  comments?: string;
}

export interface RedditPost {
  title: string;
  selftext: string;
  score: number;
  numComments: number;
}

export type CrawlRunner = (subreddits: string[]) => Promise<Record<string, RawRedditPost[]>>;

export interface AgentBrowserConfig {
  bin: string; // e.g. "agent-browser"
  session: string; // isolated browser session name
}

// JS evaluated on old.reddit.com to return posts as a JSON string.
const EXTRACT_JS =
  "JSON.stringify(Array.from(document.querySelectorAll('div.thing')).map(function(t){" +
  "var a=t.querySelector('a.title');var s=t.querySelector('.score.unvoted');var c=t.querySelector('a.comments');" +
  "return{title:a&&a.innerText,score:s&&s.innerText,comments:c&&c.innerText};}))";

/** Parse reddit score text ("1.2k", "12", "3M", "•"/hidden) into an integer. */
export function parseScore(text: string | undefined): number {
  if (!text) return 0;
  const m = text.trim().toLowerCase().match(/^([\d.]+)\s*(k|m)?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return 0;
  const mult = m[2] === "k" ? 1000 : m[2] === "m" ? 1_000_000 : 1;
  return Math.round(n * mult);
}

function parseComments(text: string | undefined): number {
  if (!text) return 0;
  const m = text.match(/(\d[\d,]*)/);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

/** Normalise raw posts; drop rows without a title. */
export function toPosts(raw: RawRedditPost[]): RedditPost[] {
  return raw
    .filter((p) => typeof p.title === "string" && p.title.trim() !== "")
    .map((p) => ({
      title: p.title!.trim(),
      selftext: "",
      score: parseScore(p.score),
      numComments: parseComments(p.comments),
    }));
}

/**
 * Robustly extract the posts array from `agent-browser eval` stdout. Handles:
 * a raw JSON array, a double-encoded JSON string, a `{result: …}` wrapper, and
 * an array embedded in surrounding log noise. Returns [] if nothing parses.
 */
export function parseEvalJson(stdout: string): RawRedditPost[] {
  const asArray = (v: unknown): RawRedditPost[] | null => (Array.isArray(v) ? (v as RawRedditPost[]) : null);
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  let parsed = tryParse(stdout.trim());
  if (typeof parsed === "string") parsed = tryParse(parsed); // double-encoded
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "result" in (parsed as object)) {
    const r = (parsed as { result: unknown }).result;
    parsed = typeof r === "string" ? tryParse(r) : r;
  }
  const direct = asArray(parsed);
  if (direct) return direct;

  // Fallback: widest [...] span in the output.
  const first = stdout.indexOf("[");
  const last = stdout.lastIndexOf("]");
  if (first !== -1 && last > first) {
    const span = asArray(tryParse(stdout.slice(first, last + 1)));
    if (span) return span;
  }
  return [];
}

/**
 * Default runner: drive the agent-browser CLI to open each subreddit's hot page
 * and eval the extraction script. A subreddit that errors yields [] (so one bad
 * sub never aborts the crawl).
 */
export function spawnAgentBrowser(config: AgentBrowserConfig): CrawlRunner {
  return async (subreddits) => {
    const out: Record<string, RawRedditPost[]> = {};
    for (const sub of subreddits) {
      const url = `https://old.reddit.com/r/${sub}/hot/`;
      try {
        await execFileAsync(config.bin, ["--session", config.session, "open", url]);
        const { stdout } = await execFileAsync(
          config.bin,
          ["--session", config.session, "eval", EXTRACT_JS],
          { maxBuffer: 8 * 1024 * 1024 },
        );
        out[sub] = parseEvalJson(stdout);
      } catch (err) {
        console.error(`[agent-browser] ${sub}: ${err instanceof Error ? err.message : String(err)}`);
        out[sub] = [];
      }
    }
    return out;
  };
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/reddit/agentBrowser.ts src/reddit/agentBrowser.test.ts
git commit -m "feat: agent-browser node wrapper (spawn + post/eval parsing)"
```

---

## Task 3: Ticker extraction + tally

**Files:** Create `src/reddit/tickers.ts`; Test `src/reddit/tickers.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/reddit/tickers.test.ts
import { describe, it, expect } from "vitest";
import { extractTickers, tallyTickers } from "./tickers";
import type { RedditPost } from "./agentBrowser";

describe("extractTickers", () => {
  it("extracts cashtags case-insensitively", () => {
    expect(extractTickers("buying $gme and $AMC today")).toEqual(expect.arrayContaining(["GME", "AMC"]));
  });
  it("extracts bare uppercase tickers but drops common stopwords", () => {
    const out = extractTickers("KSS looks good but YOLO and the CEO said DD on FDA");
    expect(out).toContain("KSS");
    expect(out).not.toContain("YOLO");
    expect(out).not.toContain("CEO");
    expect(out).not.toContain("DD");
    expect(out).not.toContain("FDA");
  });
  it("dedupes within a single text", () => {
    expect(extractTickers("$GME $GME GME")).toEqual(["GME"]);
  });
});

describe("tallyTickers", () => {
  it("counts mentions across posts and sums score", () => {
    const posts: RedditPost[] = [
      { title: "$KSS squeeze", selftext: "KSS again", score: 50, numComments: 5 },
      { title: "boring", selftext: "$KSS once more", score: 20, numComments: 2 },
    ];
    const tally = tallyTickers(posts);
    expect(tally.get("KSS")).toEqual({ mentions: 2, score: 70 });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — cannot resolve `./tickers`.

- [ ] **Step 3: Implement**

```ts
// src/reddit/tickers.ts
import type { RedditPost } from "./agentBrowser";

// High-frequency uppercase words that are NOT tickers (WSB slang / finance acronyms).
const STOPWORDS = new Set<string>([
  "THE", "AND", "FOR", "ARE", "BUT", "NOT", "YOU", "ALL", "CAN", "HAS", "WAS",
  "YOLO", "DD", "WSB", "CEO", "CFO", "FDA", "SEC", "USA", "US", "IT", "OR", "ON",
  "IN", "TO", "BE", "DOW", "CPI", "FED", "ETF", "IPO", "EPS", "ATH", "ATM", "IMO",
  "AI", "EV", "PUT", "PUTS", "CALL", "CALLS", "BUY", "SELL", "HOLD", "HODL", "TLDR",
  "EOD", "PM", "AM", "GDP", "ROI", "PE", "EOY", "YTD", "FOMO", "RH", "OG", "LOL",
]);

const CASHTAG = /\$([A-Za-z]{1,5})\b/g;
const BARE = /\b([A-Z]{2,5})\b/g;

/** Extract candidate tickers from one text: cashtags (any case) + bare CAPS minus stopwords. Deduped, uppercased. */
export function extractTickers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CASHTAG)) out.add(m[1].toUpperCase());
  for (const m of text.matchAll(BARE)) {
    const t = m[1];
    if (!STOPWORDS.has(t)) out.add(t);
  }
  return [...out];
}

export interface TickerStat {
  mentions: number; // number of posts mentioning the ticker
  score: number; // summed reddit score of those posts
}

/** Tally tickers across posts. A ticker mentioned multiple times in one post counts once for that post. */
export function tallyTickers(posts: RedditPost[]): Map<string, TickerStat> {
  const tally = new Map<string, TickerStat>();
  for (const post of posts) {
    const tickers = new Set(extractTickers(`${post.title} ${post.selftext}`));
    for (const t of tickers) {
      const prev = tally.get(t) ?? { mentions: 0, score: 0 };
      tally.set(t, { mentions: prev.mentions + 1, score: prev.score + post.score });
    }
  }
  return tally;
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/reddit/tickers.ts src/reddit/tickers.test.ts
git commit -m "feat: reddit ticker extraction + tally"
```

---

## Task 4: Reddit crawl orchestrator

**Files:** Create `src/reddit/crawl.ts`; Test `src/reddit/crawl.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/reddit/crawl.test.ts
import { describe, it, expect, vi } from "vitest";
import { crawlReddit } from "./crawl";
import type { RawRedditPost } from "./agentBrowser";

describe("crawlReddit", () => {
  it("runs the crawl, tallies across subreddits, returns mention-sorted candidates", async () => {
    const raw: Record<string, RawRedditPost[]> = {
      wallstreetbets: [{ title: "$KSS squeeze", score: "50", comments: "5 comments" }],
      shortsqueeze: [
        { title: "$KSS again", score: "30", comments: "2 comments" },
        { title: "$BBBY revival", score: "10", comments: "1 comment" },
      ],
    };
    const run = vi.fn(async () => raw);

    const candidates = await crawlReddit({ subreddits: ["wallstreetbets", "shortsqueeze"] }, { run });

    expect(run).toHaveBeenCalledWith(["wallstreetbets", "shortsqueeze"]);
    expect(candidates[0]).toEqual({ ticker: "KSS", mentions: 2, score: 80 });
    expect(candidates.find((c) => c.ticker === "BBBY")).toEqual({ ticker: "BBBY", mentions: 1, score: 10 });
  });

  it("treats a missing subreddit key as empty", async () => {
    const run = vi.fn(async () => ({ wallstreetbets: [{ title: "$GME", score: "5", comments: "1 comment" }] }));
    const candidates = await crawlReddit({ subreddits: ["wallstreetbets", "absent"] }, { run });
    expect(candidates).toEqual([{ ticker: "GME", mentions: 1, score: 5 }]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — cannot resolve `./crawl`.

- [ ] **Step 3: Implement**

```ts
// src/reddit/crawl.ts
import { toPosts, type CrawlRunner } from "./agentBrowser";
import { tallyTickers, type TickerStat } from "./tickers";

export interface RedditCandidate {
  ticker: string;
  mentions: number;
  score: number;
}

export interface CrawlOptions {
  subreddits: string[];
}

export interface CrawlDeps {
  run: CrawlRunner;
}

/**
 * Run the crawl (agent-browser under the hood), normalise each subreddit's
 * posts, tally tickers across all of them, and return candidates sorted by
 * mentions (desc) then score (desc). Per-subreddit errors are already swallowed
 * inside the runner (it returns [] for a failed sub).
 */
export async function crawlReddit(
  options: CrawlOptions,
  deps: CrawlDeps,
): Promise<RedditCandidate[]> {
  const bySub = await deps.run(options.subreddits);
  const merged = new Map<string, TickerStat>();
  for (const sub of options.subreddits) {
    for (const [ticker, stat] of tallyTickers(toPosts(bySub[sub] ?? []))) {
      const prev = merged.get(ticker) ?? { mentions: 0, score: 0 };
      merged.set(ticker, { mentions: prev.mentions + stat.mentions, score: prev.score + stat.score });
    }
  }
  return [...merged.entries()]
    .map(([ticker, stat]) => ({ ticker, mentions: stat.mentions, score: stat.score }))
    .sort((a, b) => b.mentions - a.mentions || b.score - a.score);
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/reddit/crawl.ts src/reddit/crawl.test.ts
git commit -m "feat: reddit crawl orchestrator over agent-browser runner"
```

---

## Task 5: Off-radar diff

**Files:** Create `src/scan/offradar.ts`; Test `src/scan/offradar.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/scan/offradar.test.ts
import { describe, it, expect } from "vitest";
import { offRadar } from "./offradar";
import type { RedditCandidate } from "../reddit/crawl";

const candidates: RedditCandidate[] = [
  { ticker: "GME", mentions: 9, score: 900 },
  { ticker: "KSS", mentions: 4, score: 300 },
  { ticker: "BBBY", mentions: 1, score: 10 },
];

describe("offRadar", () => {
  it("keeps reddit candidates not in apewisdom and above the mention threshold", () => {
    const known = new Set(["GME", "TSLA"]);
    expect(offRadar(candidates, known, { minMentions: 2, limit: 10 }).map((c) => c.ticker)).toEqual(["KSS"]);
  });

  it("applies the limit", () => {
    const many: RedditCandidate[] = [
      { ticker: "AAA", mentions: 5, score: 1 },
      { ticker: "BBB", mentions: 4, score: 1 },
      { ticker: "CCC", mentions: 3, score: 1 },
    ];
    expect(offRadar(many, new Set(), { minMentions: 2, limit: 2 })).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — cannot resolve `./offradar`.

- [ ] **Step 3: Implement**

```ts
// src/scan/offradar.ts
import type { RedditCandidate } from "../reddit/crawl";

export interface OffRadarOptions {
  minMentions: number;
  limit: number;
}

/**
 * Candidates worth surfacing: buzzing on reddit, NOT already in the Apewisdom
 * ranked list, and above a mention threshold (noise guard). Input is assumed
 * mention-sorted (crawlReddit guarantees this); the limit takes the top N.
 */
export function offRadar(
  candidates: RedditCandidate[],
  knownTickers: Set<string>,
  options: OffRadarOptions,
): RedditCandidate[] {
  return candidates
    .filter((c) => !knownTickers.has(c.ticker) && c.mentions >= options.minMentions)
    .slice(0, options.limit);
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/scan/offradar.ts src/scan/offradar.test.ts
git commit -m "feat: off-radar diff (reddit minus apewisdom)"
```

---

## Task 6: Earnings-today helper (Finnhub) + barrel export

**Files:** Modify `src/core/ape-intel.ts`; Create `src/scan/earnings.ts`; Test `src/scan/earnings.test.ts`

- [ ] **Step 1: Extend the barrel** (append to `src/core/ape-intel.ts`)

```ts
// append to src/core/ape-intel.ts
export {
  fetchNextEarnings,
} from "../../vendor/ape-intel/src/lib/finnhub";
export type {
  EarningsDate,
} from "../../vendor/ape-intel/src/lib/finnhub";
```

- [ ] **Step 2: Write failing test**

```ts
// src/scan/earnings.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchEarningsToday } from "./earnings";

describe("fetchEarningsToday", () => {
  it("returns only tickers whose next earnings date is today", async () => {
    const today = "2026-06-02";
    const now = new Date(`${today}T08:00:00Z`).getTime();
    const fetchEarnings = vi.fn(async (ticker: string) => {
      if (ticker === "AAPL") return { date: today, epsEstimate: 1.2 };
      if (ticker === "TSLA") return { date: "2026-07-01", epsEstimate: null };
      return null;
    });
    const out = await fetchEarningsToday(["AAPL", "TSLA", "GME"], { fetchEarnings, now });
    expect(out).toEqual([{ ticker: "AAPL", date: today, epsEstimate: 1.2 }]);
  });

  it("tolerates per-ticker fetch errors", async () => {
    const today = "2026-06-02";
    const now = new Date(`${today}T08:00:00Z`).getTime();
    const fetchEarnings = vi.fn(async (ticker: string) => {
      if (ticker === "BOOM") throw new Error("500");
      return { date: today, epsEstimate: null };
    });
    const out = await fetchEarningsToday(["BOOM", "AAPL"], { fetchEarnings, now });
    expect(out.map((e) => e.ticker)).toEqual(["AAPL"]);
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — cannot resolve `./earnings`.

- [ ] **Step 4: Implement**

```ts
// src/scan/earnings.ts
import type { EarningsDate } from "../core/ape-intel";

export interface EarningsRow {
  ticker: string;
  date: string;
  epsEstimate: number | null;
}

export interface EarningsDeps {
  fetchEarnings: (ticker: string) => Promise<EarningsDate | null>;
  now: number;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** For each ticker, keep it only if its NEXT earnings date equals today. Per-ticker errors are skipped. */
export async function fetchEarningsToday(
  tickers: string[],
  deps: EarningsDeps,
): Promise<EarningsRow[]> {
  const today = ymd(deps.now);
  const rows: EarningsRow[] = [];
  for (const ticker of tickers) {
    try {
      const next = await deps.fetchEarnings(ticker);
      if (next && next.date === today) {
        rows.push({ ticker, date: next.date, epsEstimate: next.epsEstimate });
      }
    } catch (err) {
      console.error(`[earnings] ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return rows;
}
```

- [ ] **Step 5: Run, expect PASS**, then `npx tsc --noEmit`. Commit.

```bash
git add src/core/ape-intel.ts src/scan/earnings.ts src/scan/earnings.test.ts
git commit -m "feat: finnhub earnings-today helper + barrel export"
```

---

## Task 7: Format Off-Radar + Earnings sections

**Files:** Modify `src/scan/format.ts`; Modify `src/scan/format.test.ts`

- [ ] **Step 1: Add failing tests** (append to `src/scan/format.test.ts`)

```ts
// add to src/scan/format.test.ts
import type { EarningsRow } from "./earnings";

describe("formatReport off-radar + earnings", () => {
  const allRows: TrendingRow[] = [
    { ticker: "GME", rank: 1, mentions: 500, mentions24hAgo: 600 },
    { ticker: "KSS", rank: 16, mentions: 4, mentions24hAgo: 4 },
  ];
  const ch: TrendingChallenge = {
    summary: "s",
    verdicts: [
      { ticker: "GME", verdict: "noise", thesis: "meme" },
      { ticker: "KSS", verdict: "watch", thesis: "low-float squeeze setup" },
    ],
  };

  it("renders an Off-Radar section for reddit-origin tickers", () => {
    const out = formatReport(allRows, ch, { label: "Morning", offRadarTickers: ["KSS"] });
    expect(out).toContain("Off-Radar");
    const offIdx = out.indexOf("Off-Radar");
    expect(out.indexOf("KSS")).toBeGreaterThan(offIdx);
    expect(out.indexOf("GME")).toBeLessThan(offIdx);
  });

  it("renders an Earnings today section when provided", () => {
    const earnings: EarningsRow[] = [{ ticker: "GME", date: "2026-06-02", epsEstimate: 0.1 }];
    const out = formatReport(allRows, ch, { label: "Morning", earningsToday: earnings });
    expect(out).toContain("Earnings today");
    expect(out).toContain("GME");
    expect(out).toContain("0.1");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `offRadarTickers`/`earningsToday` not in `ReportMeta`.

- [ ] **Step 3: Implement** — replace `src/scan/format.ts` with:

```ts
// src/scan/format.ts
import type { TrendingRow, TrendingChallenge, TickerVerdict, Verdict } from "../core/ape-intel";
import type { EarningsRow } from "./earnings";

export interface ReportMeta {
  label: string; // e.g. "Morning" / "Pre-US"
  offRadarTickers?: string[]; // reddit-origin tickers to break out into their own section
  earningsToday?: EarningsRow[];
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

function verdictLine(v: TickerVerdict, byTicker: Map<string, TrendingRow>): string[] {
  const r = byTicker.get(v.ticker);
  const meta = r ? ` (#${r.rank}, ${r.mentions} ${trendArrow(r)})` : "";
  const thesis = v.thesis ? ` — ${v.thesis}` : "";
  const lines = [`${VERDICT_SYMBOL[v.verdict]} ${v.ticker}${meta}${thesis}`];
  if (v.watch) lines.push(`   👁 watch: ${v.watch}`);
  lines.push("");
  return lines;
}

/** Render a compact, mobile-friendly report. Plain text (no Markdown parse mode). */
export function formatReport(
  rows: TrendingRow[],
  challenge: TrendingChallenge,
  meta: ReportMeta,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`📊 Ape Signal — ${meta.label} scan (${date})`, ""];
  if (challenge.summary) lines.push(challenge.summary, "");

  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  const offSet = new Set(meta.offRadarTickers ?? []);

  if (challenge.verdicts.length === 0) {
    lines.push("(no challenge available — raw trending list)", "");
    for (const r of rows) {
      lines.push(`#${r.rank} ${r.ticker} — ${r.mentions} mentions ${trendArrow(r)}`);
    }
    lines.push("");
  } else {
    const main = challenge.verdicts.filter((v) => !offSet.has(v.ticker));
    const off = challenge.verdicts.filter((v) => offSet.has(v.ticker));
    for (const v of main) lines.push(...verdictLine(v, byTicker));
    if (off.length > 0) {
      lines.push("🔥 Reddit Off-Radar (not in trending list)", "");
      for (const v of off) lines.push(...verdictLine(v, byTicker));
    }
  }

  if (meta.earningsToday && meta.earningsToday.length > 0) {
    lines.push("📅 Earnings today", "");
    for (const e of meta.earningsToday) {
      const eps = e.epsEstimate === null ? "" : ` (est EPS ${e.epsEstimate})`;
      lines.push(`• ${e.ticker}${eps}`);
    }
    lines.push("");
  }

  lines.push("For personal research — not financial advice.");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run, expect PASS** — old + new format tests.

- [ ] **Step 5: Commit**

```bash
git add src/scan/format.ts src/scan/format.test.ts
git commit -m "feat: report off-radar + earnings-today sections"
```

---

## Task 8: Wire reddit + earnings into the pipeline

**Files:** Modify `src/scan/pipeline.ts`; Modify `src/scan/pipeline.test.ts`

- [ ] **Step 1: Add failing tests** (append to `src/scan/pipeline.test.ts`)

```ts
// add to src/scan/pipeline.test.ts
import type { RedditCandidate } from "../reddit/crawl";
import type { EarningsRow } from "../scan/earnings";

describe("runScan with reddit + earnings", () => {
  it("challenges off-radar reddit tickers and labels them in the report", async () => {
    const fetchSnapshot = vi.fn(async () =>
      new Map([["GME", { rank: 1, mentions: 500, mentions24hAgo: 600 }]]) as ApewisdomSnapshot,
    );
    const crawlReddit = vi.fn(async (): Promise<RedditCandidate[]> => [
      { ticker: "KSS", mentions: 5, score: 300 },
    ]);
    const fetchEarningsToday = vi.fn(async (): Promise<EarningsRow[]> => []);
    const claudeRunner = vi.fn(async () =>
      '```json\n{"summary":"x","verdicts":[{"ticker":"GME","verdict":"noise"},{"ticker":"KSS","verdict":"watch","thesis":"squeeze"}]}\n```',
    );
    const send = vi.fn(async () => {});

    await runScan(
      { label: "Morning", limit: 10, offRadarMinMentions: 2, offRadarLimit: 5 },
      { fetchSnapshot, claudeRunner, send, crawlReddit, fetchEarningsToday },
    );

    expect(claudeRunner.mock.calls[0][0]).toContain("KSS");
    const msg = send.mock.calls[0][0] as string;
    expect(msg).toContain("Off-Radar");
    expect(msg).toContain("KSS");
  });

  it("still sends a report if the reddit crawl throws", async () => {
    const fetchSnapshot = vi.fn(async () =>
      new Map([["GME", { rank: 1, mentions: 500, mentions24hAgo: 600 }]]) as ApewisdomSnapshot,
    );
    const crawlReddit = vi.fn(async (): Promise<RedditCandidate[]> => {
      throw new Error("agent-browser down");
    });
    const claudeRunner = vi.fn(async () =>
      '```json\n{"summary":"x","verdicts":[{"ticker":"GME","verdict":"noise"}]}\n```',
    );
    const send = vi.fn(async () => {});

    await runScan({ label: "Morning", limit: 10 }, { fetchSnapshot, claudeRunner, send, crawlReddit });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("GME");
  });

  it("works exactly like Plan 1 when reddit + earnings deps are omitted", async () => {
    const fetchSnapshot = vi.fn(async () =>
      new Map([["GME", { rank: 1, mentions: 500, mentions24hAgo: 600 }]]) as ApewisdomSnapshot,
    );
    const claudeRunner = vi.fn(async () => "no json");
    const send = vi.fn(async () => {});
    await runScan({ label: "Morning", limit: 10 }, { fetchSnapshot, claudeRunner, send });
    expect(send.mock.calls[0][0]).toContain("GME");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `runScan` does not accept the new options/deps.

- [ ] **Step 3: Implement** — replace `src/scan/pipeline.ts` with:

```ts
// src/scan/pipeline.ts
import {
  buildTrendingClipboardPayload,
  parseTrendingChallenge,
  type ApewisdomSnapshot,
  type TrendingChallenge,
  type TrendingRow,
} from "../core/ape-intel";
import { snapshotToRows } from "./trending";
import { formatReport } from "./format";
import { offRadar } from "./offradar";
import type { RedditCandidate } from "../reddit/crawl";
import type { EarningsRow } from "./earnings";

export interface ScanOptions {
  label: string;
  limit: number;
  offRadarMinMentions?: number;
  offRadarLimit?: number;
}

export interface ScanDeps {
  fetchSnapshot: () => Promise<ApewisdomSnapshot>;
  claudeRunner: (prompt: string) => Promise<string>;
  send: (text: string) => Promise<void>;
  crawlReddit?: () => Promise<RedditCandidate[]>;
  fetchEarningsToday?: (tickers: string[]) => Promise<EarningsRow[]>;
}

/**
 * One scan run: fetch Apewisdom trending → (optionally) crawl reddit for
 * off-radar candidates → challenge the COMBINED list via one Claude call →
 * (optionally) attach today's earnings → format (off-radar in its own section)
 * → send. Reddit/earnings are optional; a reddit-crawl failure is logged and
 * the scan continues without off-radar. Without the deps this behaves exactly
 * like Plan 1.
 */
export async function runScan(
  options: ScanOptions,
  deps: ScanDeps,
): Promise<TrendingChallenge> {
  const snapshot = await deps.fetchSnapshot();
  const rows = snapshotToRows(snapshot, options.limit);
  const knownTickers = new Set(snapshot.keys());

  let offRadarRows: TrendingRow[] = [];
  if (deps.crawlReddit) {
    try {
      const candidates = await deps.crawlReddit();
      const picked = offRadar(candidates, knownTickers, {
        minMentions: options.offRadarMinMentions ?? 2,
        limit: options.offRadarLimit ?? 5,
      });
      offRadarRows = picked.map((c, i) => ({
        ticker: c.ticker,
        rank: rows.length + i + 1,
        mentions: c.mentions,
        mentions24hAgo: c.mentions, // reddit has no 24h delta → flat
      }));
    } catch (err) {
      console.error(`[scan] reddit crawl failed, continuing without off-radar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const combined = [...rows, ...offRadarRows];
  const payload = buildTrendingClipboardPayload(combined);
  const raw = await deps.claudeRunner(payload);
  const challenge = parseTrendingChallenge(raw) ?? { summary: "", verdicts: [] };

  const earningsToday = deps.fetchEarningsToday
    ? await deps.fetchEarningsToday(combined.map((r) => r.ticker))
    : undefined;

  const report = formatReport(combined, challenge, {
    label: options.label,
    offRadarTickers: offRadarRows.map((r) => r.ticker),
    earningsToday,
  });
  await deps.send(report);

  return challenge;
}
```

- [ ] **Step 4: Run, expect PASS** — pipeline tests (old + new), then full suite `npx vitest run` + `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/scan/pipeline.ts src/scan/pipeline.test.ts
git commit -m "feat: pipeline integrates reddit off-radar + earnings (resilient, optional)"
```

---

## Task 9: Entry wiring + manual run

**Files:** Modify `src/scan/index.ts`

- [ ] **Step 1: Replace `src/scan/index.ts`** with:

```ts
// src/scan/index.ts
import { loadEnv, requireFinnhub } from "../config/env";
import { fetchApewisdomSnapshot, fetchNextEarnings } from "../core/ape-intel";
import { createTelegramClient } from "../telegram/client";
import { spawnClaudeRunner } from "../claude/invoke";
import { runScan, type ScanDeps } from "./pipeline";
import { spawnAgentBrowser } from "../reddit/agentBrowser";
import { crawlReddit, type RedditCandidate } from "../reddit/crawl";
import { fetchEarningsToday } from "./earnings";

const LABEL = process.argv[2] ?? "Scan";
const LIMIT = Number(process.env.SCAN_LIMIT ?? "15");
const SUBREDDITS = (process.env.REDDIT_SUBREDDITS ?? "wallstreetbets,wallstreetbetsGER,shortsqueeze")
  .split(",").map((s) => s.trim()).filter(Boolean);
const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN ?? "agent-browser";

async function main(): Promise<void> {
  if (!Number.isFinite(LIMIT) || LIMIT <= 0) {
    throw new Error(`Invalid SCAN_LIMIT (must be a positive number): ${process.env.SCAN_LIMIT}`);
  }
  const env = loadEnv();
  const telegram = createTelegramClient({
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId,
  });

  const deps: ScanDeps = {
    fetchSnapshot: () => fetchApewisdomSnapshot(fetch),
    claudeRunner: spawnClaudeRunner,
    send: (text) => telegram.sendMessage(text),
  };

  // Reddit off-radar via agent-browser: opt-in (ENABLE_REDDIT_CRAWL).
  if (env.redditCrawlEnabled) {
    const run = spawnAgentBrowser({ bin: AGENT_BROWSER_BIN, session: "ape-signal" });
    deps.crawlReddit = (): Promise<RedditCandidate[]> =>
      crawlReddit({ subreddits: SUBREDDITS }, { run });
  }

  // Earnings: opt-in (presence of FINNHUB_API_KEY).
  if (env.finnhubApiKey) {
    const key = requireFinnhub(env);
    deps.fetchEarningsToday = (tickers) =>
      fetchEarningsToday(tickers, {
        fetchEarnings: (ticker) => fetchNextEarnings(ticker, key, fetch),
        now: Date.now(),
      });
  }

  await runScan({ label: LABEL, limit: LIMIT }, deps);
  console.log(`[scan] ${LABEL} report sent.`);
}

main().catch((err) => {
  console.error("[scan] failed:", err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → exit 0.

- [ ] **Step 3: Full suite** — `npx vitest run` → all PASS.

- [ ] **Step 4: Manual smoke test** (needs `.env` with `ENABLE_REDDIT_CRAWL=1`, `FINNHUB_API_KEY`, telegram creds; plus `npm i -g agent-browser && agent-browser install` and `claude login`):

First confirm agent-browser extracts posts:
```bash
agent-browser --session ape-signal open https://old.reddit.com/r/wallstreetbets/hot/
agent-browser --session ape-signal eval "JSON.stringify(Array.from(document.querySelectorAll('div.thing')).slice(0,3).map(t=>({title:t.querySelector('a.title')&&t.querySelector('a.title').innerText})))"
```
Expected: a small JSON array of post titles. Then the full scan:
```bash
node --env-file=.env --import tsx src/scan/index.ts Morning
```
Expected: a Telegram report including a "🔥 Reddit Off-Radar" section (if reddit surfaced new tickers) and "📅 Earnings today" (if any). Console prints `[scan] Morning report sent.`

If agent-browser is not installed yet, leave `ENABLE_REDDIT_CRAWL` empty — the scan runs Plan-1-style and still delivers.

- [ ] **Step 5: Commit**

```bash
git add src/scan/index.ts
git commit -m "feat: wire agent-browser reddit off-radar + finnhub earnings into scan entry"
```

---

## Self-Review

**Spec coverage:**
- §E Reddit crawl (now via agent-browser) of wallstreetbets/wallstreetbetsGER/shortsqueeze, configurable via `REDDIT_SUBREDDITS` → Tasks 2 + 4 + 9. ✓
- Ticker extraction + tally → Task 3. ✓
- Diff vs Apewisdom ("off-radar"), challenged by Claude → Tasks 5 + 8. ✓
- §C3 Finnhub earnings-today → Tasks 6 + 8 + 9. ✓
- Report sections → Task 7. ✓
- Resilience (crawl failure → scan still delivers) → Task 8. ✓
- Backward compatibility (crawl disabled → Plan 1 behaviour) → Task 8 third test + Task 9 opt-in. ✓

**Deferred (not this plan):** catalyst NEWS body in the challenge context (`fetchCompanyNews` exists for later); Tradestie/StockTwits sentiment columns; Telegram listener / `/strategie` (Plan 3); systemd (Plan 4); ticker validation against a real symbol list (noise refinement).

**Placeholder scan:** none — every code step has complete code + exact commands. The `spawnAgentBrowser` runner is validated by Task 9's manual run (same policy as the `claude -p` spawn path); its pure helpers are unit-tested.

**Type consistency:** `RawRedditPost`, `RedditPost`, `CrawlRunner`, `AgentBrowserConfig` (agentBrowser.ts); `TickerStat` (tickers.ts); `RedditCandidate` (crawl.ts); `EarningsRow` (earnings.ts) are used identically across modules. `crawlReddit(options, { run })` and the `ScanDeps.crawlReddit?: () => Promise<RedditCandidate[]>` shape match the entry wiring. `parseScore`/`toPosts`/`parseEvalJson` signatures match their tests.

**agent-browser version note (open):** the CLI flags (`--session`, `open`, `eval`) target the current agent-browser; if a flag differs in the installed version, adjust `spawnAgentBrowser`/`EXTRACT_JS` only — the Node contract (`Record<sub, RawRedditPost[]>`) is the stable boundary. The `eval` stdout shape is handled defensively by `parseEvalJson` (raw array, double-encoded string, `{result}` wrapper, or embedded-in-noise).
```
