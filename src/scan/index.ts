// src/scan/index.ts
import { loadEnv } from "../config/env";
import { fetchApewisdomSnapshot } from "../core/ape-intel";
import { createTelegramClient } from "../telegram/client";
import { spawnClaudeRunner } from "../claude/invoke";
import { runScan } from "./pipeline";

const LABEL = process.argv[2] ?? "Scan";
const LIMIT = Number(process.env.SCAN_LIMIT ?? "15");

async function main(): Promise<void> {
  const env = loadEnv();
  const telegram = createTelegramClient({
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId,
  });

  await runScan(
    { label: LABEL, limit: LIMIT },
    {
      fetchSnapshot: () => fetchApewisdomSnapshot(fetch),
      claudeRunner: spawnClaudeRunner,
      send: (text) => telegram.sendMessage(text),
    },
  );
  console.log(`[scan] ${LABEL} report sent.`);
}

main().catch((err) => {
  console.error("[scan] failed:", err);
  process.exitCode = 1;
});
