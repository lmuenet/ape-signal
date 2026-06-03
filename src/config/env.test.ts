import { describe, it, expect } from "vitest";
import { loadEnv, requireFinnhub } from "./env";

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
