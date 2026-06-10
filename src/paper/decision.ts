// src/paper/decision.ts — strict JSON contracts between Mr Ape (the LLM) and
// the deterministic engine. Parsers are forgiving about surrounding prose but
// strict about shape: a malformed answer degrades to null and the caller
// proceeds without the LLM's input (never with guessed numbers).
import type { Adjustment, Side, TradeDecision } from "./types";
import type { AdminAction } from "./engine";

/** Extract the first balanced top-level JSON object from raw LLM output. */
export function extractJson(raw: string): unknown | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const isSide = (v: unknown): v is Side => v === "long" || v === "short";
const numOr = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface Dossier {
  candidates: Array<{ ticker: string; angle: string; catalyst: string; sentiment: string }>;
  marketContext: string;
}

export function parseDossier(raw: string): Dossier | null {
  const json = extractJson(raw) as { candidates?: unknown; marketContext?: unknown } | null;
  if (!json || !Array.isArray(json.candidates)) return null;
  const candidates = json.candidates
    .map((c: unknown) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const ticker = str(o.ticker).toUpperCase().trim();
      if (ticker === "" || !/^[A-Z.]{1,6}$/.test(ticker)) return null;
      return { ticker, angle: str(o.angle), catalyst: str(o.catalyst), sentiment: str(o.sentiment) };
    })
    .filter((c): c is Dossier["candidates"][number] => c !== null);
  return { candidates, marketContext: str(json.marketContext) };
}

/** Bull/Bear cases per candidate (Advocatus Diaboli, TradingAgents pattern). */
export interface Debate {
  debates: Array<{ ticker: string; bull: string; bear: string }>;
}

export function parseDebate(raw: string): Debate | null {
  const json = extractJson(raw) as { debates?: unknown } | null;
  if (!json || !Array.isArray(json.debates)) return null;
  const debates = json.debates
    .map((d: unknown): Debate["debates"][number] | null => {
      const o = (d ?? {}) as Record<string, unknown>;
      const ticker = str(o.ticker).toUpperCase().trim();
      if (ticker === "" || !/^[A-Z.]{1,6}$/.test(ticker)) return null;
      return { ticker, bull: str(o.bull), bear: str(o.bear) };
    })
    .filter((d): d is Debate["debates"][number] => d !== null);
  return { debates };
}

export interface Decision {
  trades: TradeDecision[];
  journal: string;
}

export function parseDecision(raw: string): Decision | null {
  const json = extractJson(raw) as { trades?: unknown; journal?: unknown } | null;
  if (!json || !Array.isArray(json.trades)) return null;
  const trades = json.trades
    .map((t: unknown): TradeDecision | null => {
      const o = (t ?? {}) as Record<string, unknown>;
      const ticker = str(o.ticker).toUpperCase().trim();
      const stake = numOr(o.stake);
      const stopLoss = numOr(o.stopLoss);
      const entry = o.entry === "market" ? ("market" as const) : numOr(o.entry);
      if (ticker === "" || !isSide(o.side) || stake === undefined || stopLoss === undefined || entry === undefined) {
        return null;
      }
      return {
        ticker,
        side: o.side,
        stake,
        leverage: numOr(o.leverage) ?? 1,
        entry,
        stopLoss,
        takeProfit: numOr(o.takeProfit),
        thesis: str(o.thesis),
      };
    })
    .filter((t): t is TradeDecision => t !== null);
  return { trades, journal: str(json.journal) };
}

export interface TickResponse {
  adjustments: Adjustment[];
  journal: string;
}

export function parseTickResponse(raw: string): TickResponse | null {
  const json = extractJson(raw) as { adjustments?: unknown; journal?: unknown } | null;
  if (!json || !Array.isArray(json.adjustments)) return null;
  const adjustments = json.adjustments
    .map((a: unknown): Adjustment | null => {
      const o = (a ?? {}) as Record<string, unknown>;
      const positionId = str(o.positionId);
      if (o.type === "set_stop") {
        const price = numOr(o.price);
        return positionId && price !== undefined ? { type: "set_stop", positionId, price } : null;
      }
      if (o.type === "set_take_profit") {
        const price = o.price === null ? null : numOr(o.price);
        return positionId && price !== undefined ? { type: "set_take_profit", positionId, price } : null;
      }
      if (o.type === "close_position") {
        return positionId ? { type: "close_position", positionId } : null;
      }
      if (o.type === "cancel_order") {
        const orderId = str(o.orderId);
        return orderId ? { type: "cancel_order", orderId } : null;
      }
      return null;
    })
    .filter((a): a is Adjustment => a !== null);
  return { adjustments, journal: str(json.journal) };
}

export function parseAdminAction(raw: string): { action: AdminAction; note: string } | null {
  const json = extractJson(raw) as { action?: unknown; amount?: unknown; note?: unknown } | null;
  if (!json) return null;
  const note = str(json.note);
  if (json.action === "note") return { action: { action: "note" }, note };
  const amount = numOr(json.amount);
  if (amount === undefined || amount < 0) return null;
  if (json.action === "set_balance" || json.action === "deposit" || json.action === "withdraw") {
    return { action: { action: json.action, amount }, note };
  }
  return null;
}
