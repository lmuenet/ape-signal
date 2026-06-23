// src/paper/select.ts — the daily Kandidatenkür, hooked onto the PreUS scan:
// Sonnet researches a dossier (WebSearch, opportunistically /last30days),
// Sonnet debates each candidate bull vs bear (Advocatus Diaboli), Opus turns
// it into at most 3 orders within the balanced guardrails. A failed research
// or debate degrades gracefully; an unreadable decision skips the day (never
// guessed trades).
import { placeOrders, tradesPlacedToday } from "./engine";
import { formatDecisionMirror, formatKuer, orderLine, renderPortfolio, renderQuotes, renderTrackRecord } from "./format";
import { buildDebatePrompt, buildDecisionPrompt, buildDossierPrompt } from "./prompts";
import { parseDebate, parseDecision, parseDossier, type Debate, type Dossier } from "./decision";
import { GUARDRAILS, type Portfolio, type WatchlistEntry, type WatchlistState } from "./types";
import { enrichWithListing, type EurPricing } from "./eurPricing";
import { toHoldings, type QuoteHolding } from "./quotes";
import { seedWatchlist } from "./watchlist";
import type { KuerArtifact } from "./kuerArtifact";
import type { Language } from "../core/language";
import { ClaudeError } from "../claude/invoke";
import type { Notify } from "../telegram/notify";

