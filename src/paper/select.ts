// src/paper/select.ts — the daily Kandidatenkür, hooked onto the PreUS scan:
// Sonnet researches a dossier (WebSearch, opportunistically /last30days),
// Sonnet debates each candidate bull vs bear (Advocatus Diaboli), Opus turns
// it into at most 3 orders within the balanced guardrails. A failed research
// or debate degrades gracefully; an unreadable decision skips the day (never
// guessed trades).
import { placeOrders, tradesPlacedToday } from "./engine";
import { formatKuer, renderPortfolio, renderQuotes } from "./format";
import { buildDebatePrompt, buildDecisionPrompt, buildDossierPrompt } from "./prompts";
import { parseDebate, parseDecision, parseDossier, type Debate, type Dossier } from "./decision";
import { GUARDRAILS, type Portfolio, type QuoteMap } from "./types";

export interface KuerDeps {
  loadPortfolio: () => Portfolio;
  savePortfolio: (p: Portfolio) => void;
  appendJournal: (title: string, body: string) => void;
  readJournalTail: () => string;
  fetchQuotes: (tickers: string[]) => Promise<QuoteMap>;
  /** Sonnet with WebSearch (+ Skill for /last30days) — the researcher role. */
  researchRunner: (prompt: string) => Promise<string>;
  /** Sonnet without tools — the Advocatus-Diaboli role (bull/bear debate). */
  debateRunner: (prompt: string) => Promise<string>;
  /** Opus — the decider role. */
  decideRunner: (prompt: string) => Promise<string>;
  send: (text: string) => Promise<void>;
  now?: () => Date;
  berlinDay: (d: Date) => string;
}

export interface KuerOptions {
  /** Compact text of today's scan result (verdicts) for the research prompt. */
  scanSummary: string;
}

function renderDossier(dossier: Dossier | null): string {
  if (!dossier) return "(Research fehlgeschlagen — entscheide auf Basis von Scan-Daten und Kursen.)";
  const lines = dossier.candidates.map(
    (c) => `${c.ticker}: ${c.angle}\n  Katalysator: ${c.catalyst}\n  Sentiment: ${c.sentiment}`,
  );
  if (dossier.marketContext !== "") lines.push("", `Marktlage: ${dossier.marketContext}`);
  return lines.join("\n");
}

function renderDebate(debate: Debate | null): string {
  if (!debate || debate.debates.length === 0) {
    return "(keine Debatte verfügbar — wäge selbst beide Seiten ab.)";
  }
  return debate.debates
    .map((d) => `${d.ticker}:\n  Bull: ${d.bull}\n  Bear: ${d.bear}`)
    .join("\n");
}

export async function runKuer(opts: KuerOptions, deps: KuerDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const day = deps.berlinDay(now);
  let portfolio = deps.loadPortfolio();

  if (tradesPlacedToday(portfolio, day) >= GUARDRAILS.maxTradesPerDay) {
    console.log("[kuer] daily trade budget already used, skipping.");
    return;
  }

  const journalTail = deps.readJournalTail();

  let dossier: Dossier | null = null;
  try {
    dossier = parseDossier(await deps.researchRunner(buildDossierPrompt({ day, scanSummary: opts.scanSummary, journalTail })));
  } catch (err) {
    console.error(`[kuer] research failed, degrading to scan-only: ${err instanceof Error ? err.message : String(err)}`);
  }

  const tickers = [
    ...new Set([
      ...(dossier?.candidates.map((c) => c.ticker) ?? []),
      ...portfolio.positions.map((p) => p.ticker),
      ...portfolio.orders.map((o) => o.ticker),
    ]),
  ];
  const quotes = await deps.fetchQuotes(tickers); // throws → caller alerts

  // Advocatus Diaboli: bull/bear per candidate (TradingAgents pattern). A
  // failed debate degrades to a debate-free decision; no dossier → no debate.
  let debate: Debate | null = null;
  if (dossier && dossier.candidates.length > 0) {
    try {
      debate = parseDebate(
        await deps.debateRunner(
          buildDebatePrompt({ day, dossierBlock: renderDossier(dossier), quotesBlock: renderQuotes(quotes), journalTail }),
        ),
      );
    } catch (err) {
      console.error(`[kuer] debate failed, deciding without it: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const raw = await deps.decideRunner(
    buildDecisionPrompt({
      day,
      dossierBlock: renderDossier(dossier),
      debateBlock: renderDebate(debate),
      quotesBlock: renderQuotes(quotes),
      portfolioBlock: renderPortfolio(portfolio, quotes),
      journalTail,
    }),
  );
  const decision = parseDecision(raw);
  if (!decision) {
    console.error("[kuer] unreadable decision, skipping today (no guessed trades).");
    await deps.send("⚠️ Mr Ape: Kandidatenkür heute ausgefallen (Entscheidung nicht lesbar). Morgen wieder.");
    return;
  }

  const { portfolio: updated, accepted, rejected } = placeOrders(portfolio, decision.trades, quotes, {
    now: now.toISOString(),
    day,
  });
  portfolio = updated;
  deps.savePortfolio(portfolio);

  const journalBody = [
    decision.journal.trim(),
    "",
    accepted.length > 0 ? "Platzierte Orders:" : "Keine Orders platziert.",
    ...accepted.map((o) => `- ${o.id}: ${o.ticker} ${o.side} ${o.leverage}x, Einsatz $${o.stake.toFixed(2)}, ${o.entryType === "market" ? "Market" : `Limit ${o.limitPrice}`}, SL ${o.stopLoss}${o.takeProfit !== undefined ? `, TP ${o.takeProfit}` : ""}`),
    ...rejected.map((r) => `- abgelehnt (${r.reason}): ${r.decision.ticker} ${r.decision.side}`),
  ]
    .filter((l) => l !== "")
    .join("\n");
  deps.appendJournal("Kandidatenkür", journalBody);

  await deps.send(formatKuer(accepted, rejected.map((r) => `${r.decision.ticker}: ${r.reason}`), decision.journal));
}
