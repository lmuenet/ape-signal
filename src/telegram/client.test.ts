import { describe, it, expect, vi } from "vitest";
import { createTelegramClient, splitMessage } from "./client";

describe("splitMessage", () => {
  it("keeps a short message as a single chunk", () => {
    expect(splitMessage("hello", 4000)).toEqual(["hello"]);
  });

  it("splits on newlines without exceeding the limit", () => {
    const line = "x".repeat(100);
    const text = Array.from({ length: 50 }, () => line).join("\n"); // ~5049 chars
    const chunks = splitMessage(text, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
    expect(chunks.join("\n")).toBe(text);
  });
});

describe("createTelegramClient.sendMessage", () => {
  it("POSTs each chunk to the bot sendMessage endpoint", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const client = createTelegramClient(
      { botToken: "TKN", chatId: "42" },
      fetchFn as unknown as typeof fetch,
    );
    await client.sendMessage("hi");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botTKN/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ chat_id: "42", text: "hi" });
  });

  it("throws when Telegram returns a non-ok response", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, description: "boom" }), { status: 400 }),
    );
    const client = createTelegramClient(
      { botToken: "TKN", chatId: "42" },
      fetchFn as unknown as typeof fetch,
    );
    await expect(client.sendMessage("hi")).rejects.toThrow(/boom/);
  });
});