export interface KuerDeps {
  loadPortfolio: () => Portfolio;
  savePortfolio: (p: Portfolio) => void;
  appendJournal: (title: string, body: string) => void;
  readJournalTail: () => string;
  /** Resolve candidate tickers to their German EUR listings and price them (held
   *  names priced on their stored venue). Returns EUR quotes (by ticker) + the
   *  resolved listings (to enrich decisions + show clear names). Throws → caller alerts. */
  fetchQuotes: (tickers: string[], held: QuoteHolding[]) => Promise<EurPricing>;
  /** Sonnet with WebSearch (+ Skill for /last30days) — the researcher role. */
  researchRunner: (prompt: string) => Promise<string>;
  /** Sonnet without tools — the Advocatus-Diaboli role (bull/bear debate). */
  debateRunner: (prompt: string) => Promise<string>;
  /** Opus — the decider role. */
  decideRunner: (prompt: string) => Promise<string>;
  send: Notify;
  /** Persist the day's Kür artifact (Kür-Ansicht spec). Failures must not break the Kür. */
  saveKuer: (artifact: KuerArtifact) => void;
  /** Seed the intraday Setup-Radar watchlist (Stufe 2). Optional; failures must not break the Kür. */
  saveWatchlist?: (state: WatchlistState) => void;
  now?: () => Date;
  berlinDay: (d: Date) => string;
  language?: Language;
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

/**
 * Telegram note for a research/debate runner that hit the 5h usage limit or a
 * timeout (Constraint #6). Unlike the decider — make-or-break, which skips the
 * day — these degrade gracefully, but a limit/timeout must still be SURFACED,
 * not swallowed into stderr, so a silent 5h-limit can't masquerade as "research
 * found nothing". Any other failure stays a quiet stderr degrade (returns null).
 */
function degradeAlert(stage: string, err: unknown): string | null {
  if (!(err instanceof ClaudeError) || !(err.kind === "limit" || err.kind === "timeout")) return null;
  return err.kind === "limit"
    ? `⚠️ Mr Ape: ${stage} ist aktuell limitiert (Usage-Limit) — die Kür läuft mit reduzierter Datenbasis weiter.`
    : `⚠️ Mr Ape: ${stage} hat zu lange gebraucht (Timeout) — die Kür läuft mit reduzierter Datenbasis weiter.`;
}

/**
 * Best-effort: post the degrade note WITHOUT letting a send failure abort the
 * still-productive Kür. This is the only Telegram send mid-Kür whose failure
 * would otherwise cancel the pending Opus decision; the final Kür post and the
 * decider skip-alert run after the Kür's real work is done (or skipped), so they
 * stay unguarded — their failure is handled by the top-level main().catch.
 */
async function tryDegradeAlert(deps: KuerDeps, stage: string, err: unknown): Promise<void> {
  const alert = degradeAlert(stage, err);
  if (!alert) return;
  try {
    await deps.send(alert, "progress");
  } catch (sendErr) {
    console.error(`[kuer] degrade alert send failed: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
  }
}

function trySaveKuer(deps: KuerDeps, artifact: KuerArtifact): void {
  try {
    deps.saveKuer(artifact);
  } catch (err) {
    console.error(`[kuer] saving artifact failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Seed the intraday Setup-Radar watchlist (Stufe 2) from the dossier candidates
 * that were NOT turned into a trade today (and are not already held). Best-effort:
 * a failure must never break the Kür.
 */
function trySeedWatchlist(
  deps: KuerDeps,
  day: string,
  dossier: Dossier | null,
  tradedTickers: Set<string>,
): void {
  if (!deps.saveWatchlist) return;
  const entries: WatchlistEntry[] = (dossier?.candidates ?? [])
    .filter((c) => !tradedTickers.has(c.ticker.toUpperCase()))
    .map((c) => ({ ticker: c.ticker, note: c.angle || c.catalyst || "", addedDay: day, firedKinds: [] }));
  try {
    deps.saveWatchlist(seedWatchlist(day, entries));
  } catch (err) {
    console.error(`[kuer] seeding watchlist failed: ${err instanceof Error ? err.message : String(err)}`);
  }
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
    dossier = parseDossier(await deps.researchRunner(buildDossierPrompt({ day, scanSummary: opts.scanSummary, journalTail, language: deps.language ?? "de" })));
  } catch (err) {
    console.error(`[kuer] research failed, degrading to scan-only: ${err instanceof Error ? err.message : String(err)}`);
    await tryDegradeAlert(deps, "Die Recherche", err);
  }

  // Candidates are resolved fresh to their EUR venue; held names are priced on
  // the venue they were entered on (stored deSymbol). Mr Ape then sees EUR prices
  // + clear names and sets EUR levels.
  const candidateTickers = [...new Set(dossier?.candidates.map((c) => c.ticker) ?? [])];
  const heldHoldings = toHoldings([...portfolio.positions, ...portfolio.orders]);
  const { quotes, listings } = await deps.fetchQuotes(candidateTickers, heldHoldings); // throws → caller alerts

  // Advocatus Diaboli: bull/bear per candidate (TradingAgents pattern). A
  // failed debate degrades to a debate-free decision; no dossier → no debate.
  let debate: Debate | null = null;
  if (dossier && dossier.candidates.length > 0) {
    try {
      debate = parseDebate(
        await deps.debateRunner(
          buildDebatePrompt({ day, dossierBlock: renderDossier(dossier), quotesBlock: renderQuotes(quotes), journalTail, language: deps.language ?? "de" }),
        ),
      );
    } catch (err) {
      console.error(`[kuer] debate failed, deciding without it: ${err instanceof Error ? err.message : String(err)}`);
      await tryDegradeAlert(deps, "Die Bull/Bear-Debatte", err);
    }
  }

  let raw: string;
  try {
    raw = await deps.decideRunner(
      buildDecisionPrompt({
        day,
        dossierBlock: renderDossier(dossier),
        debateBlock: renderDebate(debate),
        quotesBlock: renderQuotes(quotes),
        portfolioBlock: renderPortfolio(portfolio, quotes),
        trackRecordBlock: renderTrackRecord(portfolio.history, 8),
        journalTail,
        language: deps.language ?? "de",
      }),
    );
  } catch (err) {
    // A limit/timeout on the decider is the make-or-break failure: say so
    // explicitly (Finding E) instead of the generic scan-failure alert, and
    // skip the day cleanly — never a guessed trade.
    if (err instanceof ClaudeError && (err.kind === "limit" || err.kind === "timeout")) {
      trySaveKuer(deps, {
        day,
        createdAt: now.toISOString(),
        scanSummary: opts.scanSummary,
        dossier,
        debate,
        decisionJournal: null,
        orders: [],
        rejected: [],
        status: err.kind === "limit" ? "skipped-limit" : "skipped-timeout",
      });
      await deps.send(
        err.kind === "limit"
          ? "⚠️ Mr Ape: Claude ist aktuell limitiert (Usage-Limit) — Kandidatenkür heute ausgefallen. Sobald das Limit zurückgesetzt ist, geht es wieder weiter."
          : "⚠️ Mr Ape: Claude hat zu lange gebraucht (Timeout) — Kandidatenkür heute ausgefallen. Morgen wieder.",
        "alert",
      );
      return;
    }
    throw err;
  }
  const decision = parseDecision(raw);
  if (!decision) {
    console.error("[kuer] unreadable decision, skipping today (no guessed trades).");
    trySaveKuer(deps, {
      day,
      createdAt: now.toISOString(),
      scanSummary: opts.scanSummary,
      dossier,
      debate,
      decisionJournal: null,
      orders: [],
      rejected: [],
      status: "skipped-unreadable",
    });
    await deps.send("⚠️ Mr Ape: Kandidatenkür heute ausgefallen (Entscheidung nicht lesbar). Morgen wieder.", "alert");
    return;
  }

  // Enrich each decision with its resolved EUR listing (deSymbol/isin/name/currency)
  // so the order → position → trade carry the venue + clear name (ADR 0005). A
  // ticker with no EUR listing stays bare and is rejected by placeOrders (no quote).
  const enriched = decision.trades.map((t) => enrichWithListing(t, listings));
  const { portfolio: updated, accepted, rejected } = placeOrders(portfolio, enriched, quotes, {
    now: now.toISOString(),
    day,
  });
  portfolio = updated;
  deps.savePortfolio(portfolio);

  const tradedTickers = new Set<string>([
    ...accepted.map((o) => o.ticker),
    ...portfolio.positions.map((p) => p.ticker),
  ]);
  trySeedWatchlist(deps, day, dossier, tradedTickers);

  trySaveKuer(deps, {
    day,
    createdAt: now.toISOString(),
    scanSummary: opts.scanSummary,
    dossier,
    debate,
    decisionJournal: decision.journal,
    orders: accepted,
    rejected: rejected.map((r) => ({ ticker: r.decision.ticker, side: r.decision.side, reason: r.reason })),
    status: "decided",
  });

  const journalBody = [
    decision.journal.trim(),
    "",
    accepted.length > 0 ? "Platzierte Orders:" : "Keine Orders platziert.",
    // Parity with the Telegram Kür (formatKuer→orderLine): show TTL validity
    // (expiresOn ?? day) and the ladder-rung marker, not just type/stop.
    ...accepted.map((o) => `- ${orderLine(o)}`),
    ...rejected.map((r) => `- abgelehnt (${r.reason}): ${r.decision.ticker} ${r.decision.side}`),
  ]
    .filter((l) => l !== "")
    .join("\n");
  deps.appendJournal("Kandidatenkür", journalBody);

  await deps.send(formatKuer(accepted, rejected.map((r) => `${r.decision.ticker}: ${r.reason}`), decision.journal));

  // Verdichtete Spiegelung der Herleitung — best-effort, darf die Kür nie brechen.
  const mirror = formatDecisionMirror(dossier, debate);
  if (mirror !== "") {
    try {
      await deps.send(mirror, "research");
    } catch (err) {
      console.error(`[kuer] mirror send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
