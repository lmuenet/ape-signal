// src/config/doctor.ts — self-host diagnostics ("npm run doctor").
// Pure, dependency-injected checks + a thin entrypoint. No new runtime deps.
import { readFileSync, existsSync } from "node:fs";
import { loadEnv, truthy } from "./env";
import { activeMarkets, loadSession } from "./session";
import { marketIsOpen } from "./marketCalendar";
import { postScan } from "../core/tvScanner";
import { spawnClaudeRunner } from "../claude/invoke";

export type CheckStatus = "ok" | "warn" | "fail";
export interface CheckResult { name: string; status: CheckStatus; detail: string; }
export type Runner = (prompt: string) => Promise<string>;

/** Parse a KEY=VALUE env file: skip blank/`#` lines, trim, strip matching quotes. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key !== "") out[key] = value;
  }
  return out;
}

/** Reject if `p` does not settle within `ms`, so a diagnostic can't hang forever. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const EMOJI: Record<CheckStatus, string> = { ok: "✅", warn: "⚠️", fail: "❌" };

/** Render one emoji-prefixed line per check result. */
export function formatResults(results: CheckResult[]): string {
  return results.map((r) => `${EMOJI[r.status]} ${r.name}: ${r.detail}`).join("\n");
}

/** True if any check hard-failed (used for the process exit code). */
export function hasFailure(results: CheckResult[]): boolean {
  return results.some((r) => r.status === "fail");
}

