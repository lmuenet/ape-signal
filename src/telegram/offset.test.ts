import { describe, it, expect, afterEach } from "vitest";
import { readOffset, writeOffset } from "./offset";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ape-offset-"));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("offset store", () => {
  it("returns 0 when the file is missing", () => {
    expect(readOffset(join(dir, "nope.txt"))).toBe(0);
  });

  it("round-trips a written offset", () => {
    const p = join(dir, "offset.txt");
    writeOffset(p, 4242);
    expect(readOffset(p)).toBe(4242);
  });

  it("returns 0 for a corrupt file", () => {
    const p = join(dir, "bad.txt");
    writeOffset(p, NaN as unknown as number);
    expect(readOffset(p)).toBe(0);
  });
});
