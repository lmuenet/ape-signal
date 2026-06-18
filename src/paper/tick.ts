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
import { runSetupRadar } from "./radar";
import { runIntradayOpportunity } from "./intraday";
import { loadWatchlist, saveWatchlist } from "./watchlist";
import { loadSession } from "../config/session";
import { resolveTickInterval } from "./tickInterval";
import type { SetupTrigger } from "./types";

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
  const watchdog = resolveWatchdog(process.env);
  const isClose = LABEL.toLowerCase() === "close";

  // Deps shared by the monitor tick, the Setup-Radar and the intraday opener.
  const shared = {
    loadPortfolio: () => loadPortfolio(dir, START_BALANCE),
    savePortfolio: (p: Parameters<typeof savePortfolio>[1]) => savePortfolio(dir, p),
    appendJournal: (title: string, body: string) => appendJournal(dir, title, body),
    readJournalTail: () => readJournalTail(dir),
    fetchQuotes: (tickers: string[]) => fetchTickQuotes(tickers, fetch),
    send: (text: string) => telegram.sendMessage(text),
    berlinDay,
    berlinStamp,
    language: env.language,
  };

  await runTick(
    { isClose },
    {
      ...shared,
      recordTick: (day, atIso, quotes) => appendTickHistory(dir, day, atIso, quotes),
      loadHealth: (day) => loadHealth(dir, day),
      saveHealth: (h) => saveHealth(dir, h),
      claudeRunner: createClaudeRunner({ model: "sonnet", label: "Manager", onSlow, ...watchdog }),
      tickIntervalMin,
    },
  );

  // Setup-Radar (Stufe 2) + gated intraday opening (Stufe 3) run each monitor tick,
  // never on the close tick (no point opening as the session ends).
  if (!isClose) {
    const intraday = env.intradayOpportunismEnabled
      ? (trigger: SetupTrigger) =>
          runIntradayOpportunity(trigger, {
            ...shared,
            runner: createClaudeRunner({ model: "sonnet", label: "Intraday", onSlow, ...watchdog }),
          })
      : undefined;
    // Best-effort: the monitor tick is already done + persisted, so a radar/Telegram
    // hiccup must not mark the whole tick as failed.
    try {
      await runSetupRadar({
        ...shared,
        loadWatchlist: () => loadWatchlist(dir),
        saveWatchlist: (s) => saveWatchlist(dir, s),
        intraday,
      });
    } catch (err) {
      console.error(`[tick] setup-radar failed (monitor tick already done): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
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
