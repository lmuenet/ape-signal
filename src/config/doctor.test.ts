import { describe, it, expect } from "vitest";
import { parseEnvFile, withTimeout, formatResults, hasFailure, type CheckResult } from "./doctor";
import { checkRequiredEnv, checkClaude, checkTelegram } from "./doctor";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("parseEnvFile", () => {
  it("parses KEY=VALUE lines, ignoring blanks and # comments", () => {
    const out = parseEnvFile("# comment\n\nA=1\nB = two \n#X=skip\nC=eq=in=value\n");
    expect(out).toEqual({ A: "1", B: "two", C: "eq=in=value" });
  });

  it("strips surrounding quotes from values", () => {
    expect(parseEnvFile(`A="quoted"\nB='single'`)).toEqual({ A: "quoted", B: "single" });
  });
});

describe("withTimeout", () => {
  it("resolves when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "x")).resolves.toBe("ok");
  });

  it("rejects with the label when it times out", async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, "claude -p")).rejects.toThrow(/claude -p.*timed out/i);
  });
});

describe("formatResults + hasFailure", () => {
  const results: CheckResult[] = [
    { name: "Env", status: "ok", detail: "all present" },
    { name: "Finnhub", status: "warn", detail: "no key" },
    { name: "Claude", status: "fail", detail: "exit 1" },
  ];

  it("formats one emoji-prefixed line per result", () => {
    const text = formatResults(results);
    expect(text).toContain("✅ Env: all present");
    expect(text).toContain("⚠️ Finnhub: no key");
    expect(text).toContain("❌ Claude: exit 1");
  });

  it("hasFailure is true only when a result has status fail", () => {
    expect(hasFailure(results)).toBe(true);
    expect(hasFailure([{ name: "x", status: "warn", detail: "" }])).toBe(false);
  });
});

describe("checkRequiredEnv", () => {
  it("ok when Telegram vars are present", () => {
    const r = checkRequiredEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });
    expect(r.status).toBe("ok");
  });
  it("fails listing the missing vars", () => {
    const r = checkRequiredEnv({});
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(r.detail).toMatch(/TELEGRAM_CHAT_ID/);
  });
});

describe("checkClaude", () => {
  it("ok when the runner returns non-empty output", async () => {
    const r = await checkClaude(async () => "OK");
    expect(r.status).toBe("ok");
  });
  it("fails when the runner throws (CLI missing or not logged in)", async () => {
    const r = await checkClaude(async () => { throw new Error("spawn claude ENOENT"); });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/ENOENT|login/i);
  });
  it("fails when the runner returns empty output", async () => {
    const r = await checkClaude(async () => "   ");
    expect(r.status).toBe("fail");
  });
});

describe("checkTelegram", () => {
  it("ok when getMe and getChat both succeed", async () => {
    const fetchFn = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("getMe")) return jsonResponse({ ok: true, result: { username: "mybot" } });
      if (u.includes("getChat")) return jsonResponse({ ok: true, result: { id: 5, type: "private" } });
      return jsonResponse({ ok: false }, false, 404);
    }) as unknown as typeof fetch;
    const r = await checkTelegram("tok", "5", fetchFn);
    expect(r.status).toBe("ok");
    expect(r.detail).toMatch(/mybot/);
  });
  it("fails when getMe rejects the token", async () => {
    const fetchFn = (async () => jsonResponse({ ok: false, description: "Unauthorized" }, false, 401)) as unknown as typeof fetch;
    const r = await checkTelegram("bad", "5", fetchFn);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/Unauthorized|getMe/i);
  });
  it("fails when getChat cannot find the chat id", async () => {
    const fetchFn = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("getMe")) return jsonResponse({ ok: true, result: { username: "mybot" } });
      return jsonResponse({ ok: false, description: "chat not found" }, false, 400);
    }) as unknown as typeof fetch;
    const r = await checkTelegram("tok", "999", fetchFn);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/chat/i);
  });
});

import { checkFinnhub, checkTradingView, checkReddit } from "./doctor";
import { runDoctor } from "./doctor";

