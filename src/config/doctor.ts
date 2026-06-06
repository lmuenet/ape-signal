// src/config/doctor.ts — self-host diagnostics ("npm run doctor").
// Pure, dependency-injected checks + a thin entrypoint. No new runtime deps.
import { loadEnv } from "./env";

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

/** Required env present (Telegram). Hard-fail with the list of what's missing. */
export function checkRequiredEnv(source: Record<string, string | undefined>): CheckResult {
  try {
    loadEnv(source);
    return { name: "Required env", status: "ok", detail: "TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID present" };
  } catch (err) {
    return { name: "Required env", status: "fail", detail: err instanceof Error ? err.message : String(err) };
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
