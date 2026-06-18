import { spawn } from "node:child_process";

export type ClaudeRunner = (prompt: string) => Promise<string>;

/**
 * Default watchdog thresholds for the autonomous paper-trading calls. Both are
 * deliberately generous — the goal of this first pass is to MEASURE real per-call
 * durations (stage timing logs) and only then tune. Override per call (or via
 * CLAUDE_TIMEOUT_MIN / CLAUDE_SLOW_MIN, see {@link resolveWatchdog}).
 */
export const CLAUDE_DEFAULTS = {
  /** Hard safety timeout per call: kill the child + throw ClaudeTimeoutError. */
  timeoutMs: 20 * 60_000,
  /** Interim "still working" watchdog: fire onSlow once after this long. */
  slowAfterMs: 5 * 60_000,
} as const;

/** Why a Claude call failed, so callers can post a specific Telegram alert. */
export type ClaudeErrorKind = "limit" | "timeout" | "error";

/** A typed `claude -p` failure. Callers branch on `kind` for specific alerts. */
export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly kind: ClaudeErrorKind,
    readonly label?: string,
  ) {
    super(message);
    this.name = "ClaudeError";
  }
}

/** The subscription/usage/rate limit hit (5h-Limit) — distinct from a crash. */
export class ClaudeLimitError extends ClaudeError {
  constructor(message: string, label?: string) {
    super(message, "limit", label);
    this.name = "ClaudeLimitError";
  }
}

/** The call exceeded its hard timeout and the child was killed. */
export class ClaudeTimeoutError extends ClaudeError {
  constructor(message: string, label?: string) {
    super(message, "timeout", label);
    this.name = "ClaudeTimeoutError";
  }
}

/**
 * Phrases that mark a subscription/usage/rate limit in the CLI's output.
 * Best-effort by design: the real message text is captured in the timing log
 * (stderr) on the first live limit, so this list can be sharpened from evidence.
 */
const LIMIT_PATTERNS: RegExp[] = [
  /usage limit/i,
  /rate limit/i,
  /limit reached/i,
  /too many requests/i,
  /\b429\b/,
  /quota/i,
  /resets? at/i,
  /overloaded/i,
];

export interface ClaudeOutcomeInput {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ClaudeOutcome =
  | { ok: true; stdout: string }
  | { ok: false; kind: "limit" | "error"; message: string };

/**
 * Classify a finished `claude -p` run. The real usage-limit notice is a plain
 * text message, never JSON — so a valid JSON answer on a clean exit is always a
 * real result, even if its prose mentions "rate limit". Otherwise a known limit
 * phrase (in stdout or stderr) marks the 5h-subscription limit, distinct from a
 * generic crash.
 */
export function classifyClaudeOutcome({ code, stdout, stderr }: ClaudeOutcomeInput): ClaudeOutcome {
  const trimmed = stdout.trim();
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const looksLimited = LIMIT_PATTERNS.some((re) => re.test(`${stdout}\n${stderr}`));
  if (!(looksJson && code === 0) && looksLimited) {
    const line = (stderr.trim() || trimmed || "usage limit").split("\n")[0];
    return { ok: false, kind: "limit", message: line.slice(0, 200) };
  }
  if (code === 0) {
    if (trimmed === "") return { ok: false, kind: "error", message: "claude -p returned empty output" };
    return { ok: true, stdout };
  }
  return { ok: false, kind: "error", message: `exit ${code}: ${stderr.trim().slice(0, 300)}` };
}

export interface RunnerOptions {
  /** Model alias passed to `claude -p --model` (e.g. "sonnet", "opus"). */
  model?: string;
  /** Tools the headless run may use without prompting (e.g. ["WebSearch"]). */
  allowedTools?: string[];
  /** Hard timeout (ms): kill the child + throw ClaudeTimeoutError. */
  timeoutMs?: number;
  /** Watchdog (ms): call onSlow once if the call is still running. */
  slowAfterMs?: number;
  /** Interim "still working" hook (e.g. a Telegram ping). Fired at most once. */
  onSlow?: (info: { label: string; elapsedMs: number }) => void;
  /** Human label for logs/alerts ("Research", "Entscheidung", "Manager", …). */
  label?: string;
  /** Injectable spawn for tests. */
  spawnFn?: typeof spawn;
  /** Diagnostics sink — defaults to stderr. NEVER stdout (callers parse stdout). */
  log?: (line: string) => void;
}

export interface InvokeOptions {
  runner?: ClaudeRunner;
}

/**
 * Default runner: spawn the Claude Code CLI in print mode reading the prompt
 * from stdin (avoids command-line length limits for large briefings). Relies on
 * `claude login` having been run once on the host (subscription auth).
 */
export const spawnClaudeRunner: ClaudeRunner = (prompt) => runClaude(prompt, [], {});

/**
 * Build a runner for a specific model/tool budget plus a watchdog. Used by the
 * paper-trading pipelines: Sonnet researches (with WebSearch), Opus decides,
 * ticks stay on Sonnet — the token-efficiency split is deliberate. The watchdog
 * (timeout + onSlow) and the stage-timing log make a hanging or limited backend
 * visible instead of a silent gap.
 */
export function createClaudeRunner(options: RunnerOptions = {}): ClaudeRunner {
  const args: string[] = [];
  if (options.model) args.push("--model", options.model);
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }
  return (prompt) => runClaude(prompt, args, options);
}

