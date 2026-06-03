// src/reddit/redditApi.ts
import type { FetchFn } from "../core/ape-intel";
import type { CrawlRunner, RawRedditPost } from "./agentBrowser";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";

export interface RedditApiConfig {
  clientId: string;
  clientSecret: string;
  userAgent: string; // Reddit requires a unique, descriptive UA
  limit?: number; // posts per subreddit, default 50
}

export interface RedditApiDeps {
  fetchFn: FetchFn; // injected so the runner is unit-testable without network
}

interface RedditChild {
  data?: { title?: string; score?: number; num_comments?: number };
}
interface RedditListing {
  data?: { children?: RedditChild[] };
}

/**
 * Map a Reddit "hot" listing JSON into RawRedditPost rows. Numeric stats are
 * stringified so the rows flow through the same toPosts/parseScore path as the
 * HTML-scrape contract (Record<sub, RawRedditPost[]>). Rows without a title are
 * dropped; malformed input yields [].
 */
export function parseListing(json: unknown): RawRedditPost[] {
  const children = (json as RedditListing)?.data?.children ?? [];
  const posts: RawRedditPost[] = [];
  for (const child of children) {
    const d = child?.data;
    if (!d || typeof d.title !== "string") continue;
    posts.push({
      title: d.title,
      score: d.score === undefined ? undefined : String(d.score),
      comments: d.num_comments === undefined ? undefined : String(d.num_comments),
    });
  }
  return posts;
}

/**
 * Fetch an application-only OAuth bearer token via the client_credentials grant.
 * Works from datacenter IPs (the path Reddit's block page points scripts to),
 * unlike unauthenticated scraping of old.reddit.com.
 */
export async function fetchAppToken(config: RedditApiConfig, deps: RedditApiDeps): Promise<string> {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await deps.fetchFn(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": config.userAgent,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit token request failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Reddit token response missing access_token");
  return json.access_token;
}

/**
 * Reddit OAuth crawl runner — a drop-in for spawnAgentBrowser honouring the same
 * CrawlRunner contract. Authenticate once (application-only OAuth), then GET each
 * subreddit's hot listing from oauth.reddit.com. A token failure yields [] for
 * every sub; a single failing sub yields [] without aborting the crawl.
 */
export function createRedditApiRunner(config: RedditApiConfig, deps: RedditApiDeps): CrawlRunner {
  const limit = config.limit ?? 50;
  return async (subreddits) => {
    const out: Record<string, RawRedditPost[]> = {};

    let token: string;
    try {
      token = await fetchAppToken(config, deps);
    } catch (err) {
      console.error(`[reddit-api] token: ${err instanceof Error ? err.message : String(err)}`);
      for (const sub of subreddits) out[sub] = [];
      return out;
    }

    for (const sub of subreddits) {
      const url = `${API_BASE}/r/${sub}/hot?limit=${limit}&raw_json=1`;
      try {
        const res = await deps.fetchFn(url, {
          headers: { Authorization: `bearer ${token}`, "User-Agent": config.userAgent },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        out[sub] = parseListing(await res.json());
      } catch (err) {
        console.error(`[reddit-api] ${sub}: ${err instanceof Error ? err.message : String(err)}`);
        out[sub] = [];
      }
    }
    return out;
  };
}
