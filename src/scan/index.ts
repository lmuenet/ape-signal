// src/scan/index.ts
import { loadEnv, requireFinnhub, requireRedditApi } from "../config/env";
import { fetchApewisdomSnapshot, fetchNextEarnings, fetchTradingViewTrend } from "../core/ape-intel";
import { createTelegramClient } from "../telegram/client";
import { spawnClaudeRunner } from "../claude/invoke";
import { runScan, type ScanDeps } from "./pipeline";
import { fetchRsLongShort, fetchReadyToTrend, fetchStrongDaily, fetchMomentum } from "./rsScreener";
import { createRedditApiRunner } from "../reddit/redditApi";
import { crawlReddit, type RedditCandidate } from "../reddit/crawl";
import { fetchEarningsToday } from "./earnings";
import { createClaudeRunner } from "../claude/invoke";
import { runKuer } from "../paper/select";
import { fetchTickQuotes } from "../paper/quotes";
import {
  appendJournal,
  berlinDay,
  dataDir,
  loadPortfolio,
  readJournalTail,
  savePortfolio,
} from "../paper/store";

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
    fetchRsLongShort: () => fetchRsLongShort(fetch, { limit: 5 }),
    fetchReadyToTrend: () => fetchReadyToTrend(fetch, { limit: 5 }),
    fetchStrongDaily: () => fetchStrongDaily(fetch, { limit: 5 }),
    fetchMomentum: () => fetchMomentum(fetch, { limit: 5 }),
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

  const challenge = await runScan({ label: LABEL, limit: LIMIT }, deps);
  console.log(`[scan] ${LABEL} report sent.`);

  // Kandidatenkür: opt-in (ENABLE_PAPER_TRADING), only after the PreUS scan —
  // fresh data, US open is 15 minutes away. Sonnet researches + debattiert,
  // Opus decides.
  if (env.paperTradingEnabled && LABEL === "PreUS") {
    const dir = dataDir();
    const startBalance = Number(process.env.PAPER_START_BALANCE ?? "2000");
    const scanSummary = [
      challenge.summary,
      ...challenge.verdicts.map((v) => `${v.ticker}: ${v.verdict}${v.thesis ? ` — ${v.thesis}` : ""}`),
    ]
      .filter((l) => l && l.trim() !== "")
      .join("\n");
    await runKuer(
      { scanSummary },
      {
        loadPortfolio: () => loadPortfolio(dir, startBalance),
        savePortfolio: (p) => savePortfolio(dir, p),
        appendJournal: (title, body) => appendJournal(dir, title, body),
        readJournalTail: () => readJournalTail(dir),
        fetchQuotes: (tickers) => fetchTickQuotes(tickers, fetch),
        researchRunner: createClaudeRunner({ model: "sonnet", allowedTools: ["WebSearch", "Skill"] }),
        debateRunner: createClaudeRunner({ model: "sonnet" }),
        decideRunner: createClaudeRunner({ model: "opus" }),
        send: (text) => telegram.sendMessage(text),
        berlinDay,
      },
    );
    console.log("[scan] Kandidatenkür done.");
  }
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
