import { describe, it, expect } from "vitest";
import { loadEnv, requireFinnhub, requireRedditApi } from "./env";

describe("loadEnv", () => {
  it("returns the config when required vars are present", () => {
    const cfg = loadEnv({
      TELEGRAM_BOT_TOKEN: "tok",
      TELEGRAM_CHAT_ID: "123",
    });
    expect(cfg.telegramBotToken).toBe("tok");
    expect(cfg.telegramChatId).toBe("123");
  });

  it("throws listing every missing required var", () => {
    expect(() => loadEnv({})).toThrowError(
      /TELEGRAM_BOT_TOKEN.*TELEGRAM_CHAT_ID/s,
    );
  });
});

describe("APE_LANGUAGE", () => {
  const base = { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" };

  it("defaults to de when unset", () => {
    expect(loadEnv(base).language).toBe("de");
  });

  it("accepts en", () => {
    expect(loadEnv({ ...base, APE_LANGUAGE: "en" }).language).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(loadEnv({ ...base, APE_LANGUAGE: "EN" }).language).toBe("en");
  });

  it("throws on an unsupported value, listing the allowed ones", () => {
    expect(() => loadEnv({ ...base, APE_LANGUAGE: "xx" })).toThrowError(
      /APE_LANGUAGE.*de.*en/s,
    );
  });
});

describe("optional finnhub + reddit-crawl flag", () => {
  it("passes through finnhub key and reddit-crawl flag", () => {
    const cfg = loadEnv({
      TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c",
      FINNHUB_API_KEY: "fk", ENABLE_REDDIT_CRAWL: "1",
    });
    expect(cfg.finnhubApiKey).toBe("fk");
    expect(cfg.redditCrawlEnabled).toBe(true);
  });

  it("defaults reddit-crawl flag to false", () => {
    const cfg = loadEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });
    expect(cfg.redditCrawlEnabled).toBe(false);
  });

  it("requireFinnhub throws when key missing", () => {
    const cfg = loadEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });
    expect(() => requireFinnhub(cfg)).toThrow(/FINNHUB_API_KEY/);
  });
});

describe("reddit OAuth credentials", () => {
  it("passes through reddit client id/secret/user-agent", () => {
    const cfg = loadEnv({
      TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c",
      REDDIT_CLIENT_ID: "cid", REDDIT_CLIENT_SECRET: "csec", REDDIT_USER_AGENT: "ua",
    });
    expect(cfg.redditClientId).toBe("cid");
    expect(cfg.redditClientSecret).toBe("csec");
    expect(cfg.redditUserAgent).toBe("ua");
  });

  it("requireRedditApi returns creds when present", () => {
    const cfg = loadEnv({
      TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c",
      REDDIT_CLIENT_ID: "cid", REDDIT_CLIENT_SECRET: "csec",
    });
    expect(requireRedditApi(cfg)).toEqual({ clientId: "cid", clientSecret: "csec" });
  });

  it("requireRedditApi throws when either credential is missing", () => {
    const cfg = loadEnv({
      TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c", REDDIT_CLIENT_ID: "cid",
    });
    expect(() => requireRedditApi(cfg)).toThrow(/REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET/);
  });
});
