// src/scan/index.ts
import { loadEnv, requireFinnhub, requireRedditApi } from "../config/env";
import { fetchApewisdomSnapshot, fetchNextEarnings, fetchTradingViewTrend } from "../core/ape-intel";
import { createTelegramClient } from "../telegram/client";
import { spawnClaudeRunner } from "../claude/invoke";
import { runScan, type ScanDeps } from "./pipeline";
import { fetchRsLongShort } from "./rsScreener";
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
    // Live price + 1W/1M/3M trend via the TradingView scanner (free, no key,
    // reachable from the VPS). A failure degrades to "no prices" in the pipeline.
    fetchTrend: (tickers) => fetchTradingViewTrend(tickers, fetch),
    // Long/short relative-strength candidates vs SPY (TradingView, free, no key).
    fetchRsLongShort: () => fetchRsLongShort(fetch),
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
