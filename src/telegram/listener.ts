// src/telegram/listener.ts
import { join } from "node:path";
import { loadEnv, requireFinnhub } from "../config/env";
import {
  fetchApewisdomSnapshot,
  fetchStockTwitsForTicker,
  fetchTradestieSnapshot,
  fetchRelevantCompanyNews,
  fetchNextEarnings,
  fetchQuote,
  fetchTradingViewTrend,
} from "../core/ape-intel";
import { createTelegramClient } from "./client";
import { createClaudeRunner, spawnClaudeRunner } from "../claude/invoke";
import { parseCommand } from "./commands";
import { runJournalCommand, type JournalDeps } from "../paper/journalCommand";
import { fetchTickQuotes } from "../paper/quotes";
import { appendJournal, dataDir, loadPortfolio, readJournalTail, savePortfolio } from "../paper/store";
import { resolveTickInterval, writeTickInterval } from "../paper/tickInterval";
import { loadSession } from "../config/session";
import { readOffset, writeOffset } from "./offset";
import { runStrategy, formatStrategy, type StrategyDeps } from "../strategy/strategy";
import { runScan, type ScanDeps } from "../scan/pipeline";
import { fetchRsLongShort, fetchReadyToTrend, fetchStrongDaily, fetchMomentum } from "../scan/rsScreener";

const OFFSET_PATH = process.env.OFFSET_PATH ?? join(process.cwd(), ".telegram-offset");
const POLL_TIMEOUT = 25; // seconds — long-poll, ~2880 reqs/day

interface TgMessage { chat: { id: number }; text?: string }
interface TgUpdate { update_id: number; message?: TgMessage }

async function getUpdates(token: string, offset: number): Promise<TgUpdate[]> {
  const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=${POLL_TIMEOUT}&offset=${offset}`;
  const res = await fetch(url, { signal: AbortSignal.timeout((POLL_TIMEOUT + 10) * 1000) });
  const data = (await res.json()) as { ok: boolean; result?: TgUpdate[]; description?: string };
  if (!data.ok) throw new Error(`getUpdates failed: ${data.description}`);
  return data.result ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const env = loadEnv();
  const telegram = createTelegramClient({ botToken: env.telegramBotToken, chatId: env.telegramChatId });

  const finnhubKey = env.finnhubApiKey ? requireFinnhub(env) : undefined;
  const strategyDeps: StrategyDeps = {
    fetchApewisdom: () => fetchApewisdomSnapshot(fetch),
    fetchStockTwits: (t) => fetchStockTwitsForTicker(t, fetch),
    fetchTradestie: () => fetchTradestieSnapshot(fetch),
    fetchNews: (t) => (finnhubKey ? fetchRelevantCompanyNews(t, finnhubKey, fetch) : Promise.resolve([])),
    fetchEarnings: (t) => (finnhubKey ? fetchNextEarnings(t, finnhubKey, fetch) : Promise.resolve(null)),
    fetchQuote: (t) => (finnhubKey ? fetchQuote(t, finnhubKey, fetch) : Promise.resolve(null)),
    claudeRunner: spawnClaudeRunner,
    language: env.language,
  };
  const scanDeps: ScanDeps = {
    fetchSnapshot: () => fetchApewisdomSnapshot(fetch),
    claudeRunner: spawnClaudeRunner,
    send: (text) => telegram.sendMessage(text),
    fetchTrend: (tickers) => fetchTradingViewTrend(tickers, fetch),
    fetchRsLongShort: () => fetchRsLongShort(fetch, { limit: 5 }),
    fetchReadyToTrend: () => fetchReadyToTrend(fetch, { limit: 5 }),
    fetchStrongDaily: () => fetchStrongDaily(fetch, { limit: 5 }),
    fetchMomentum: () => fetchMomentum(fetch, { limit: 5 }),
    language: env.language,
  };

  const paperDir = dataDir();
  const journalDeps: JournalDeps = {
    loadPortfolio: () => loadPortfolio(paperDir, Number(process.env.PAPER_START_BALANCE ?? "2000")),
    savePortfolio: (p) => savePortfolio(paperDir, p),
    appendJournal: (title, body) => appendJournal(paperDir, title, body),
    readJournalTail: () => readJournalTail(paperDir),
    fetchQuotes: (tickers) => fetchTickQuotes(tickers, fetch),
    claudeRunner: createClaudeRunner({ model: "sonnet" }),
    language: env.language,
  };

  let offset = readOffset(OFFSET_PATH);
  console.log(`[listener] started; offset=${offset}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      for (const u of await getUpdates(env.telegramBotToken, offset)) {
        offset = u.update_id + 1;
        writeOffset(OFFSET_PATH, offset);
        const msg = u.message;
        if (!msg?.text) continue;
        if (String(msg.chat.id) !== env.telegramChatId) continue; // whitelist
        await handle(msg.text, telegram, strategyDeps, scanDeps, journalDeps);
      }
    } catch (err) {
      console.error(`[listener] poll error: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(3000);
    }
  }
}

async function handle(
  text: string,
  telegram: ReturnType<typeof createTelegramClient>,
  strategyDeps: StrategyDeps,
  scanDeps: ScanDeps,
  journalDeps: JournalDeps,
): Promise<void> {
  const cmd = parseCommand(text);
  try {
    if (cmd.kind === "scan") {
      await telegram.sendMessage("Starte Scan…");
      await runScan({ label: "Manual", limit: Number(process.env.SCAN_LIMIT ?? "15") }, scanDeps);
    } else if (cmd.kind === "journal") {
      await telegram.sendMessage(await runJournalCommand(cmd.text, journalDeps));
    } else if (cmd.kind === "strategie") {
      await telegram.sendMessage(`Analysiere ${cmd.ticker} (${cmd.profile.risk}/${cmd.profile.horizon})…`);
      const { strategy, raw, quote } = await runStrategy(cmd.ticker, cmd.profile, strategyDeps);
      await telegram.sendMessage(formatStrategy(cmd.ticker, cmd.profile, strategy, raw, quote), { parseMode: "HTML" });
    } else if (cmd.kind === "ticker") {
      const dir = dataDir();
      if (cmd.badArg !== undefined) {
        await telegram.sendMessage("⚠️ /ticker braucht eine ganze Zahl 1–60 (Minuten). Beispiel: /ticker 3");
      } else if (cmd.minutes === undefined) {
        const cur = resolveTickInterval(dir, loadSession(process.env).tickIntervalMin);
        await telegram.sendMessage(`⏱️ Aktuelles Tick-Intervall: ${cur} min.`);
      } else {
        writeTickInterval(dir, cmd.minutes);
        await telegram.sendMessage(`⏱️ Tick-Intervall jetzt ${cmd.minutes} min (ab dem nächsten Tick).`);
      }
    } else {
      await telegram.sendMessage("Befehle: /strategie TICKER [conservative|balanced|aggressive] [intraday|swing|position] · /scan · /journal [z.B. \"setz dein Guthaben auf 500\"] · /ticker [1–60]");
    }
  } catch (err) {
    await telegram.sendMessage(`⚠️ Fehler: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  console.error("[listener] fatal:", err);
  process.exitCode = 1;
});
