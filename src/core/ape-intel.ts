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
