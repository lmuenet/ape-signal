import { describe, it, expect } from "vitest";
import { parseEnvFile, withTimeout, formatResults, hasFailure, type CheckResult } from "./doctor";

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
