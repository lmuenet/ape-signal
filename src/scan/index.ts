// src/scan/index.ts
import { loadEnv, requireFinnhub, requireRedditApi } from "../config/env";
import { fetchApewisdomSnapshot, fetchNextEarnings } from "../core/ape-intel";
import { createTelegramClient } from "../telegram/client";
import { spawnClaudeRunner } from "../claude/invoke";
import { runScan, type ScanDeps } from "./pipeline";
import { createRedditApiRunner } from "../reddit/redditApi";
import { crawlReddit, type RedditCandidate } from "../reddit/crawl";
import { fetchEarningsToday } from "./earnings";

const LABEL = process.argv[2] ?? "Scan";
const LIMIT = Number(process.env.SCAN_LIMIT ?? "15");
const SUBREDDITS = (process.env.REDDIT_SUBREDDITS ?? "wallstreetbets,wallstreetbetsGER,shortsqueeze")
  .split(",").map((s) => s.trim()).filter(Boolean);

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

  // Reddit off-radar via the Reddit OAuth API: opt-in (ENABLE_REDDIT_CRAWL).
  // Uses application-only OAuth so it works from datacenter IPs (old.reddit.com
  // scraping is IP-blocked on the VPS).
  if (env.redditCrawlEnabled) {
    const { clientId, clientSecret } = requireRedditApi(env);
    const userAgent = env.redditUserAgent ?? "ape-signal/0.1 (off-radar scan)";
    const run = createRedditApiRunner({ clientId, clientSecret, userAgent }, { fetchFn: fetch });
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
