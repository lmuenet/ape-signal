import { afterEach, describe, it, expect, vi } from "vitest";
import {
  classifyClaudeOutcome,
  ClaudeLimitError,
  ClaudeTimeoutError,
  createClaudeRunner,
  invokeClaude,
  resolveWatchdog,
  CLAUDE_DEFAULTS,
} from "./invoke";

describe("invokeClaude", () => {
  it("passes the prompt to the runner and returns its stdout", async () => {
    const runner = vi.fn(async (prompt: string) => `echoed: ${prompt}`);
    const out = await invokeClaude("classify this", { runner });
    expect(runner).toHaveBeenCalledWith("classify this");
    expect(out).toBe("echoed: classify this");
  });

  it("wraps runner failures with context", async () => {
    const runner = vi.fn(async () => {
      throw new Error("spawn ENOENT");
    });
    await expect(invokeClaude("x", { runner })).rejects.toThrow(/Claude CLI failed: spawn ENOENT/);
  });
});

describe("classifyClaudeOutcome", () => {
  it("accepts a non-empty exit-0 run", () => {
    expect(classifyClaudeOutcome({ code: 0, stdout: '{"x":1}', stderr: "" })).toEqual({
      ok: true,
      stdout: '{"x":1}',
    });
  });

  it("treats empty exit-0 output as an error (not a limit)", () => {
    const r = classifyClaudeOutcome({ code: 0, stdout: "   ", stderr: "" });
    expect(r).toMatchObject({ ok: false, kind: "error" });
  });

  it("flags a usage-limit message on a non-zero exit", () => {
    const r = classifyClaudeOutcome({
      code: 1,
      stdout: "",
      stderr: "Claude AI usage limit reached. Resets at 5pm.",
    });
    expect(r).toMatchObject({ ok: false, kind: "limit" });
  });

  it("flags a short limit body even on exit 0", () => {
    const r = classifyClaudeOutcome({ code: 0, stdout: "rate limit exceeded", stderr: "" });
    expect(r).toMatchObject({ ok: false, kind: "limit" });
  });

  it("does NOT flag a long research result that merely mentions 'rate limit'", () => {
    const body =
      '{"marketContext":"The Fed signalled patience; traders debate whether a rate limit on hikes is near. ' +
      "Liquidity stayed ample and breadth improved across megacaps, with semis leading and defensives lagging " +
      'into the close as volumes normalised after the open."}';
    expect(classifyClaudeOutcome({ code: 0, stdout: body, stderr: "" })).toEqual({ ok: true, stdout: body });
  });

  it("reports a generic non-zero exit as an error", () => {
    expect(classifyClaudeOutcome({ code: 2, stdout: "", stderr: "boom" })).toMatchObject({
      ok: false,
      kind: "error",
      message: expect.stringContaining("exit 2"),
    });
  });
});

describe("resolveWatchdog", () => {
  it("defaults when the env vars are absent", () => {
    expect(resolveWatchdog({})).toEqual({
      timeoutMs: CLAUDE_DEFAULTS.timeoutMs,
      slowAfterMs: CLAUDE_DEFAULTS.slowAfterMs,
    });
  });

  it("reads minutes from CLAUDE_TIMEOUT_MIN / CLAUDE_SLOW_MIN", () => {
    expect(resolveWatchdog({ CLAUDE_TIMEOUT_MIN: "10", CLAUDE_SLOW_MIN: "2" })).toEqual({
      timeoutMs: 10 * 60_000,
      slowAfterMs: 2 * 60_000,
    });
  });

  it("ignores non-positive / non-numeric overrides", () => {
    expect(resolveWatchdog({ CLAUDE_TIMEOUT_MIN: "0", CLAUDE_SLOW_MIN: "nope" })).toEqual({
      timeoutMs: CLAUDE_DEFAULTS.timeoutMs,
      slowAfterMs: CLAUDE_DEFAULTS.slowAfterMs,
    });
  });
});

/** A controllable fake of the Node child process for runner tests. */
function makeFakeChild() {
  const stdoutCbs: Array<(d: Buffer) => void> = [];
  const stderrCbs: Array<(d: Buffer) => void> = [];
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  const child = {
    stdout: { on: (_e: string, cb: (d: Buffer) => void) => stdoutCbs.push(cb) },
    stderr: { on: (_e: string, cb: (d: Buffer) => void) => stderrCbs.push(cb) },
    stdin: { write: vi.fn(), end: vi.fn() },
    kill: vi.fn(),
    on(event: string, cb: (...a: unknown[]) => void) {
      (listeners[event] ??= []).push(cb);
      return child;
    },
    emitStdout: (s: string) => stdoutCbs.forEach((cb) => cb(Buffer.from(s))),
    emitStderr: (s: string) => stderrCbs.forEach((cb) => cb(Buffer.from(s))),
    emitClose: (code: number | null) => (listeners.close ?? []).forEach((cb) => cb(code)),
    emitError: (err: Error) => (listeners.error ?? []).forEach((cb) => cb(err)),
  };
  return child;
}

describe("createClaudeRunner (watchdog + timing)", () => {
  afterEach(() => vi.useRealTimers());

  it("passes model/allowedTools as CLI args and writes the prompt to stdin", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child as never);
    const run = createClaudeRunner({ model: "opus", allowedTools: ["WebSearch", "Skill"], spawnFn, log: () => {} });
    const p = run("hello");
    expect(spawnFn).toHaveBeenCalledWith(
      "claude",
      ["-p", "--model", "opus", "--allowedTools", "WebSearch,Skill"],
      expect.anything(),
    );
    expect(child.stdin.write).toHaveBeenCalledWith("hello");
    expect(child.stdin.end).toHaveBeenCalled();
    child.emitStdout("ok-output");
    child.emitClose(0);
    expect(await p).toBe("ok-output");
  });

  it("rejects with ClaudeLimitError when the output signals a usage limit", async () => {
    const child = makeFakeChild();
    const run = createClaudeRunner({ spawnFn: () => child as never, log: () => {} });
    const p = run("x");
    child.emitStderr("Claude AI usage limit reached");
    child.emitClose(1);
    await expect(p).rejects.toBeInstanceOf(ClaudeLimitError);
  });

  it("fires onSlow once after the threshold, then resolves", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    const onSlow = vi.fn();
    const run = createClaudeRunner({
      spawnFn: () => child as never,
      onSlow,
      slowAfterMs: 1000,
      timeoutMs: 10_000,
      label: "Research",
      log: () => {},
    });
    const p = run("x");
    vi.advanceTimersByTime(1000);
    expect(onSlow).toHaveBeenCalledTimes(1);
    expect(onSlow.mock.calls[0][0]).toMatchObject({ label: "Research" });
    child.emitStdout("done");
    child.emitClose(0);
    expect(await p).toBe("done");
  });

  it("does not fire onSlow if the call finishes first", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    const onSlow = vi.fn();
    const run = createClaudeRunner({ spawnFn: () => child as never, onSlow, slowAfterMs: 1000, log: () => {} });
    const p = run("x");
    child.emitStdout("fast");
    child.emitClose(0);
    await p;
    vi.advanceTimersByTime(5000);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it("kills the child and rejects with ClaudeTimeoutError on timeout", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    const run = createClaudeRunner({ spawnFn: () => child as never, timeoutMs: 1000, slowAfterMs: 5000, log: () => {} });
    const p = run("x");
    vi.advanceTimersByTime(1000);
    await expect(p).rejects.toBeInstanceOf(ClaudeTimeoutError);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
