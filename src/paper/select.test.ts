import { describe, expect, it, vi } from "vitest";
import { runKuer, type KuerDeps } from "./select";
import { berlinDay } from "./store";
import { freshPortfolio, type Portfolio, type QuoteMap } from "./types";

const NOW = new Date("2026-06-09T13:15:00Z"); // 15:15 Berlin
const DAY = "2026-06-09";

const DOSSIER = JSON.stringify({
  candidates: [{ ticker: "NVDA", angle: "Long Momentum", catalyst: "Earnings Beat", sentiment: "euphorisch" }],
  marketContext: "risk-on",
});

const DECISION = JSON.stringify({
  trades: [
    { ticker: "NVDA", side: "long", stake: 150, leverage: 2, entry: "market", stopLoss: 95, takeProfit: 120, thesis: "Momentum" },
  ],
  journal: "Heute ein Trade: NVDA long.",
});

const DEBATE = JSON.stringify({
  debates: [{ ticker: "NVDA", bull: "Starkes Momentum nach Earnings-Beat", bear: "Bewertung überkauft, Gap-Risiko nach oben gelaufen" }],
});

function makeDeps(p: Portfolio, quotes: QuoteMap, over: Partial<KuerDeps> = {}) {
  const saved: Portfolio[] = [];
  const journal: Array<[string, string]> = [];
  const sent: string[] = [];
  const deps: KuerDeps = {
    loadPortfolio: () => p,
    savePortfolio: (x) => saved.push(x),
    appendJournal: (t, b) => journal.push([t, b]),
    readJournalTail: () => "",
    fetchQuotes: vi.fn(async () => quotes),
    researchRunner: vi.fn(async () => DOSSIER),
    debateRunner: vi.fn(async () => DEBATE),
    decideRunner: vi.fn(async () => DECISION),
    send: vi.fn(async (t: string) => {
      sent.push(t);
    }),
    now: () => NOW,
    berlinDay,
    ...over,
  };
  return { deps, saved, journal, sent };
}

const quotes: QuoteMap = { NVDA: { close: 100, changePct: 1, high: 101, low: 99 } };

describe("runKuer", () => {
  it("places the decided order, saves, journals and posts the Kür", async () => {
    const { deps, saved, journal, sent } = makeDeps(freshPortfolio(1000), quotes);
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1);
    expect(saved.at(-1)?.balance).toBe(850); // stake reserved
    expect(journal[0][0]).toBe("Kandidatenkür");
    expect(journal[0][1]).toContain("NVDA long");
    expect(sent[0]).toContain("Kandidatenkür");
    expect(sent[0]).toContain("NVDA");
  });

  it("degrades to scan-only context when research fails", async () => {
    const { deps, saved } = makeDeps(freshPortfolio(1000), quotes, {
      researchRunner: vi.fn(async () => {
        throw new Error("websearch down");
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1); // Opus still decided
    const prompt = (deps.decideRunner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("Research fehlgeschlagen");
  });

  it("feeds the bull/bear debate into the decision prompt", async () => {
    const { deps } = makeDeps(freshPortfolio(1000), quotes);
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    const prompt = (deps.decideRunner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("Bull/Bear");
    expect(prompt).toContain("Gap-Risiko");
  });

  it("degrades to a debate-free decision when the debate fails", async () => {
    const { deps, saved } = makeDeps(freshPortfolio(1000), quotes, {
      debateRunner: vi.fn(async () => {
        throw new Error("sonnet down");
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1); // Opus still decided
    const prompt = (deps.decideRunner as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("keine Debatte");
  });

  it("skips the debate when research already failed (nothing to debate)", async () => {
    const { deps } = makeDeps(freshPortfolio(1000), quotes, {
      researchRunner: vi.fn(async () => {
        throw new Error("websearch down");
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(deps.debateRunner).not.toHaveBeenCalled();
  });

  it("skips the day on an unreadable decision instead of guessing", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () => "Ich würde gerne NVDA kaufen, aber ohne JSON."),
    });
    await runKuer({ scanSummary: "" }, deps);
    expect(saved).toHaveLength(0);
    expect(sent[0]).toContain("ausgefallen");
  });

  it("skips entirely when the daily budget is already used", async () => {
    const p: Portfolio = {
      ...freshPortfolio(400),
      orders: [1, 2, 3].map((i) => ({
        id: `X-${DAY}-${i}`,
        ticker: "X",
        side: "long" as const,
        stake: 100,
        leverage: 1,
        entryType: "market" as const,
        stopLoss: 1,
        thesis: "",
        createdAt: NOW.toISOString(),
        day: DAY,
      })),
    };
    const { deps, sent } = makeDeps(p, quotes);
    await runKuer({ scanSummary: "" }, deps);
    expect(deps.researchRunner).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("accepts a zero-trade decision and still journals it", async () => {
    const { deps, saved, journal, sent } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () => '{"trades": [], "journal": "Nichts überzeugt heute."}'),
    });
    await runKuer({ scanSummary: "" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(0);
    expect(journal[0][1]).toContain("Nichts überzeugt");
    expect(sent[0]).toContain("keine neuen Trades");
  });
});
