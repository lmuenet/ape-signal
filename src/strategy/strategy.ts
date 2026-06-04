import {
  aggregate,
  buildClipboardPayload,
  parseStrategy,
  DEFAULT_EXPORT_PROMPT,
  DEFAULT_PROFILE,
  type ApewisdomSnapshot,
  type TradestieSnapshot,
  type StockTwitsEntry,
  type NewsItem,
  type EarningsDate,
  type BriefingInput,
  type TradingProfile,
  type Strategy,
  type Quote,
} from "../core/ape-intel";
import { GERMAN_DIRECTIVE_STRATEGY, HEADLESS_JSON_DIRECTIVE } from "../core/language";

export interface StrategyDeps {
  fetchApewisdom: () => Promise<ApewisdomSnapshot>;
  fetchStockTwits: (ticker: string) => Promise<StockTwitsEntry | null>;
  fetchTradestie: () => Promise<TradestieSnapshot>;
  fetchNews: (ticker: string) => Promise<NewsItem[]>;
  fetchEarnings: (ticker: string) => Promise<EarningsDate | null>;
  fetchQuote: (ticker: string) => Promise<Quote | null>;
  claudeRunner: (prompt: string) => Promise<string>;
}

/**
 * Run a single source fetch but never let it sink the whole briefing: a thrown
 * error (e.g. a datacenter-IP block — StockTwits/Reddit 403 from the VPS) is
 * logged and the source degrades to its empty value. Mirrors the scan
 * pipeline's "a source failure is logged and the run continues" philosophy;
 * Claude still gets a (sparser) briefing and does its own research.
 */
async function safeSource<T>(label: string, fetchFn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fetchFn();
  } catch (err) {
    console.error(`[strategy] ${label} failed, continuing without it: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

/** Gather one ticker's data into a BriefingInput. Missing/failed rows become null/empty. */
export async function assembleStrategyInput(
  ticker: string,
  deps: StrategyDeps,
): Promise<BriefingInput> {
  const t = ticker.toUpperCase();
  const [ape, stocktwits, tdMap, news, earnings] = await Promise.all([
    safeSource("apewisdom", () => deps.fetchApewisdom(), new Map() as ApewisdomSnapshot),
    safeSource("stocktwits", () => deps.fetchStockTwits(t), null as StockTwitsEntry | null),
    safeSource("tradestie", () => deps.fetchTradestie(), new Map() as TradestieSnapshot),
    safeSource("news", () => deps.fetchNews(t), [] as NewsItem[]),
    safeSource("earnings", () => deps.fetchEarnings(t), null as EarningsDate | null),
  ]);
  const apewisdom = ape.get(t) ?? null;
  const tradestie = tdMap.get(t) ?? null;
  const agg = aggregate({ stocktwits, tradestie, apewisdom });
  return { ticker: t, aggregate: agg, apewisdom, stocktwits, news, earnings };
}

/** Re-export so callers don't need a second import for the default. */
export const DEFAULT_PROFILE_EXPORT: TradingProfile = DEFAULT_PROFILE;

export interface StrategyResult {
  input: BriefingInput;
  strategy: Strategy | null;
  raw: string;
}

/** Assemble → build the ADR-0010 export prompt → claude -p → parseStrategy. */
export async function runStrategy(
  ticker: string,
  profile: TradingProfile,
  deps: StrategyDeps,
): Promise<StrategyResult> {
  const [input, quote] = await Promise.all([
    assembleStrategyInput(ticker, deps),
    safeSource("quote", () => deps.fetchQuote(ticker.toUpperCase()), null as Quote | null),
  ]);
  const base = buildClipboardPayload(input, {
    basePrompt: DEFAULT_EXPORT_PROMPT,
    profile,
  });
  const prompt = `${base}\n\n${renderPriceBlock(input.ticker, quote)}\n\n${GERMAN_DIRECTIVE_STRATEGY}\n\n${HEADLESS_JSON_DIRECTIVE}`;
  const raw = await deps.claudeRunner(prompt);
  const strategy = parseStrategy(raw);
  return { input, strategy, raw };
}

function renderPriceBlock(ticker: string, quote: Quote | null): string {
  if (!quote) {
    return `## Aktueller Kurs (Live)\nKein Live-Kurs verfügbar (Quelle nicht erreichbar).`;
  }
  const sign = quote.changePct >= 0 ? "+" : "";
  return [
    "## Aktueller Kurs (Live, Finnhub)",
    `${ticker}: ${quote.current.toFixed(2)} (heute ${sign}${quote.changePct.toFixed(2)}%, ` +
      `Tageshoch ${quote.high.toFixed(2)}, Tagestief ${quote.low.toFixed(2)}, ` +
      `Eröffnung ${quote.open.toFixed(2)}, Vortagesschluss ${quote.prevClose.toFixed(2)})`,
    "",
    "Du hast jetzt den AKTUELLEN Kurs. Nenne konkrete Entry-, Target- und Stop-Zahlen",
    "relativ zu diesem Kurs — verstecke dich nicht hinter \"ich kann den Kurs nicht sehen\".",
  ].join("\n");
}

const DISCLAIMER = "Informational research, not financial advice.";

function line(label: string, value: string | undefined): string | null {
  return value ? `${label}: ${value}` : null;
}

/** Render a Strategy as a compact Telegram message. Falls back to raw text. */
export function formatStrategy(
  ticker: string,
  profile: TradingProfile,
  strategy: Strategy | null,
  raw: string,
): string {
  const header = `📊 ${ticker} — ${profile.risk}/${profile.horizon}`;
  if (!strategy) {
    return [header, "", raw.trim(), "", DISCLAIMER].join("\n");
  }
  const rows = [
    line("Recommendation", strategy.recommendation),
    line("Conviction", strategy.conviction),
    line("Direction", strategy.direction),
    line("Timeframe", strategy.timeframe),
    line("Target", strategy.targetPrice),
    line("Stop", strategy.stopLoss),
    line("Leverage", strategy.leverage),
    line("Instruments", strategy.instruments),
    line("Sizing", strategy.positionSizing),
    line("Barometer critique", strategy.barometerCritique),
    line("Rationale", strategy.rationale),
    line("Risks", strategy.risks),
  ].filter((x): x is string => x !== null);
  return [header, "", ...rows, "", DISCLAIMER].join("\n");
}
