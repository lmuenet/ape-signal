# Plan 2: Reddit Off-Radar Candidates + Finnhub Earnings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the daily scan with (a) a "🔥 Reddit Off-Radar" section — tickers buzzing on r/wallstreetbets, r/wallstreetbetsGER, r/shortsqueeze that are NOT already in the Apewisdom ranked list, each challenged by Claude — and (b) an "📅 Earnings today" section from Finnhub.

**Architecture:** A read-only Reddit OAuth client (client_credentials grant) fetches hot/rising posts; a ticker extractor tallies mentions; off-radar candidates (not in Apewisdom) are mapped to `TrendingRow`-shaped entries and merged into the SINGLE existing Claude challenge (one `claude -p` call). The formatter splits verdicts into Apewisdom vs Off-Radar by origin. Finnhub supplies same-day earnings for the scanned tickers. All new pieces are dependency-injected; Reddit/Finnhub are OPTIONAL in the pipeline so Plan 1's behaviour is unchanged when creds are absent.

**Tech Stack:** TypeScript, tsx, vitest, Reddit OAuth (`oauth.reddit.com`), Finnhub (`fetchNextEarnings` from the submodule), Node global `fetch`.

**Backward-compat invariant:** `formatReport(rows, challenge, meta)` keeps its 3-arg shape; new behaviour rides on optional `ReportMeta` fields, so existing Plan 1 tests stay green.

---

## File Structure

| Path | Responsibility | New/Mod |
|---|---|---|
| `src/config/env.ts` | add optional reddit/finnhub vars + `requireReddit`/`requireFinnhub` guards | Mod |
| `src/reddit/auth.ts` | `fetchRedditToken` — client_credentials OAuth | New |
| `src/reddit/client.ts` | `fetchSubreddit` — fetch a listing, normalise posts | New |
| `src/reddit/tickers.ts` | `extractTickers` + `tallyTickers` | New |
| `src/reddit/crawl.ts` | `crawlReddit` — token → fetch subs → tally → ranked candidates | New |
| `src/scan/offradar.ts` | `offRadar` — filter candidates not in Apewisdom, by min mentions | New |
| `src/scan/earnings.ts` | `fetchEarningsToday` — same-day earnings for given tickers | New |
| `src/core/ape-intel.ts` | add `fetchNextEarnings` + `EarningsDate` re-exports | Mod |
| `src/scan/format.ts` | split Off-Radar section + Earnings section via `ReportMeta` | Mod |
| `src/scan/pipeline.ts` | merge off-radar into the single challenge; collect earnings | Mod |
| `src/scan/index.ts` | wire reddit + finnhub deps from env | Mod |

---

## Task 1: Extend env loader (optional reddit + finnhub)

**Files:** Modify `src/config/env.ts`; Modify `src/config/env.test.ts`

- [ ] **Step 1: Add failing tests** (append inside the existing `describe("loadEnv", …)` or add new describes)

```ts
// add to src/config/env.test.ts
import { loadEnv, requireReddit, requireFinnhub } from "./env";

describe("optional reddit + finnhub", () => {
  it("passes through reddit + finnhub vars when present", () => {
    const cfg = loadEnv({
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_CHAT_ID: "c",
      REDDIT_CLIENT_ID: "id",
      REDDIT_CLIENT_SECRET: "sec",
      REDDIT_USER_AGENT: "ua",
      FINNHUB_API_KEY: "fk",
    });
    expect(cfg.redditClientId).toBe("id");
    expect(cfg.finnhubApiKey).toBe("fk");
  });

  it("requireReddit returns creds when complete", () => {
    const cfg = loadEnv({
      TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c",
      REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "sec", REDDIT_USER_AGENT: "ua",
    });
    expect(requireReddit(cfg)).toEqual({ clientId: "id", clientSecret: "sec", userAgent: "ua" });
  });

  it("requireReddit throws when any reddit var missing", () => {
    const cfg = loadEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c", REDDIT_CLIENT_ID: "id" });
    expect(() => requireReddit(cfg)).toThrow(/REDDIT_CLIENT_SECRET|REDDIT_USER_AGENT/);
  });

  it("requireFinnhub throws when key missing", () => {
    const cfg = loadEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });
    expect(() => requireFinnhub(cfg)).toThrow(/FINNHUB_API_KEY/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/config/env.test.ts`
