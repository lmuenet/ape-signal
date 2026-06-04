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
} from "../core/ape-intel";

export interface StrategyDeps {
  fetchApewisdom: () => Promise<ApewisdomSnapshot>;
  fetchStockTwits: (ticker: string) => Promise<StockTwitsEntry | null>;
  fetchTradestie: () => Promise<TradestieSnapshot>;
  fetchNews: (ticker: string) => Promise<NewsItem[]>;
  fetchEarnings: (ticker: string) => Promise<EarningsDate | null>;
  claudeRunner: (prompt: string) => Promise<string>;
}

/** Gather one ticker's data into a BriefingInput. Missing rows become null. */
export async function assembleStrategyInput(
  ticker: string,
  deps: StrategyDeps,
): Promise<BriefingInput> {
  const t = ticker.toUpperCase();
  const [ape, stocktwits, tdMap, news, earnings] = await Promise.all([
    deps.fetchApewisdom(),
    deps.fetchStockTwits(t),
    deps.fetchTradestie(),
    deps.fetchNews(t),
    deps.fetchEarnings(t),
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
  const input = await assembleStrategyInput(ticker, deps);
  const prompt = buildClipboardPayload(input, {
    basePrompt: DEFAULT_EXPORT_PROMPT,
    profile,
  });
  const raw = await deps.claudeRunner(prompt);
  const strategy = parseStrategy(raw);
  return { input, strategy, raw };
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
