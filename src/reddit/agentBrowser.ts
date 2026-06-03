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
