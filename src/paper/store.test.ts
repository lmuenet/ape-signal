import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendJournal, berlinDay, berlinStamp, loadPortfolio, readJournalTail, savePortfolio } from "./store";
import { freshPortfolio } from "./types";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ape-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("portfolio store", () => {
  it("returns a fresh portfolio with the start balance on first run", () => {
    const p = loadPortfolio(dir, 1000);
    expect(p.balance).toBe(1000);
    expect(p.positions).toEqual([]);
  });

  it("round-trips a saved portfolio", () => {
    const p = { ...freshPortfolio(800), balance: 815.5 };
    savePortfolio(dir, p);
    expect(loadPortfolio(dir, 1000)).toEqual(p);
  });

  it("throws on a corrupt portfolio file instead of silently resetting", () => {
    savePortfolio(dir, freshPortfolio(1000));
    const path = join(dir, "portfolio.json");
    writeFileSync(path, '{"oops": true}', "utf8");
    expect(() => loadPortfolio(dir, 1000)).toThrow(/Corrupt/);
  });
});

describe("journal", () => {
  it("creates the file with a title and appends entries", () => {
    appendJournal(dir, "Kandidatenkür", "Erster Eintrag.", new Date("2026-06-09T13:45:00Z"));
    appendJournal(dir, "Tick", "Zweiter Eintrag.", new Date("2026-06-09T14:15:00Z"));
    const content = readFileSync(join(dir, "journal.md"), "utf8");
    expect(content).toMatch(/^# Mr Ape — Trading-Journal/);
    expect(content).toContain("## 2026-06-09 15:45 — Kandidatenkür"); // Berlin = UTC+2 (DST)
    expect(content).toContain("Zweiter Eintrag.");
  });

  it("returns the tail starting at a full entry", () => {
    appendJournal(dir, "Alt", "x".repeat(50));
    appendJournal(dir, "Neu", "Der relevante Teil.");
    const tail = readJournalTail(dir, 60);
    expect(tail.startsWith("## ")).toBe(true);
    expect(tail).toContain("Der relevante Teil.");
    expect(readJournalTail(mkdtempSync(join(tmpdir(), "empty-")), 100)).toBe("");
  });
});

describe("berlin time helpers", () => {
  it("formats Berlin wall-clock dates", () => {
    expect(berlinStamp(new Date("2026-06-09T13:45:00Z"))).toBe("2026-06-09 15:45");
    expect(berlinDay(new Date("2026-06-09T22:30:00Z"))).toBe("2026-06-10"); // past midnight in Berlin
    expect(berlinDay(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01-15"); // CET, no DST
  });
});
