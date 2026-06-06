// src/config/doctor.ts — self-host diagnostics ("npm run doctor").
// Pure, dependency-injected checks + a thin entrypoint. No new runtime deps.

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
