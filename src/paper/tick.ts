// src/paper/tick.ts — systemd entrypoint for one tick. Argument: "Tick"
// (default) or "Close" (the 22:00 closing tick: expires day orders, posts the
// daily summary). Mirrors src/scan/index.ts: failures alert via Telegram so a
// dead token never fails silently.
import { loadEnv } from "../config/env";
import { createTelegramClient } from "../telegram/client";
import { createClaudeRunner, resolveWatchdog } from "../claude/invoke";
import { fetchTickQuotes } from "./quotes";
import { appendTickHistory } from "./tickHistory";
import { appendJournal, berlinDay, berlinStamp, dataDir, loadPortfolio, readJournalTail, savePortfolio } from "./store";
import { loadHealth, saveHealth } from "./health";
import { runTick } from "./tickPipeline";
import { loadSession } from "../config/session";
import { resolveTickInterval } from "./tickInterval";

const LABEL = process.argv[2] ?? "Tick";
const START_BALANCE = Number(process.env.PAPER_START_BALANCE ?? "2000");

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.paperTradingEnabled) {
    console.log("[tick] paper trading disabled (ENABLE_PAPER_TRADING); skipping.");
    return;
  }
  const telegram = createTelegramClient({ botToken: env.telegramBotToken, chatId: env.telegramChatId });
  const onSlow = (info: { label: string; elapsedMs: number }): void => {
    void telegram
      .sendMessage(`⏳ Claude: „${info.label}" läuft noch (seit ${Math.round(info.elapsedMs / 60_000)} min) — evtl. ausgelastet/limitiert.`)
      .catch(() => {});
  };
  const dir = dataDir();
  const tickIntervalMin = resolveTickInterval(dir, loadSession(process.env).tickIntervalMin);

  await runTick(
    { isClose: LABEL.toLowerCase() === "close" },
    {
      loadPortfolio: () => loadPortfolio(dir, START_BALANCE),
      savePortfolio: (p) => savePortfolio(dir, p),
      appendJournal: (title, body) => appendJournal(dir, title, body),
      readJournalTail: () => readJournalTail(dir),
      fetchQuotes: (tickers) => fetchTickQuotes(tickers, fetch),
      recordTick: (day, atIso, quotes) => appendTickHistory(dir, day, atIso, quotes),
      loadHealth: (day) => loadHealth(dir, day),
      saveHealth: (h) => saveHealth(dir, h),
      claudeRunner: createClaudeRunner({ model: "sonnet", label: "Manager", onSlow, ...resolveWatchdog(process.env) }),
      send: (text) => telegram.sendMessage(text),
      berlinDay,
      berlinStamp,
      language: env.language,
      tickIntervalMin,
    },
  );
  console.log(`[tick] ${LABEL} done.`);
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[tick] failed:", err);
  process.exitCode = 1;
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `⚠️ Paper-Tick (${LABEL}) fehlgeschlagen: ${message}` }),
      });
    }
  } catch (alertErr) {
    console.error("[tick] failed to send failure alert:", alertErr);
  }
});
