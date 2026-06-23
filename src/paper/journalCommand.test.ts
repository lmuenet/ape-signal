import { describe, expect, it, vi } from "vitest";
import { runJournalCommand, type JournalDeps } from "./journalCommand";
import { freshPortfolio, type Portfolio } from "./types";

function makeDeps(p: Portfolio, claudeRaw = "{}") {
  const saved: Portfolio[] = [];
  const journal: Array<[string, string]> = [];
  const deps: JournalDeps = {
    loadPortfolio: () => p,
    savePortfolio: (x) => saved.push(x),
    appendJournal: (t, b) => journal.push([t, b]),
    readJournalTail: () => "## 2026-06-09 — Kandidatenkür\n\nNVDA long.",
    fetchQuotes: vi.fn(async () => ({})),
    claudeRunner: vi.fn(async () => claudeRaw),
  };
  return { deps, saved, journal };
}

describe("runJournalCommand", () => {
  it("renders the depot status with journal tail when called without text", async () => {
    const { deps } = makeDeps(freshPortfolio(1000));
    const reply = await runJournalCommand(undefined, deps);
    expect(reply).toContain("Guthaben (frei): €1000.00"); // EUR-Depot (ADR 0005)
    expect(reply).toContain("Kandidatenkür");
    expect(deps.claudeRunner).not.toHaveBeenCalled();
    expect(deps.fetchQuotes).not.toHaveBeenCalled(); // no positions
  });

  it("applies an interpreted set_balance and journals it", async () => {
    const raw = '{"action":"set_balance","amount":500,"note":"Guthaben auf $500 gesetzt."}';
    const { deps, saved, journal } = makeDeps(freshPortfolio(1000), raw);
    const reply = await runJournalCommand("dein guthaben ist jetzt 500", deps);
    expect(saved.at(-1)?.balance).toBe(500);
    expect(journal[0][0]).toBe("Verwaltung");
    expect(reply).toContain("€500.00"); // gerenderter Kontostand in EUR (ADR 0005)
  });

  it("leaves the balance untouched on an uninterpretable instruction", async () => {
    const { deps, saved } = makeDeps(freshPortfolio(1000), "tut mir leid, kein json");
    const reply = await runJournalCommand("blubb", deps);
    expect(saved).toHaveLength(0);
    expect(reply).toContain("nicht eindeutig");
  });

  it("handles a pure note without balance change", async () => {
    const raw = '{"action":"note","amount":null,"note":"Besitzer wünscht mehr Vorsicht."}';
    const { deps, saved, journal } = makeDeps(freshPortfolio(750), raw);
    const reply = await runJournalCommand("sei vorsichtiger diese woche", deps);
    expect(saved.at(-1)?.balance).toBe(750);
    expect(journal[0][1]).toContain("Vorsicht");
    expect(reply).toContain("unverändert");
  });
});