describe("checkFinnhub", () => {
  it("ok when /quote returns a positive current price", async () => {
    const fetchFn = (async () => jsonResponse({ c: 191.5 })) as unknown as typeof fetch;
    const r = await checkFinnhub("key", fetchFn);
    expect(r.status).toBe("ok");
  });
  it("warns (not fails) when the quote call errors", async () => {
    const fetchFn = (async () => jsonResponse({}, false, 401)) as unknown as typeof fetch;
    const r = await checkFinnhub("badkey", fetchFn);
    expect(r.status).toBe("warn");
  });
});

describe("checkTradingView", () => {
  it("ok when the scanner returns data", async () => {
    const fetchFn = (async () => jsonResponse({ data: [{ s: "AMEX:SPY", d: [500] }] })) as unknown as typeof fetch;
    const r = await checkTradingView(fetchFn);
    expect(r.status).toBe("ok");
  });
  it("warns when the scanner is unreachable", async () => {
    const fetchFn = (async () => jsonResponse({}, false, 503)) as unknown as typeof fetch;
    const r = await checkTradingView(fetchFn);
    expect(r.status).toBe("warn");
  });
});

describe("checkReddit", () => {
  it("ok when an app-only token is granted", async () => {
    const fetchFn = (async () => jsonResponse({ access_token: "abc", token_type: "bearer" })) as unknown as typeof fetch;
    const r = await checkReddit("id", "secret", "ua", fetchFn);
    expect(r.status).toBe("ok");
  });
  it("warns when the token request is refused", async () => {
    const fetchFn = (async () => jsonResponse({ error: "invalid_grant" }, false, 401)) as unknown as typeof fetch;
    const r = await checkReddit("id", "bad", "ua", fetchFn);
    expect(r.status).toBe("warn");
  });
});

describe("runDoctor", () => {
  const okFetch = (async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("getMe")) return jsonResponse({ ok: true, result: { username: "b" } });
    if (u.includes("getChat")) return jsonResponse({ ok: true, result: { type: "private" } });
    if (u.includes("finnhub")) return jsonResponse({ c: 100 });
    if (u.includes("scanner.tradingview")) return jsonResponse({ data: [{ s: "AMEX:SPY", d: [1] }] });
    if (u.includes("reddit")) return jsonResponse({ access_token: "x" });
    return jsonResponse({}, false, 404);
  }) as unknown as typeof fetch;

  it("runs env+claude+telegram+tradingview by default; skips finnhub/reddit when unconfigured", async () => {
    const results = await runDoctor({
      source: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" },
      fetchFn: okFetch,
      claudeRunner: async () => "OK",
    });
    const names = results.map((r) => r.name);
    expect(names).toEqual(["Required env", "Claude CLI", "Telegram", "TradingView"]);
    expect(results.every((r) => r.status === "ok")).toBe(true);
  });

  it("includes Finnhub and Reddit checks when those are configured", async () => {
    const results = await runDoctor({
      source: {
        TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c",
        FINNHUB_API_KEY: "fk", ENABLE_REDDIT_CRAWL: "1",
        REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "sec",
      },
      fetchFn: okFetch,
      claudeRunner: async () => "OK",
    });
    const names = results.map((r) => r.name);
    expect(names).toContain("Finnhub");
    expect(names).toContain("Reddit");
  });

  it("sends a test message when sendTest is set (extra ok result)", async () => {
    const sent: string[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("sendMessage")) { sent.push(String(init?.body ?? "")); return jsonResponse({ ok: true }); }
      if (u.includes("getMe")) return jsonResponse({ ok: true, result: { username: "b" } });
      if (u.includes("getChat")) return jsonResponse({ ok: true, result: { type: "private" } });
      if (u.includes("scanner.tradingview")) return jsonResponse({ data: [{ s: "x", d: [1] }] });
      return jsonResponse({}, false, 404);
    }) as unknown as typeof fetch;
    const results = await runDoctor({
      source: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" },
      fetchFn, claudeRunner: async () => "OK", sendTest: true,
    });
    expect(sent.length).toBe(1);
    expect(results.some((r) => r.name === "Telegram test message" && r.status === "ok")).toBe(true);
  });
});
