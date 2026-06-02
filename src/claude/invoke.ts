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
export const spawnClaudeRunner: ClaudeRunner = (prompt) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["-p"], { stdio: ["pipe", "pipe", "pipe"] });
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

/** Run Claude on a prompt and return its raw stdout. */
export async function invokeClaude(prompt: string, options: InvokeOptions = {}): Promise<string> {
  const runner = options.runner ?? spawnClaudeRunner;
  try {
    return await runner(prompt);
  } catch (err) {
    throw new Error(`Claude CLI failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
