import { spawn } from "node:child_process";

export type ClaudeRunner = (prompt: string) => Promise<string>;

export interface InvokeOptions {
  runner?: ClaudeRunner;
}

/**
 * Default runner: spawn the Claude Code CLI in print mode reading the prompt
 * from stdin (avoids command-line length limits for large briefings). Relies on
 * `claude login` having been run once on the host (subscription auth).
 */
export const spawnClaudeRunner: ClaudeRunner = (prompt) => runClaude(prompt, []);

export interface RunnerOptions {
  /** Model alias passed to `claude -p --model` (e.g. "sonnet", "opus"). */
  model?: string;
  /** Tools the headless run may use without prompting (e.g. ["WebSearch"]). */
  allowedTools?: string[];
}

/**
 * Build a runner for a specific model/tool budget. Used by the paper-trading
 * pipelines: Sonnet researches (with WebSearch), Opus decides, ticks stay on
 * Sonnet — the token-efficiency split is deliberate.
 */
export function createClaudeRunner(options: RunnerOptions): ClaudeRunner {
  const args: string[] = [];
  if (options.model) args.push("--model", options.model);
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }
  return (prompt) => runClaude(prompt, args);
}

function runClaude(prompt: string, extraArgs: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["-p", ...extraArgs], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`exit ${code}: ${stderr.trim()}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Run Claude on a prompt and return its raw stdout. */
export async function invokeClaude(prompt: string, options: InvokeOptions = {}): Promise<string> {
  const runner = options.runner ?? spawnClaudeRunner;
  try {
    return await runner(prompt);
  } catch (err) {
    throw new Error(`Claude CLI failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
