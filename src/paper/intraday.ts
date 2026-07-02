// src/paper/intraday.ts — the GATED intraday opportunism opening (Stufe 3) as a
// two-stage Mini-Kür: a deterministic Setup-Radar trigger (setupRadar.ts) wakes a
// focused Sonnet research step, then OPUS decides AT MOST ONE limit order on the
// triggered ticker, inside a separate budget tier and behind ENABLE_INTRADAY_OPPORTUNISM.
// Disciplined by design: all gates are deterministic, entries are limit-only, and an
// unreadable / declined / limited answer means NO trade (never a guess). The process is
// mirrored to Telegram (start-ping + a GUARANTEED outcome) so it is visible live.
import { intradayTradesPlacedToday, placeOrders, tradesPlacedToday } from "./engine";
import { label, money, renderPortfolio, renderQuotes, renderTrackRecord } from "./format";
import { buildIntradayDossierPrompt, buildIntradayPrompt } from "./prompts";
import { parseDecision, parseDossier, type Dossier } from "./decision";
import { enrichWithListing, type EurPricing } from "./eurPricing";
import { GUARDRAILS, type Portfolio, type QuoteMap, type SetupTrigger } from "./types";
import type { Language } from "../core/language";
import { ClaudeError } from "../claude/invoke";
import type { Notify } from "../telegram/notify";

export interface IntradayDeps {
  loadPortfolio: () => Portfolio;
  savePortfolio: (p: Portfolio) => void;
  appendJournal: (title: string, body: string) => void;
  readJournalTail: () => string;
  /** Resolve the triggered ticker to its EUR venue and price it; returns EUR quotes
   *  + the resolved listing (to enrich the order). Throws → caller skips. */
  fetchQuotes: (tickers: string[]) => Promise<EurPricing>;
  /** Sonnet with WebSearch — focused research on the triggered ticker. */
  researchRunner: (prompt: string) => Promise<string>;
  /** Opus — the decider for the mini-Kür. */
  decideRunner: (prompt: string) => Promise<string>;
  send: Notify;
  now?: () => Date;
  berlinDay: (d: Date) => string;
  berlinStamp: (d: Date) => string;
  language?: Language;
}

/** True if a new intraday trade on `ticker` is allowed right now (all gates deterministic). */
export function intradayGateOpen(p: Portfolio, day: string, ticker: string): boolean {
  if (intradayTradesPlacedToday(p, day) >= GUARDRAILS.maxIntradayTrades) return false; // own tier
  if (tradesPlacedToday(p, day) >= GUARDRAILS.maxTradesPerDay) return false; // shared daily cap
  const t = ticker.toUpperCase();
  // No doubling down on a ticker we already hold or have an order for.
  if (p.positions.some((pos) => pos.ticker === t)) return false;
  if (p.orders.some((o) => o.ticker === t)) return false;
  return true;
}

/** Render the single-ticker mini-dossier (or a degrade note when research yielded nothing). */
function renderChanceDossier(d: Dossier | null, ticker: string): string {
  const c = d?.candidates.find((x) => x.ticker === ticker.toUpperCase());
  if (!c) return "(Research fehlgeschlagen — entscheide auf Trigger und Kursen.)";
  return `${c.ticker}: ${c.angle}\n  Katalysator: ${c.catalyst}\n  Sentiment: ${c.sentiment}`;
}

/**
 * Consider opening one intraday limit order for a fired setup trigger — as a two-stage
 * mini-Kür (Sonnet research → Opus decide). Best-effort and self-contained (loads + saves
 * the portfolio). Once the gate is open, the process is ALWAYS surfaced to Telegram: a
 * start-ping that it is live, then a guaranteed outcome (order, no-trade, or not-decided).
 */