/** Resolve the watchdog thresholds, honouring CLAUDE_TIMEOUT_MIN / CLAUDE_SLOW_MIN (minutes). */
export function resolveWatchdog(env: Record<string, string | undefined>): {
  timeoutMs: number;
  slowAfterMs: number;
} {
  const minutesOr = (key: string, fallback: number): number => {
    const v = Number(env[key]);
    return Number.isFinite(v) && v > 0 ? v * 60_000 : fallback;
  };
  return {
    timeoutMs: minutesOr("CLAUDE_TIMEOUT_MIN", CLAUDE_DEFAULTS.timeoutMs),
    slowAfterMs: minutesOr("CLAUDE_SLOW_MIN", CLAUDE_DEFAULTS.slowAfterMs),
  };
}

function secondsSince(startedAt: number): number {
  return Math.round((Date.now() - startedAt) / 1000);
}

function runClaude(prompt: string, extraArgs: string[], opts: RunnerOptions): Promise<string> {
  const spawnFn = opts.spawnFn ?? spawn;
  const label = opts.label ?? "claude";
  const log = opts.log ?? ((line: string) => console.error(line));
  const timeoutMs = opts.timeoutMs ?? CLAUDE_DEFAULTS.timeoutMs;
  const slowAfterMs = opts.slowAfterMs ?? CLAUDE_DEFAULTS.slowAfterMs;
  const startedAt = Date.now();

  return new Promise<string>((resolve, reject) => {
    const child = spawnFn("claude", ["-p", ...extraArgs], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const slowTimer = setTimeout(() => {
      if (settled) return;
      try {
        opts.onSlow?.({ label, elapsedMs: Date.now() - startedAt });
      } catch (err) {
        log(`[claude:${label}] onSlow hook threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, slowAfterMs);

    const hardTimer = setTimeout(() => {
      if (settled) return;
      log(`[claude:${label}] TIMEOUT after ${secondsSince(startedAt)}s — killing the child`);
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      // Escalate if SIGTERM is ignored. Untracked on purpose: harmless once dead.
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 2_000);
      finish(() =>
        reject(new ClaudeTimeoutError(`Claude (${label}) timed out after ${Math.round(timeoutMs / 1000)}s`, label)),
      );
    }, timeoutMs);

    function finish(act: () => void): void {
      settled = true;
      clearTimeout(slowTimer);
      clearTimeout(hardTimer);
      act();
    }

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err: Error) => {
      if (settled) return;
      log(`[claude:${label}] spawn error after ${secondsSince(startedAt)}s: ${err.message}`);
      finish(() => reject(new ClaudeError(`Claude CLI spawn failed: ${err.message}`, "error", label)));
    });

    child.on("close", (code: number | null) => {
      if (settled) return;
      const elapsed = secondsSince(startedAt);
      const outcome = classifyClaudeOutcome({ code, stdout, stderr });
      if (outcome.ok) {
        log(`[claude:${label}] ok in ${elapsed}s (${outcome.stdout.length} chars)`);
        return finish(() => resolve(outcome.stdout));
      }
      if (outcome.kind === "limit") {
        log(`[claude:${label}] LIMIT after ${elapsed}s: ${outcome.message}`);
        return finish(() => reject(new ClaudeLimitError(`Claude limitiert (${label}): ${outcome.message}`, label)));
      }
      log(`[claude:${label}] failed after ${elapsed}s: ${outcome.message}`);
      return finish(() => reject(new ClaudeError(`Claude CLI (${label}) failed: ${outcome.message}`, "error", label)));
    });

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

/** Run Claude on a prompt and return its raw stdout. */
export async function invokeClaude(prompt: string, options: InvokeOptions = {}): Promise<string> {
  const runner = options.runner ?? spawnClaudeRunner;
  try {
    return await runner(prompt);
  } catch (err) {
    if (err instanceof ClaudeError) throw err; // keep the typed kind intact for callers
    throw new Error(`Claude CLI failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
