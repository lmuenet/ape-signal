// src/paper/trend.ts — a deterministic EMA/RSI trend read from a tick quote
// (TradingView scanner indicator columns; see quotes.ts). No LLM: a cheap,
// reliable signal that feeds the prompts (Mr Ape sees the trend), the
// notifications and the wake/hold logic. "EMA 8" exactly is not a scanner
// column — EMA10/20/50 carry the trend read the user wants (see MASTERPLAN B2).
import type { TickQuote } from "./types";

export type Trend = "up" | "down" | "flat" | "unknown";

/**
 * Trend bias from the close vs EMA20, confirmed by the EMA10/20 stack when
 * EMA10 is present. "unknown" when the scanner gave no EMA20 (degraded source).
 */
export function trendTag(q: Pick<TickQuote, "close" | "ema10" | "ema20">): Trend {
  if (q.ema20 === undefined) return "unknown";
  const stackUp = q.ema10 === undefined || q.ema10 >= q.ema20;
  const stackDown = q.ema10 === undefined || q.ema10 <= q.ema20;
  if (q.close > q.ema20 && stackUp) return "up";
  if (q.close < q.ema20 && stackDown) return "down";
  return "flat";
}

const ARROW: Record<Trend, string> = { up: "↑", down: "↓", flat: "→", unknown: "?" };

/** Short human label for the trend, e.g. "↑ Aufwärts". "" when unknown. */
export function trendLabel(t: Trend): string {
  if (t === "unknown") return "";
  const word = t === "up" ? "Aufwärts" : t === "down" ? "Abwärts" : "seitwärts";
  return `${ARROW[t]} ${word}`;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The technical suffix for a quote line, e.g.
 * " · EMA10 108 EMA20 105 EMA50 100 · RSI 62 · ↑ Aufwärts".
 * "" when the scanner returned no EMA (degraded source → no false signal).
 */
export function formatTech(q: Pick<TickQuote, "close" | "ema10" | "ema20" | "ema50" | "rsi">): string {
  const parts: string[] = [];
  if (q.ema20 !== undefined) {
    const emas = [
      q.ema10 !== undefined ? `EMA10 ${round2(q.ema10)}` : null,
      `EMA20 ${round2(q.ema20)}`,
      q.ema50 !== undefined ? `EMA50 ${round2(q.ema50)}` : null,
    ].filter((x): x is string => x !== null);
    parts.push(emas.join(" "));
  }
  if (q.rsi !== undefined) parts.push(`RSI ${Math.round(q.rsi)}`);
  const label = trendLabel(trendTag(q));
  if (label !== "") parts.push(label);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}