export async function runIntradayOpportunity(trigger: SetupTrigger, deps: IntradayDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const day = deps.berlinDay(now);
  const stamp = deps.berlinStamp(now);
  const ticker = trigger.ticker.toUpperCase();

  let portfolio = deps.loadPortfolio();
  if (!intradayGateOpen(portfolio, day, ticker)) return;

  // Start-Ping: signalisiert, dass der Mini-Kür-Prozess live läuft (best-effort).
  try {
    await deps.send(`🦍 Mr Ape prüft Intraday-Chance ${ticker} (${trigger.note}) …`, "progress");
  } catch (err) {
    console.error(`[intraday] start-ping send failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let quotes: QuoteMap;
  let listings: EurPricing["listings"];
  try {
    ({ quotes, listings } = await deps.fetchQuotes([ticker]));
  } catch (err) {
    console.error(`[intraday] quote fetch failed for ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    await deps.send(`⚠️ Mr Ape — Intraday ${ticker}: Kurse nicht verfügbar, übersprungen.`, "alert");
    return;
  }
  if (!quotes[ticker]) {
    await deps.send(`⚠️ Mr Ape — Intraday ${ticker}: keine Kurse, übersprungen.`, "alert");
    return;
  }

  const trackRecordBlock = renderTrackRecord(portfolio.history, 8);
  const journalTail = deps.readJournalTail();

  // Stufe 1: Research (Sonnet). Scheitert sie → sanfte Degradation, Opus entscheidet trotzdem.
  let dossier: Dossier | null = null;
  try {
    dossier = parseDossier(
      await deps.researchRunner(
        buildIntradayDossierPrompt({
          stamp, ticker, triggerLabel: trigger.note, price: trigger.price,
          quotesBlock: renderQuotes(quotes), journalTail, language: deps.language ?? "de",
        }),
      ),
    );
  } catch (err) {
    console.error(`[intraday] research failed, deciding on trigger+quotes: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Stufe 2: Entscheidung (Opus).
  let raw: string;
  try {
    raw = await deps.decideRunner(
      buildIntradayPrompt({
        stamp, ticker, triggerLabel: trigger.note, price: trigger.price,
        portfolioBlock: renderPortfolio(portfolio, quotes), quotesBlock: renderQuotes(quotes),
        dossierBlock: renderChanceDossier(dossier, ticker), trackRecordBlock,
        journalTail, language: deps.language ?? "de",
      }),
    );
  } catch (err) {
    const why = err instanceof ClaudeError && err.kind === "limit"
      ? "Usage-Limit"
      : err instanceof ClaudeError && err.kind === "timeout"
        ? "Timeout"
        : "Fehler";
    deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, `Nicht entschieden (${why}).`);
    // Failures/degrades must be visible with default verbosity (Beschluss 2026-07-02);
    // benign outcomes below (no trade / limit-only discard) stay "progress".
    await deps.send(`⚠️ Mr Ape — Intraday ${ticker}: nicht entschieden (${why}).`, "alert");
    return;
  }

  const decision = parseDecision(raw);
  const trade = decision?.trades[0];
  if (!decision || !trade) {
    const note = decision?.journal?.trim() || "kein klares Setup.";
    deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, `Kein Trade. ${note}`);
    await deps.send(`🦍 Mr Ape — Intraday ${ticker}: kein Trade. ${note}`, "progress");
    return;
  }
  if (trade.entry === "market") {
    deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, "Verworfen: nur Limit-Einstiege erlaubt.");
    await deps.send(`🦍 Mr Ape — Intraday ${ticker}: Vorschlag verworfen (nur Limit erlaubt).`, "progress");
    return;
  }

  // Enrich with the resolved EUR listing so the intraday order carries its venue + name.
  const enriched = enrichWithListing({ ...trade, ticker }, listings);
  const { portfolio: updated, accepted, rejected } = placeOrders(
    portfolio, [enriched], quotes, { now: now.toISOString(), day, source: "intraday" },
  );
  portfolio = updated;
  deps.savePortfolio(portfolio);

  if (accepted.length === 0) {
    const reason = rejected[0]?.reason ?? "abgelehnt";
    deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, `Order abgelehnt (${reason}).`);
    // "trade": a guardrail rejection is trade-lifecycle news — an order almost
    // happened; that must reach the default-verbosity chat.
    await deps.send(`🦍 Mr Ape — Intraday ${ticker}: Order abgelehnt (${reason}).`, "trade");
    return;
  }

  const o = accepted[0];
  const journalText = decision.journal.trim();
  const orderText = `🟢 Intraday-Limit gesetzt: ${label(o)} ${o.side} ${o.leverage}x, Einsatz ${money(o.stake, o.currency)}, Limit ${o.limitPrice}, SL ${o.stopLoss}${o.takeProfit !== undefined ? `, TP ${o.takeProfit}` : ""}${o.expiresOn ? ` (bis ${o.expiresOn})` : ""}`;
  deps.appendJournal(`Intraday ${stamp.slice(11)} — ${ticker}`, [journalText, orderText].filter((l) => l !== "").join("\n"));
  await deps.send([`🦍 Mr Ape — Intraday-Chance ${ticker} (${trigger.note})`, journalText, orderText].filter((l) => l !== "").join("\n"));
}
