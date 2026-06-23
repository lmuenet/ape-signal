// src/scan/index.ts
import { loadEnv, requireFinnhub, requireRedditApi } from "../config/env";
import { marketForScanLabel, marketDisplay } from "../config/session";
import { marketIsOpen } from "../config/marketCalendar";
import { fetchApewisdomSnapshot, fetchNextEarnings, fetchTradingViewTrend } from "../core/ape-intel";
import { createTelegramClient } from "../telegram/client";
import { createNotifier, parseVerbosity } from "../telegram/notify";
import { runScan, type ScanDeps } from "./pipeline";
import { fetchRsLongShort, fetchReadyToTrend, fetchStrongDaily, fetchMomentum } from "./rsScreener";
import { createRedditApiRunner } from "../reddit/redditApi";
import { crawlReddit, type RedditCandidate } from "../reddit/crawl";
import { fetchEarningsToday } from "./earnings";
import { createClaudeRunner, resolveWatchdog } from "../claude/invoke";
import { runKuer } from "../paper/select";
import { saveKuerArtifact } from "../paper/kuerArtifact";
import { saveWatchlist } from "../paper/watchlist";
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

  // Pre-session market run on a day that market is closed (holiday/weekend): skip
  // the whole run (scan + Kür) with one note, so Claude is never asked to reason
  // about a shut exchange. Non-market labels (PreOpen/Manual) are unaffected.
  const market = marketForScanLabel(LABEL);
  if (market && !marketIsOpen(market, new Date())) {
    await telegram.sendMessage(`🦍 ${marketDisplay(market)} ist heute geschlossen (Feiertag/Wochenende) — Pre-Session-Lauf & Kür übersprungen.`);
    console.log(`[scan] ${LABEL}: market ${market} closed today; skipping scan + Kür.`);
    return;
  }

  // Watchdog for every autonomous Claude call: a hard timeout (kill) plus an
  // interim "still working" Telegram ping, so a hanging or usage-limited backend
  // is visible instead of a silent gap (Finding E / D1).
  // Verbosity gate: autonomous messages carry a category; TELEGRAM_VERBOSITY
  // decides what reaches the chat (the ape-ui journal keeps everything).
  const notify = createNotifier((text) => telegram.sendMessage(text), parseVerbosity(process.env.TELEGRAM_VERBOSITY));

  const watchdog = resolveWatchdog(process.env);
  const onSlow = (info: { label: string; elapsedMs: number }): void => {
    void Promise.resolve(
      notify(`⏳ Claude: „${info.label}" läuft noch (seit ${Math.round(info.elapsedMs / 60_000)} min) — evtl. ausgelastet/limitiert.`, "progress"),
    ).catch(() => {});
  };

  const deps: ScanDeps = {
    fetchSnapshot: () => fetchApewisdomSnapshot(fetch),
    claudeRunner: createClaudeRunner({ label: "Scan-Challenge", onSlow, ...watchdog }),
    send: notify,
    // Live price + 1W/1M/3M trend via the TradingView scanner (free, no key,
    // reachable from the VPS). A failure degrades to "no prices" in the pipeline.
    fetchTrend: (tickers) => fetchTradingViewTrend(tickers, fetch),
    // Long/short relative-strength candidates vs SPY (TradingView, free, no key).
    fetchRsLongShort: () => fetchRsLongShort(fetch, { limit: 5 }),
    fetchReadyToTrend: () => fetchReadyToTrend(fetch, { limit: 5 }),
    fetchStrongDaily: () => fetchStrongDaily(fetch, { limit: 5 }),
    fetchMomentum: () => fetchMomentum(fetch, { limit: 5 }),
    language: env.language,
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

  // The autonomous pre-session report is muted as "research"; an explicit manual
  // run (scan@Manual) keeps it as "trade".
  const challenge = await runScan(
    { label: LABEL, limit: LIMIT, reportCategory: LABEL.toLowerCase() === "manual" ? "trade" : "research" },
    deps,
  );
  console.log(`[scan] ${LABEL} report sent.`);

  // Kandidatenkür: opt-in (ENABLE_PAPER_TRADING), once per active market's
  // pre-session run (PreXetra / PreUS) — fresh data, the market opens shortly.
  // Sonnet researches + debattiert, Opus decides. Holiday-closed markets were
  // already skipped above.
  if (env.paperTradingEnabled && market) {
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
        researchRunner: createClaudeRunner({ model: "sonnet", allowedTools: ["WebSearch", "Skill"], label: "Research", onSlow, ...watchdog }),
        debateRunner: createClaudeRunner({ model: "sonnet", label: "Debatte", onSlow, ...watchdog }),
        decideRunner: createClaudeRunner({ model: "opus", label: "Entscheidung", onSlow, ...watchdog }),
        send: notify,
        saveKuer: (a) => saveKuerArtifact(dir, a),
        saveWatchlist: (s) => saveWatchlist(dir, s),
        berlinDay,
        language: env.language,
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
