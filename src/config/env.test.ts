import { describe, it, expect } from "vitest";
import { loadEnv } from "./env";

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
