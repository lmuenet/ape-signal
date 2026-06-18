// src/paper/radar.ts — runs the intraday Setup-Radar once per monitor tick
// (Stufe 2): detect deterministic setups on the watchlist, post them to Telegram,
// consume each trigger once per day. If a gated intraday opener is wired in
// (Stufe 3, ENABLE_INTRADAY_OPPORTUNISM), each fired trigger may also open one
// limit order. Self-contained and best-effort: a quote failure stays silent.
import { detectSetups } from "./setupRadar";
import { entriesForDay } from "./watchlist";
import type { Portfolio, QuoteMap, SetupKind, SetupTrigger, WatchlistEntry, WatchlistState } from "./types";

export interface RadarDeps {
  loadPortfolio: () => Portfolio;
  loadWatchlist: () => WatchlistState | null;
  saveWatchlist: (s: WatchlistState) => void;
  fetchQuotes: (tickers: string[]) => Promise<QuoteMap>;
  appendJournal: (title: string, body: string) => void;
  send: (text: string) => Promise<void>;
  now?: () => Date;
  berlinDay: (d: Date) => string;
  berlinStamp: (d: Date) => string;
  /** Stufe 3 (gated): when present, a fired trigger may open one intraday order. */
  intraday?: (trigger: SetupTrigger) => Promise<void>;
}

export async function runSetupRadar(deps: RadarDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const day = deps.berlinDay(now);
  const stamp = deps.berlinStamp(now);

  const state = deps.loadWatchlist();
  const entries = entriesForDay(state, day);
  if (entries.length === 0) return; // no watchlist for today → radar idle

  // Skip tickers we now hold/have an order for — those are the tick's job.
  const portfolio = deps.loadPortfolio();
  const held = new Set([...portfolio.positions, ...portfolio.orders].map((x) => x.ticker.toUpperCase()));
  const active = entries.filter((e) => !held.has(e.ticker.toUpperCase()));
  if (active.length === 0) return;

  let quotes: QuoteMap;
  try {
    quotes = await deps.fetchQuotes(active.map((e) => e.ticker));
  } catch (err) {
    console.error(`[radar] quote fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return; // best-effort: silent on a fetch failure
  }

  const triggers = detectSetups(active, quotes, state?.lastQuotes);

  const firedByTicker = new Map<string, SetupKind[]>();
  for (const t of triggers) {
    await deps.send(`⚡ Setup ${t.ticker} @ ${t.price}: ${t.note}`);
    deps.appendJournal(`Setup-Radar ${stamp.slice(11)}`, `${t.ticker}: ${t.note}`);
    firedByTicker.set(t.ticker, [...(firedByTicker.get(t.ticker) ?? []), t.kind]);
  }

  // Consume fired kinds (once per kind per day) and refresh the cross baseline.
  const updatedEntries: WatchlistEntry[] = entries.map((e) => {
    const fresh = firedByTicker.get(e.ticker);
    return fresh ? { ...e, firedKinds: [...e.firedKinds, ...fresh] } : e;
  });
  deps.saveWatchlist({ day, entries: updatedEntries, lastQuotes: quotes });

  // Stufe 3 (gated): each fired trigger may open one order. The opener's own
  // budget gate ensures at most one intraday trade even if several fire.
  if (deps.intraday) {
    for (const t of triggers) {
      await deps.intraday(t);
    }
  }
}
