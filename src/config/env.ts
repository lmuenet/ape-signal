// src/config/env.ts
export interface Env {
  telegramBotToken: string;
  telegramChatId: string;
  finnhubApiKey?: string;
  redditCrawlEnabled: boolean;
  redditClientId?: string;
  redditClientSecret?: string;
  redditUserAgent?: string;
}

const REQUIRED = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;

function val(source: Record<string, string | undefined>, key: string): string | undefined {
  const v = source[key];
  return v && v.trim() !== "" ? v : undefined;
}

export function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t === "1" || t === "true" || t === "on" || t === "yes";
}

/**
 * Validate and shape the process environment. Telegram vars are required;
 * finnhub is optional (validated on demand by requireFinnhub); the reddit crawl
 * is opt-in via ENABLE_REDDIT_CRAWL so Plan 1 behaviour is the default.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing = REQUIRED.filter((k) => val(source, k) === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    telegramBotToken: source.TELEGRAM_BOT_TOKEN!,
    telegramChatId: source.TELEGRAM_CHAT_ID!,
    finnhubApiKey: val(source, "FINNHUB_API_KEY"),
    redditCrawlEnabled: truthy(source.ENABLE_REDDIT_CRAWL),
    redditClientId: val(source, "REDDIT_CLIENT_ID"),
    redditClientSecret: val(source, "REDDIT_CLIENT_SECRET"),
    redditUserAgent: val(source, "REDDIT_USER_AGENT"),
  };
}

/** Throw unless the Finnhub key is present; returns it. */
export function requireFinnhub(env: Env): string {
  if (!env.finnhubApiKey) throw new Error("Missing finnhub environment variable: FINNHUB_API_KEY");
  return env.finnhubApiKey;
}

/** Throw unless both Reddit OAuth credentials are present; returns them. */
export function requireRedditApi(env: Env): { clientId: string; clientSecret: string } {
  if (!env.redditClientId || !env.redditClientSecret) {
    throw new Error(
      "Missing reddit environment variables: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET",
    );
  }
  return { clientId: env.redditClientId, clientSecret: env.redditClientSecret };
}