Expected: FAIL — `requireReddit`/`requireFinnhub` not exported.

- [ ] **Step 3: Implement** — replace the whole `src/config/env.ts` with:

```ts
// src/config/env.ts
export interface Env {
  telegramBotToken: string;
  telegramChatId: string;
  redditClientId?: string;
  redditClientSecret?: string;
  redditUserAgent?: string;
  finnhubApiKey?: string;
}

export interface RedditCreds {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}

const REQUIRED = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;

function val(source: Record<string, string | undefined>, key: string): string | undefined {
  const v = source[key];
  return v && v.trim() !== "" ? v : undefined;
}

/**
 * Validate and shape the process environment. Telegram vars are required;
 * reddit + finnhub are optional here and validated on demand by the guards
 * below, so Plan 1 (telegram-only) still runs without them.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing = REQUIRED.filter((k) => val(source, k) === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    telegramBotToken: source.TELEGRAM_BOT_TOKEN!,
    telegramChatId: source.TELEGRAM_CHAT_ID!,
    redditClientId: val(source, "REDDIT_CLIENT_ID"),
    redditClientSecret: val(source, "REDDIT_CLIENT_SECRET"),
    redditUserAgent: val(source, "REDDIT_USER_AGENT"),
    finnhubApiKey: val(source, "FINNHUB_API_KEY"),
  };
}

/** Throw unless all three reddit credentials are present. */
export function requireReddit(env: Env): RedditCreds {
  const missing: string[] = [];
  if (!env.redditClientId) missing.push("REDDIT_CLIENT_ID");
  if (!env.redditClientSecret) missing.push("REDDIT_CLIENT_SECRET");
  if (!env.redditUserAgent) missing.push("REDDIT_USER_AGENT");
  if (missing.length > 0) {
    throw new Error(`Missing reddit environment variables: ${missing.join(", ")}`);
  }
  return {
    clientId: env.redditClientId!,
    clientSecret: env.redditClientSecret!,
    userAgent: env.redditUserAgent!,
  };
}

/** Throw unless the Finnhub key is present; returns it. */
export function requireFinnhub(env: Env): string {
  if (!env.finnhubApiKey) throw new Error("Missing finnhub environment variable: FINNHUB_API_KEY");
  return env.finnhubApiKey;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/config/env.test.ts`
Expected: PASS (all, incl. the two original tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/config/env.test.ts
git commit -m "feat: optional reddit + finnhub env vars with guards"
```

---

## Task 2: Reddit OAuth token

**Files:** Create `src/reddit/auth.ts`; Test `src/reddit/auth.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/reddit/auth.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchRedditToken } from "./auth";

const creds = { clientId: "id", clientSecret: "sec", userAgent: "ua/0.1" };

