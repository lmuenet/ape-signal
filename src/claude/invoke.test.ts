import { describe, it, expect, vi } from "vitest";
import { invokeClaude } from "./invoke";

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
