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
  quote: Quote | null;
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
  return { input, strategy, raw, quote };
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

/** Escape the three characters that matter for Telegram HTML parse mode. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A value longer than this drops out of the monospace box into flowing text. */
const BOX_MAX = 30;

interface Field {
  label: string;
  value: string | undefined;
}

/**
 * Render a Strategy as a Telegram HTML card (send with parseMode "HTML"): a
 * monospace <pre> box with the at-a-glance decision fields (short values only,
 * so it never wraps) on top, then the long fields as <b>-headed flowing
 * paragraphs below. Falls back to the escaped raw claude text when parsing
 * failed. All dynamic content is HTML-escaped — Claude writes things like
 * ">205"/"<183" that would otherwise break the HTML.
 */
export function formatStrategy(
  ticker: string,
  profile: TradingProfile,
  strategy: Strategy | null,
  raw: string,
  quote: Quote | null,
): string {
  const header = `📊 <b>${escapeHtml(ticker)} — ${escapeHtml(profile.risk)}/${escapeHtml(profile.horizon)}</b>`;
  if (!strategy) {
    return [header, "", escapeHtml(raw.trim()), "", DISCLAIMER].join("\n");
  }

  // These go in the box only if short enough; otherwise they flow below.
  const flexible: Field[] = [
    { label: "Horizont", value: strategy.timeframe },
    { label: "Ziel", value: strategy.targetPrice },
    { label: "Stop", value: strategy.stopLoss },
    { label: "Hebel", value: strategy.leverage },
  ];

  const boxRows: Array<[string, string]> = [
    ["Direction", strategy.direction ?? "—"],
    ["Conviction", strategy.conviction ?? "—"],
  ];
  if (quote) {
    const sign = quote.changePct >= 0 ? "+" : "";
    boxRows.push(["Kurs", `${quote.current.toFixed(2)} (${sign}${quote.changePct.toFixed(2)}%)`]);
  }
  const boxed = new Set<string>();
  for (const f of flexible) {
    if (f.value && f.value.length <= BOX_MAX) {
      boxRows.push([f.label, f.value]);
      boxed.add(f.label);
    }
  }

  const width = Math.max(...boxRows.map(([label]) => label.length));
  const box =
    "<pre>" +
    boxRows.map(([label, value]) => `${label.padEnd(width)}  ${escapeHtml(value)}`).join("\n") +
    "</pre>";

  // Flowing: recommendation first, any flexible field that didn't fit the box
  // (in its natural place), then the long-form fields.
  const flowing: Field[] = [
    { label: "Empfehlung", value: strategy.recommendation },
    ...flexible.filter((f) => !boxed.has(f.label)),
    { label: "Instrumente", value: strategy.instruments },
    { label: "Positionsgröße", value: strategy.positionSizing },
    { label: "Barometer-Kritik", value: strategy.barometerCritique },
    { label: "Begründung", value: strategy.rationale },
    { label: "Risiken", value: strategy.risks },
  ];
  const sections = flowing
    .filter((f): f is { label: string; value: string } => Boolean(f.value))
    .map((f) => `<b>${f.label}</b>\n${escapeHtml(f.value)}`);

  return [header, "", box, "", sections.join("\n\n"), "", DISCLAIMER].join("\n");
}
