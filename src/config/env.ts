// src/config/env.ts
import { SUPPORTED_LANGUAGES, type Language } from "../core/language";

export interface Env {
  telegramBotToken: string;
  telegramChatId: string;
  finnhubApiKey?: string;
  redditCrawlEnabled: boolean;
  paperTradingEnabled: boolean;
  /** Stufe 3: gated intraday opportunism opening. Default OFF (Setup-Radar still alerts). */
  intradayOpportunismEnabled: boolean;
  redditClientId?: string;
  redditClientSecret?: string;
  redditUserAgent?: string;
  language: Language;
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

/** APE_LANGUAGE → Language. Unset/leer → "de". Ungültig → throw (fail-fast). */
function parseLanguage(source: Record<string, string | undefined>): Language {
  const raw = source.APE_LANGUAGE;
  if (!raw || raw.trim() === "") return "de";
  const v = raw.trim().toLowerCase();
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(v)) return v as Language;
  throw new Error(
    `Invalid APE_LANGUAGE: "${raw}". Supported values: ${SUPPORTED_LANGUAGES.join(", ")}`,
  );
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
    paperTradingEnabled: truthy(source.ENABLE_PAPER_TRADING),
    intradayOpportunismEnabled: truthy(source.ENABLE_INTRADAY_OPPORTUNISM),
    redditClientId: val(source, "REDDIT_CLIENT_ID"),
    redditClientSecret: val(source, "REDDIT_CLIENT_SECRET"),
    redditUserAgent: val(source, "REDDIT_USER_AGENT"),
    language: parseLanguage(source),
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
