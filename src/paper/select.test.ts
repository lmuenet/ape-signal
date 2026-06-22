import { describe, expect, it, vi } from "vitest";
import { runKuer, type KuerDeps } from "./select";
import { berlinDay } from "./store";
import { freshPortfolio, type Portfolio, type QuoteMap, type WatchlistState } from "./types";
import type { KuerArtifact } from "./kuerArtifact";
import { ClaudeLimitError, ClaudeTimeoutError } from "../claude/invoke";

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
  const kuerSaves: KuerArtifact[] = [];
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
    saveKuer: (a) => kuerSaves.push(a),
    now: () => NOW,
    berlinDay,
    ...over,
  };
  return { deps, saved, journal, sent, kuerSaves };
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

  it("mirrors the dossier+debate to Telegram after the Kür post", async () => {
    const { deps, sent } = makeDeps(freshPortfolio(1000), quotes);
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    const kuerIdx = sent.findIndex((m) => m.includes("Kandidatenkür"));
    const mirrorIdx = sent.findIndex((m) => m.includes("Research & Debatte"));
    expect(mirrorIdx).toBeGreaterThan(kuerIdx); // mirror comes AFTER the Kür post
    expect(sent[mirrorIdx]).toContain("NVDA: Long Momentum");
  });

  it("does not break the Kür if the mirror send fails", async () => {
    const sent: string[] = [];
    const { deps, saved } = makeDeps(freshPortfolio(1000), quotes, {
      send: vi.fn(async (t: string) => {
        if (t.includes("Research & Debatte")) throw new Error("telegram down");
        sent.push(t);
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1); // Kür completed despite the mirror send throwing
    expect(sent.at(-1)).toContain("Kandidatenkür");
  });

  it("passes the configured language into the research prompt", async () => {
    let seen = "";
    const { deps } = makeDeps(freshPortfolio(1000), quotes, {
      language: "en",
      researchRunner: vi.fn(async (p: string) => { seen = p; return DOSSIER; }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(seen).toContain("ENGLISCH");
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

  it("alerts but still decides when research is rate-limited (Constraint #6)", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), quotes, {
      researchRunner: vi.fn(async () => {
        throw new ClaudeLimitError("usage limit reached", "Research");
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1); // Kür still decided on scan-only context
    expect(sent.some((m) => m.includes("reduzierter Datenbasis"))).toBe(true); // surfaced, not swallowed
    expect(sent.at(-1)).toContain("Kandidatenkür"); // and the regular Kür post still went out
  });

  it("alerts with a timeout note but still decides when research times out", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), quotes, {
      researchRunner: vi.fn(async () => {
        throw new ClaudeTimeoutError("timed out", "Research");
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1);
    expect(sent.some((m) => m.includes("Timeout") && m.includes("reduzierter Datenbasis"))).toBe(true);
  });

  it("alerts but still decides when the bull/bear debate is rate-limited", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), quotes, {
      debateRunner: vi.fn(async () => {
        throw new ClaudeLimitError("usage limit reached", "Debate");
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1); // Opus still decided
    expect(sent.some((m) => m.includes("reduzierter Datenbasis"))).toBe(true);
  });

  it("alerts with a timeout note but still decides when the bull/bear debate times out", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), quotes, {
      debateRunner: vi.fn(async () => {
        throw new ClaudeTimeoutError("timed out", "Debate");
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1);
    expect(sent.some((m) => m.includes("Timeout") && m.includes("reduzierter Datenbasis"))).toBe(true);
  });

  it("a failing degrade-alert send never aborts the Kür (still decides)", async () => {
    const sent: string[] = [];
    const { deps, saved } = makeDeps(freshPortfolio(1000), quotes, {
      researchRunner: vi.fn(async () => {
        throw new ClaudeLimitError("usage limit reached", "Research");
      }),
      send: vi.fn(async (t: string) => {
        if (t.includes("reduzierter Datenbasis")) throw new Error("telegram down"); // the degrade alert send fails
        sent.push(t);
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1); // Kür decided despite the degrade-alert send throwing
    expect(sent.at(-1)).toContain("Kandidatenkür"); // the final Kür post still went out
  });

  it("keeps a generic (non-Claude) research failure a quiet stderr degrade — no extra alert", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), quotes, {
      researchRunner: vi.fn(async () => {
        throw new Error("websearch down");
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1);
    expect(sent.filter((m) => m.includes("reduzierter Datenbasis"))).toHaveLength(0);
  });

  it("skips the day on an unreadable decision instead of guessing", async () => {
    const { deps, saved, sent } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () => "Ich würde gerne NVDA kaufen, aber ohne JSON."),
    });
    await runKuer({ scanSummary: "" }, deps);
    expect(saved).toHaveLength(0);
    expect(sent[0]).toContain("ausgefallen");
  });

  it("posts a Claude-limit alert and skips the day when the decider is rate-limited", async () => {
    const { deps, saved, sent, kuerSaves } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () => {
        throw new ClaudeLimitError("usage limit reached", "Entscheidung");
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(saved).toHaveLength(0); // no orders placed
    expect(sent[0]).toContain("limitiert");
    expect(kuerSaves.at(-1)?.status).toBe("skipped-limit");
  });

  it("posts a timeout alert and skips the day when the decider times out", async () => {
    const { deps, sent, kuerSaves } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () => {
        throw new ClaudeTimeoutError("timed out", "Entscheidung");
      }),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    expect(sent[0]).toContain("zu lange");
    expect(kuerSaves.at(-1)?.status).toBe("skipped-timeout");
  });

  it("re-throws a non-Claude decider error (generic scan-failure alert handles it)", async () => {
    const { deps } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () => {
        throw new Error("network blip");
      }),
    });
    await expect(runKuer({ scanSummary: "NVDA: signal" }, deps)).rejects.toThrow("network blip");
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

  it("seeds the Setup-Radar watchlist with non-traded dossier candidates (Stufe 2)", async () => {
    const watchSaves: WatchlistState[] = [];
    const twoCandidates = JSON.stringify({
      candidates: [
        { ticker: "NVDA", angle: "Long Momentum", catalyst: "Earnings", sentiment: "x" },
        { ticker: "AMD", angle: "Pullback-Kauf bei EMA20", catalyst: "Sympathy", sentiment: "y" },
      ],
      marketContext: "",
    });
    const { deps } = makeDeps(freshPortfolio(1000), quotes, {
      researchRunner: vi.fn(async () => twoCandidates),
      saveWatchlist: (s) => watchSaves.push(s),
    });
    await runKuer({ scanSummary: "" }, deps);
    expect(watchSaves).toHaveLength(1);
    expect(watchSaves[0].day).toBe(DAY);
    expect(watchSaves[0].entries.map((e) => e.ticker)).toEqual(["AMD"]); // NVDA was traded
    expect(watchSaves[0].entries[0].note).toContain("Pullback");
  });

  it("a saveWatchlist failure never breaks the Kür", async () => {
    const { deps, sent } = makeDeps(freshPortfolio(1000), quotes, {
      saveWatchlist: () => {
        throw new Error("disk full");
      },
    });
    await runKuer({ scanSummary: "" }, deps);
    expect(sent[0]).toContain("Kandidatenkür");
  });

  it("shows multi-day validity and a ladder marker in the journal (Parität mit orderLine)", async () => {
    const ladderTtl = JSON.stringify({
      trades: [
        { ticker: "NVDA", side: "long", stake: 100, leverage: 1, entry: 99, stopLoss: 90, ttlDays: 3, thesis: "Rung nah" },
        { ticker: "NVDA", side: "long", stake: 100, leverage: 1, entry: 97, stopLoss: 90, ttlDays: 3, thesis: "Rung fern" },
      ],
      journal: "Leiter auf NVDA, mehrtägig.",
    });
    const { deps, journal } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () => ladderTtl),
    });
    await runKuer({ scanSummary: "" }, deps);
    const body = journal[0][1];
    expect(body).toContain("gültig bis Handelsschluss 2026-06-11"); // expiresOn (ttlDays 3), not the creation day
    expect(body).toContain("Leiter-Rung"); // ladder marker, analog orderLine
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

describe("Kür artifact persistence (Kür-Ansicht spec)", () => {
  it("saves a decided artifact with dossier, debate, journal, orders and scan summary", async () => {
    const { deps, kuerSaves } = makeDeps(freshPortfolio(1000), quotes);
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    const a = kuerSaves.at(-1)!;
    expect(a.status).toBe("decided");
    expect(a.day).toBe(DAY);
    expect(a.scanSummary).toBe("NVDA: signal");
    expect(a.dossier?.candidates[0]?.ticker).toBe("NVDA");
    expect(a.debate?.debates[0]?.bear).toContain("überkauft");
    expect(a.decisionJournal).toContain("NVDA long");
    expect(a.orders).toHaveLength(1);
    expect(a.orders[0]?.ticker).toBe("NVDA");
  });

  it("records rejected trades with reason", async () => {
    const { deps, kuerSaves } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () =>
        JSON.stringify({
          trades: [{ ticker: "XXXX", side: "long", stake: 100, leverage: 1, entry: "market", stopLoss: 1, thesis: "" }],
          journal: "Versuch.",
        }),
      ),
    });
    await runKuer({ scanSummary: "" }, deps);
    const a = kuerSaves.at(-1)!;
    expect(a.orders).toHaveLength(0);
    expect(a.rejected[0]?.ticker).toBe("XXXX");
    expect(a.rejected[0]?.reason).toContain("kein Kurs");
  });

  it("saves a skipped-unreadable artifact that still archives dossier and debate", async () => {
    const { deps, kuerSaves } = makeDeps(freshPortfolio(1000), quotes, {
      decideRunner: vi.fn(async () => "kein JSON heute"),
    });
    await runKuer({ scanSummary: "NVDA: signal" }, deps);
    const a = kuerSaves.at(-1)!;
    expect(a.status).toBe("skipped-unreadable");
    expect(a.decisionJournal).toBeNull();
    expect(a.orders).toEqual([]);
    expect(a.dossier?.candidates).toHaveLength(1);
  });

  it("saves no artifact when the daily budget is already used (skip before research)", async () => {
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
    const { deps, kuerSaves } = makeDeps(p, quotes);
    await runKuer({ scanSummary: "" }, deps);
    expect(kuerSaves).toHaveLength(0);
  });

  it("a saveKuer failure never breaks the Kür (post still goes out)", async () => {
    const { deps, sent, saved } = makeDeps(freshPortfolio(1000), quotes, {
      saveKuer: () => {
        throw new Error("disk full");
      },
    });
    await runKuer({ scanSummary: "" }, deps);
    expect(saved.at(-1)?.orders).toHaveLength(1);
    expect(sent[0]).toContain("Kandidatenkür");
  });
});