/** Required env present (Telegram) + aktive Sprache. Hard-fail mit Liste des Fehlenden. */
export function checkRequiredEnv(source: Record<string, string | undefined>): CheckResult {
  try {
    const env = loadEnv(source);
    return {
      name: "Required env",
      status: "ok",
      detail: `TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID present (Sprache: ${env.language})`,
    };
  } catch (err) {
    return { name: "Required env", status: "fail", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Aktive Märkte (A2): pro Markt Fenster + Kür, kombiniertes Fenster, Tick-Default
 *  und ein „heute geschlossen"-Hinweis. Hard-fail bei Config-Fehler. */
export function checkSession(source: Record<string, string | undefined>, now: Date = new Date()): CheckResult {
  try {
    const markets = activeMarkets(source);
    const s = loadSession(source);
    const perMarket = markets.map((m) => `${m.display} ${m.open}–${m.close} (Kür ${m.kuerScan})`).join(" + ");
    const closed = markets.filter((m) => !marketIsOpen(m.name, now)).map((m) => m.display);
    const note = closed.length ? ` · heute geschlossen: ${closed.join(", ")}` : "";
    return {
      name: "Session",
      status: "ok",
      detail: `${perMarket} · Fenster ${s.open}–${s.close} · Tick ${s.tickIntervalMin}min${note}`,
    };
  } catch (err) {
    return { name: "Session", status: "fail", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Claude CLI installed AND authenticated as the current user (one probe). */
export async function checkClaude(runner: Runner): Promise<CheckResult> {
  try {
    const out = await runner("Reply with the single word: OK");
    if (out.trim() === "") {
      return { name: "Claude CLI", status: "fail", detail: "claude -p returned empty output" };
    }
    return { name: "Claude CLI", status: "ok", detail: "claude -p responded" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: "Claude CLI", status: "fail", detail: `${msg} — is Claude Code installed and logged in as this user?` };
  }
}

const TG_API = "https://api.telegram.org";

interface TgResponse { ok?: boolean; description?: string; result?: { username?: string; type?: string } }

async function tgGet(url: string, fetchFn: typeof fetch): Promise<TgResponse> {
  const res = await fetchFn(url);
  return (await res.json().catch(() => ({}))) as TgResponse;
}

/** Telegram bot token valid (getMe) + chat reachable (getChat). Silent. */
export async function checkTelegram(botToken: string, chatId: string, fetchFn: typeof fetch): Promise<CheckResult> {
  try {
    const me = await tgGet(`${TG_API}/bot${botToken}/getMe`, fetchFn);
    if (!me.ok) return { name: "Telegram", status: "fail", detail: `getMe: ${me.description ?? "token rejected"}` };
    const chat = await tgGet(`${TG_API}/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`, fetchFn);
    if (!chat.ok) return { name: "Telegram", status: "fail", detail: `getChat: ${chat.description ?? "chat not found"}` };
    return { name: "Telegram", status: "ok", detail: `bot @${me.result?.username ?? "?"} → chat ${chatId} (${chat.result?.type ?? "?"})` };
  } catch (err) {
    return { name: "Telegram", status: "fail", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Finnhub key works: a /quote probe returns a positive current price. Optional → warn. */
export async function checkFinnhub(apiKey: string, fetchFn: typeof fetch): Promise<CheckResult> {
  try {
    const res = await fetchFn(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(apiKey)}`);
    const data = (await res.json().catch(() => ({}))) as { c?: number };
    if (res.ok && typeof data.c === "number" && data.c > 0) {
      return { name: "Finnhub", status: "ok", detail: `quote AAPL=${data.c}` };
    }
    return { name: "Finnhub", status: "warn", detail: `quote probe failed (HTTP ${res.status}) — earnings/news will be skipped` };
  } catch (err) {
    return { name: "Finnhub", status: "warn", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** TradingView scanner reachable (no key). Optional → warn (the briefing degrades). */
export async function checkTradingView(fetchFn: typeof fetch): Promise<CheckResult> {
  try {
    const resp = await postScan(fetchFn, {
      symbols: { tickers: ["AMEX:SPY"], query: { types: [] } },
      columns: ["close"],
    });
    if (resp.data && resp.data.length > 0) {
      return { name: "TradingView", status: "ok", detail: "scanner reachable" };
    }
    return { name: "TradingView", status: "warn", detail: "scanner returned no data" };
  } catch (err) {
    return { name: "TradingView", status: "warn", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Reddit app-only OAuth (client_credentials) yields a token. Optional → warn. */
export async function checkReddit(clientId: string, clientSecret: string, userAgent: string, fetchFn: typeof fetch): Promise<CheckResult> {
  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetchFn("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body: "grant_type=client_credentials",
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (res.ok && data.access_token) {
      return { name: "Reddit", status: "ok", detail: "app-only token granted" };
    }
    return { name: "Reddit", status: "warn", detail: `token request failed: ${data.error ?? res.status}` };
  } catch (err) {
    return { name: "Reddit", status: "warn", detail: err instanceof Error ? err.message : String(err) };
  }
}

export interface DoctorDeps {
  source: Record<string, string | undefined>;
  fetchFn: typeof fetch;
  claudeRunner: Runner;
  sendTest?: boolean;
}

async function sendTestMessage(botToken: string, chatId: string, fetchFn: typeof fetch): Promise<CheckResult> {
  try {
    const res = await fetchFn(`${TG_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "✅ ape-signal doctor: Test-Nachricht — Bot→Chat funktioniert." }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (res.ok && data.ok) return { name: "Telegram test message", status: "ok", detail: "sent" };
    // Opt-in extra — a glitch here should warn, not fail the whole doctor's exit code.
    return { name: "Telegram test message", status: "warn", detail: data.description ?? `HTTP ${res.status}` };
  } catch (err) {
    return { name: "Telegram test message", status: "warn", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Run every applicable check and return the results, in display order. */
export async function runDoctor(deps: DoctorDeps): Promise<CheckResult[]> {
  const { source, fetchFn, claudeRunner } = deps;
  const results: CheckResult[] = [];
  results.push(checkRequiredEnv(source));
  results.push(checkSession(source));
  results.push(await checkClaude(claudeRunner));

  const botToken = source.TELEGRAM_BOT_TOKEN;
  const chatId = source.TELEGRAM_CHAT_ID;
  if (botToken && chatId) {
    results.push(await checkTelegram(botToken, chatId, fetchFn));
    if (deps.sendTest) results.push(await sendTestMessage(botToken, chatId, fetchFn));
  }

  if (source.FINNHUB_API_KEY) results.push(await checkFinnhub(source.FINNHUB_API_KEY, fetchFn));
  results.push(await checkTradingView(fetchFn));
  if (truthy(source.ENABLE_REDDIT_CRAWL) && source.REDDIT_CLIENT_ID && source.REDDIT_CLIENT_SECRET) {
    results.push(await checkReddit(source.REDDIT_CLIENT_ID, source.REDDIT_CLIENT_SECRET, source.REDDIT_USER_AGENT ?? "ape-signal/doctor", fetchFn));
  }
  return results;
}

/** Resolve and read an env file into a record. Order: explicit path, /etc, ./.env. */
function loadEnvFile(explicit: string | undefined): Record<string, string> {
  const candidates = explicit ? [explicit] : ["/etc/ape-signal.env", "./.env"];
  for (const path of candidates) {
    if (existsSync(path)) {
      return parseEnvFile(readFileSync(path, "utf8"));
    }
  }
  return {};
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const envFileArg = args.find((a) => a.startsWith("--env-file="))?.slice("--env-file=".length);
  const sendTest = args.includes("--send-test");

  // File values fill only gaps — ambient/systemd env wins so we never clobber it.
  const fileEnv = loadEnvFile(envFileArg);
  for (const [k, v] of Object.entries(fileEnv)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  const results = await runDoctor({
    source: process.env,
    fetchFn: fetch,
    claudeRunner: (prompt) => withTimeout(spawnClaudeRunner(prompt), 60_000, "claude -p"),
    sendTest,
  });
  console.log(formatResults(results));
  process.exitCode = hasFailure(results) ? 1 : 0;
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith("doctor.ts")) {
  void main();
}
