export interface Env {
  telegramBotToken: string;
  telegramChatId: string;
}

const REQUIRED = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;

/**
 * Validate and shape the process environment. Pass a source object in tests;
 * defaults to process.env. On the VPS, systemd's EnvironmentFile populates
 * process.env; locally run with `node --env-file=.env` (tsx forwards it).
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing = REQUIRED.filter((k) => !source[k] || source[k]!.trim() === "");
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    telegramBotToken: source.TELEGRAM_BOT_TOKEN!,
    telegramChatId: source.TELEGRAM_CHAT_ID!,
  };
}