describe("fetchRedditToken", () => {
  it("posts client_credentials with basic auth + UA and returns the token", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "abc", token_type: "bearer" }), { status: 200 }),
    );
    const token = await fetchRedditToken(creds, fetchFn as unknown as typeof fetch);
    expect(token).toBe("abc");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://www.reddit.com/api/v1/access_token");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("id:sec").toString("base64")}`);
    expect(headers["User-Agent"]).toBe("ua/0.1");
    expect((init as RequestInit).body).toBe("grant_type=client_credentials");
  });

  it("throws on non-ok auth response", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(fetchRedditToken(creds, fetchFn as unknown as typeof fetch)).rejects.toThrow(/401/);
  });

  it("throws when no access_token in body", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(fetchRedditToken(creds, fetchFn as unknown as typeof fetch)).rejects.toThrow(/access_token/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/reddit/auth.test.ts` (cannot resolve `./auth`).

- [ ] **Step 3: Implement**

```ts
// src/reddit/auth.ts
import type { RedditCreds } from "../config/env";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

/**
 * Application-only OAuth (client_credentials grant) for read-only access to
 * public subreddit listings. No user password required.
 */
export async function fetchRedditToken(
  creds: RedditCreds,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": creds.userAgent,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!data.access_token) throw new Error("Reddit auth: no access_token in response");
  return data.access_token;
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/reddit/auth.test.ts` (all three).

- [ ] **Step 5: Commit**

```bash
git add src/reddit/auth.ts src/reddit/auth.test.ts
git commit -m "feat: reddit client_credentials oauth token"
```

---

## Task 3: Reddit subreddit client

**Files:** Create `src/reddit/client.ts`; Test `src/reddit/client.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/reddit/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchSubreddit } from "./client";

function listing() {
  return {
    data: {
      children: [
        { data: { title: "$GME to the moon", selftext: "yolo", score: 120, num_comments: 45 } },
        { data: { title: "thoughts on KSS?", selftext: "", score: 10, num_comments: 3 } },
      ],
    },
  };
}

describe("fetchSubreddit", () => {
  it("calls the oauth host with bearer + UA and normalises posts", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(listing()), { status: 200 }));
    const posts = await fetchSubreddit("TKN", "wallstreetbets", "hot", 25, "ua", fetchFn as unknown as typeof fetch);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://oauth.reddit.com/r/wallstreetbets/hot?limit=25&raw_json=1");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer TKN");
    expect(headers["User-Agent"]).toBe("ua");
    expect(posts).toEqual([
      { title: "$GME to the moon", selftext: "yolo", score: 120, numComments: 45 },
      { title: "thoughts on KSS?", selftext: "", score: 10, numComments: 3 },
    ]);
  });

  it("throws on non-ok", async () => {
    const fetchFn = vi.fn(async () => new Response("x", { status: 429 }));
    await expect(
      fetchSubreddit("TKN", "shortsqueeze", "hot", 25, "ua", fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/shortsqueeze.*429/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — cannot resolve `./client`.

- [ ] **Step 3: Implement**

```ts
// src/reddit/client.ts
export type RedditListing = "hot" | "rising" | "top" | "new";

export interface RedditPost {
  title: string;
  selftext: string;
  score: number;
  numComments: number;
}

interface RawChild {
  data?: { title?: string; selftext?: string; score?: number; num_comments?: number };
}
interface RawListing {
  data?: { children?: RawChild[] };
}

/** Fetch one subreddit listing via the OAuth host and normalise the posts. */
export async function fetchSubreddit(
  token: string,
  subreddit: string,
  listing: RedditListing,
  limit: number,
  userAgent: string,
  fetchFn: typeof fetch = fetch,
): Promise<RedditPost[]> {
  const url = `https://oauth.reddit.com/r/${subreddit}/${listing}?limit=${limit}&raw_json=1`;
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": userAgent },
  });
  if (!res.ok) throw new Error(`Reddit ${subreddit} returned ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as RawListing;
  return (body.data?.children ?? []).map((c) => ({
    title: c.data?.title ?? "",
    selftext: c.data?.selftext ?? "",
    score: c.data?.score ?? 0,
    numComments: c.data?.num_comments ?? 0,
  }));
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/reddit/client.ts src/reddit/client.test.ts
git commit -m "feat: reddit subreddit listing client"
```

---

## Task 4: Ticker extraction + tally

**Files:** Create `src/reddit/tickers.ts`; Test `src/reddit/tickers.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/reddit/tickers.test.ts
import { describe, it, expect } from "vitest";
import { extractTickers, tallyTickers } from "./tickers";
import type { RedditPost } from "./client";

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

(Note: in post 1 "$KSS" + "KSS" are the same ticker within one post → counts as one mention for that post; mentions counts POSTS that mention the ticker, not raw occurrences.)

- [ ] **Step 2: Run, expect FAIL** — cannot resolve `./tickers`.

- [ ] **Step 3: Implement**

```ts
// src/reddit/tickers.ts
import type { RedditPost } from "./client";

// High-frequency uppercase words that are NOT tickers. Tuned to reduce
// false positives from WSB slang / finance acronyms.
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

## Task 5: Reddit crawl orchestrator

**Files:** Create `src/reddit/crawl.ts`; Test `src/reddit/crawl.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/reddit/crawl.test.ts
import { describe, it, expect, vi } from "vitest";
import { crawlReddit } from "./crawl";
import type { RedditPost } from "./client";

describe("crawlReddit", () => {
  it("aggregates tallies across subreddits and returns mention-sorted candidates", async () => {
    const bySub: Record<string, RedditPost[]> = {
      wallstreetbets: [{ title: "$KSS squeeze", selftext: "", score: 50, numComments: 5 }],
      shortsqueeze: [
        { title: "$KSS again", selftext: "", score: 30, numComments: 2 },
        { title: "$BBBY revival", selftext: "", score: 10, numComments: 1 },
      ],
    };
    const fetchSubreddit = vi.fn(async (_t: string, sub: string) => bySub[sub] ?? []);

    const candidates = await crawlReddit(
      { token: "T", userAgent: "ua", subreddits: ["wallstreetbets", "shortsqueeze"], listing: "hot", limit: 25 },
      { fetchSubreddit },
    );

    expect(fetchSubreddit).toHaveBeenCalledTimes(2);
    expect(candidates[0]).toEqual({ ticker: "KSS", mentions: 2, score: 80 });
    expect(candidates.find((c) => c.ticker === "BBBY")).toEqual({ ticker: "BBBY", mentions: 1, score: 10 });
  });

  it("skips a subreddit that errors without failing the whole crawl", async () => {
    const fetchSubreddit = vi.fn(async (_t: string, sub: string) => {
      if (sub === "broken") throw new Error("429");
      return [{ title: "$GME", selftext: "", score: 5, numComments: 1 }] as RedditPost[];
    });
    const candidates = await crawlReddit(
      { token: "T", userAgent: "ua", subreddits: ["broken", "wallstreetbets"], listing: "hot", limit: 25 },
      { fetchSubreddit },
    );
    expect(candidates).toEqual([{ ticker: "GME", mentions: 1, score: 5 }]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — cannot resolve `./crawl`.

- [ ] **Step 3: Implement**

```ts
// src/reddit/crawl.ts
import type { RedditListing, RedditPost } from "./client";
import { tallyTickers, type TickerStat } from "./tickers";

export interface RedditCandidate {
  ticker: string;
  mentions: number;
  score: number;
}

export interface CrawlOptions {
  token: string;
  userAgent: string;
  subreddits: string[];
  listing: RedditListing;
  limit: number;
}

export interface CrawlDeps {
  fetchSubreddit: (
    token: string,
    subreddit: string,
    listing: RedditListing,
    limit: number,
    userAgent: string,
  ) => Promise<RedditPost[]>;
}

/**
 * Fetch each subreddit, tally tickers across all of them, and return candidates
 * sorted by mentions (desc) then score (desc). A subreddit that errors is
 * skipped (logged) rather than aborting the whole crawl.
 */
export async function crawlReddit(
  options: CrawlOptions,
  deps: CrawlDeps,
): Promise<RedditCandidate[]> {
  const merged = new Map<string, TickerStat>();
  for (const sub of options.subreddits) {
    let posts: RedditPost[];
    try {
      posts = await deps.fetchSubreddit(options.token, sub, options.listing, options.limit, options.userAgent);
    } catch (err) {
      console.error(`[reddit] skipping r/${sub}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const [ticker, stat] of tallyTickers(posts)) {
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
git commit -m "feat: reddit crawl orchestrator with per-sub error tolerance"
```

---

## Task 6: Off-radar diff

**Files:** Create `src/scan/offradar.ts`; Test `src/scan/offradar.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/scan/offradar.test.ts
import { describe, it, expect } from "vitest";
import { offRadar } from "./offradar";
import type { RedditCandidate } from "../reddit/crawl";

const candidates: RedditCandidate[] = [
  { ticker: "GME", mentions: 9, score: 900 }, // already in apewisdom -> excluded
  { ticker: "KSS", mentions: 4, score: 300 }, // off-radar, above threshold
  { ticker: "BBBY", mentions: 1, score: 10 }, // below threshold -> excluded
];

describe("offRadar", () => {
  it("keeps reddit candidates not in apewisdom and above the mention threshold", () => {
    const known = new Set(["GME", "TSLA"]);
    const out = offRadar(candidates, known, { minMentions: 2, limit: 10 });
    expect(out.map((c) => c.ticker)).toEqual(["KSS"]);
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

## Task 7: Earnings-today helper (Finnhub) + barrel export

**Files:** Modify `src/core/ape-intel.ts`; Create `src/scan/earnings.ts`; Test `src/scan/earnings.test.ts`

- [ ] **Step 1: Extend the barrel** (add to `src/core/ape-intel.ts`)

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
      if (ticker === "TSLA") return { date: "2026-07-01", epsEstimate: null }; // future, not today
      return null; // GME none
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

- [ ] **Step 5: Run, expect PASS**, then typecheck `npx tsc --noEmit` (verifies the barrel addition resolves). Commit.

```bash
git add src/core/ape-intel.ts src/scan/earnings.ts src/scan/earnings.test.ts
git commit -m "feat: finnhub earnings-today helper + barrel export"
```

---

## Task 8: Format Off-Radar + Earnings sections

**Files:** Modify `src/scan/format.ts`; Modify `src/scan/format.test.ts`

- [ ] **Step 1: Add failing tests** (append to `src/scan/format.test.ts`)

```ts
// add to src/scan/format.test.ts
import type { EarningsRow } from "./earnings";

describe("formatReport off-radar + earnings", () => {
  const allRows: TrendingRow[] = [
    { ticker: "GME", rank: 1, mentions: 500, mentions24hAgo: 600 },
    { ticker: "KSS", rank: 16, mentions: 4, mentions24hAgo: 4 }, // off-radar (mapped) row
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
    // KSS line appears under off-radar, GME under the main section
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

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/scan/format.test.ts` (old + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/scan/format.ts src/scan/format.test.ts
git commit -m "feat: report off-radar + earnings-today sections"
```

---

## Task 9: Wire reddit + earnings into the pipeline

**Files:** Modify `src/scan/pipeline.ts`; Modify `src/scan/pipeline.test.ts`

- [ ] **Step 1: Add failing test** (append to `src/scan/pipeline.test.ts`)

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

    // KSS (off-radar) must be in the prompt handed to claude
    expect(claudeRunner.mock.calls[0][0]).toContain("KSS");
    const msg = send.mock.calls[0][0] as string;
    expect(msg).toContain("Off-Radar");
    expect(msg).toContain("KSS");
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
 * (optionally) attach today's earnings → format (splitting off-radar into its
 * own section) → send. Reddit/earnings are optional; without them this behaves
 * exactly like Plan 1.
 */
export async function runScan(
  options: ScanOptions,
  deps: ScanDeps,
): Promise<TrendingChallenge> {
  const snapshot = await deps.fetchSnapshot();
  const rows = snapshotToRows(snapshot, options.limit);
  const knownTickers = new Set(snapshot.keys());

  // Off-radar reddit candidates → TrendingRow-shaped entries appended after the
  // apewisdom rows, so the existing challenge prompt covers them too.
  let offRadarRows: TrendingRow[] = [];
  if (deps.crawlReddit) {
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

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/scan/pipeline.test.ts` (old Plan 1 tests + new ones), then full suite `npx vitest run` + `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/scan/pipeline.ts src/scan/pipeline.test.ts
git commit -m "feat: pipeline integrates reddit off-radar + earnings (optional deps)"
```

---

## Task 10: Entry wiring + manual run

**Files:** Modify `src/scan/index.ts`

- [ ] **Step 1: Replace `src/scan/index.ts`** with:

```ts
// src/scan/index.ts
import { loadEnv, requireReddit, requireFinnhub } from "../config/env";
import { fetchApewisdomSnapshot, fetchNextEarnings } from "../core/ape-intel";
import { createTelegramClient } from "../telegram/client";
import { spawnClaudeRunner } from "../claude/invoke";
import { runScan, type ScanDeps } from "./pipeline";
import { fetchRedditToken } from "../reddit/auth";
import { fetchSubreddit } from "../reddit/client";
import { crawlReddit, type RedditCandidate } from "../reddit/crawl";
import { fetchEarningsToday } from "./earnings";

const LABEL = process.argv[2] ?? "Scan";
const LIMIT = Number(process.env.SCAN_LIMIT ?? "15");
const SUBREDDITS = (process.env.REDDIT_SUBREDDITS ?? "wallstreetbets,wallstreetbetsGER,shortsqueeze")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

  // Reddit off-radar is opt-in: only wired when creds are present.
  if (env.redditClientId) {
    const creds = requireReddit(env);
    deps.crawlReddit = async (): Promise<RedditCandidate[]> => {
      const token = await fetchRedditToken(creds);
      return crawlReddit(
        { token, userAgent: creds.userAgent, subreddits: SUBREDDITS, listing: "hot", limit: 50 },
        { fetchSubreddit },
      );
    };
  }

  // Earnings is opt-in: only wired when the Finnhub key is present.
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

- [ ] **Step 4: Manual smoke test** (requires `.env` with reddit + finnhub creds + `claude login`):

```bash
node --env-file=.env --import tsx src/scan/index.ts Morning
```
Expected: a report arrives in Telegram including a "🔥 Reddit Off-Radar" section (if reddit surfaced new tickers) and "📅 Earnings today" (if any). Console prints `[scan] Morning report sent.`

- [ ] **Step 5: Commit**

```bash
git add src/scan/index.ts
git commit -m "feat: wire reddit off-radar + finnhub earnings into scan entry"
```

---

## Self-Review

**Spec coverage:**
- §E1 Reddit OAuth → Task 2. ✓
- §E2 fetch wallstreetbets/wallstreetbetsGER/shortsqueeze (configurable via `REDDIT_SUBREDDITS`) → Tasks 3 + 10. ✓
- §E3 ticker extraction + tally → Task 4. ✓
- §E4 diff vs Apewisdom ("off-radar") → Task 6, integrated Task 9. ✓
- Off-radar tickers challenged by Claude → Task 9 (merged into the single challenge). ✓
- §C3 Finnhub earnings-today → Tasks 7 + 9 + 10. ✓
- Report sections → Task 8. ✓
- Backward compatibility (no creds → Plan 1 behaviour) → Task 9 second test + Task 10 opt-in wiring. ✓

**Deferred (not this plan):** Catalyst NEWS body in the challenge context (only earnings dates are wired here; `fetchCompanyNews` exists for a later increment); Tradestie/StockTwits sentiment columns (§C2); the Telegram listener / `/strategie` (Plan 3); systemd (Plan 4).

**Placeholder scan:** none — every code step has complete code + exact commands.

**Type consistency:** `RedditCandidate { ticker, mentions, score }`, `RedditPost { title, selftext, score, numComments }`, `TickerStat { mentions, score }`, `EarningsRow { ticker, date, epsEstimate }`, `RedditCreds { clientId, clientSecret, userAgent }` are used identically across auth/client/tickers/crawl/offradar/earnings/format/pipeline/index. `runScan(options, deps)` with optional `crawlReddit`/`fetchEarningsToday` matches all call sites. `fetchSubreddit` signature `(token, subreddit, listing, limit, userAgent, fetchFn?)` matches the `CrawlDeps.fetchSubreddit` shape (the 5-arg form; the crawl never passes `fetchFn`, so the real `fetchSubreddit`'s default `fetch` is used).

**Noise-tuning note (open):** bare-uppercase ticker extraction can yield false positives; the `STOPWORDS` set + `offRadarMinMentions` threshold are the first defense. Finnhub-symbol validation of candidates is a candidate refinement for a later increment if noise proves high in real runs.
