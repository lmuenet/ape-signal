// Single import point for the pure, Node-safe functions we reuse from the
// ape-intel submodule. Keeping the long relative paths in one place means the
// rest of the server imports from "../core/ape-intel".
export {
  fetchApewisdomSnapshot,
} from "../../vendor/ape-intel/src/lib/apewisdom";
export type {
  ApewisdomSnapshot,
  ApewisdomEntry,
  FetchFn,
} from "../../vendor/ape-intel/src/lib/apewisdom";

export {
  assembleTrendingBriefing,
  TRENDING_EXPORT_PROMPT,
  buildTrendingClipboardPayload,
} from "../../vendor/ape-intel/src/lib/trending-briefing";

export {
  parseTrendingChallenge,
} from "../../vendor/ape-intel/src/lib/trending-challenge";
export type {
  TrendingChallenge,
  TickerVerdict,
  Verdict,
} from "../../vendor/ape-intel/src/lib/trending-challenge";

export type {
  TrendingRow,
} from "../../vendor/ape-intel/src/background/apewisdom-service";

export {
  fetchNextEarnings,
  fetchCompanyNews,
} from "../../vendor/ape-intel/src/lib/finnhub";
export type {
  EarningsDate,
  NewsItem,
} from "../../vendor/ape-intel/src/lib/finnhub";

export { classifyCatalyst } from "../../vendor/ape-intel/src/lib/catalyst";
export type { CatalystTag } from "../../vendor/ape-intel/src/lib/catalyst";

export {
  fetchStockTwitsForTicker,
} from "../../vendor/ape-intel/src/lib/stocktwits";
export type {
  StockTwitsEntry,
} from "../../vendor/ape-intel/src/lib/stocktwits";

export {
  fetchTradestieSnapshot,
} from "../../vendor/ape-intel/src/lib/tradestie";
export type {
  TradestieEntry,
  TradestieSnapshot,
} from "../../vendor/ape-intel/src/lib/tradestie";

export {
  aggregate,
} from "../../vendor/ape-intel/src/lib/barometer";
export type {
  Aggregate,
} from "../../vendor/ape-intel/src/lib/barometer";

export {
  assembleBriefing,
  buildClipboardPayload,
  DEFAULT_EXPORT_PROMPT,
  DEFAULT_PROFILE,
  normalizeProfile,
} from "../../vendor/ape-intel/src/lib/briefing";
export type {
  BriefingInput,
  TradingProfile,
  RiskAppetite,
  Horizon,
} from "../../vendor/ape-intel/src/lib/briefing";

export {
  parseStrategy,
} from "../../vendor/ape-intel/src/lib/strategy";
export type {
  Strategy,
} from "../../vendor/ape-intel/src/lib/strategy";

export { fetchQuote } from "./quote";
export type { Quote } from "./quote";

export { fetchTradingViewTrend } from "./marketData";
export type { TrendQuote } from "./marketData";

export { fetchRelevantCompanyNews } from "./companyNews";
