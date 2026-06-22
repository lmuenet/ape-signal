// src/paper/format.ts — plain-text rendering of the depot for prompts,
// Telegram messages and the journal. Pure string builders.
import { equity, liquidationPrice, positionPnl } from "./engine";
import { formatTech } from "./trend";
import type { Adjustment, ClosedTrade, EntryOrder, Portfolio, Position, QuoteMap, TickEvent } from "./types";

const usd = (n: number) => `${n >= 0 ? "" : "-"}$${Math.abs(n).toFixed(2)}`;
const sign = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

/** Human label per close reason (shared by event lines and the track-record). */
export const closeReasonLabel: Record<ClosedTrade["reason"], string> = {
  stop: "Stop-Loss",
  "take-profit": "Take-Profit",
  liquidation: "LIQUIDIERT",
  manual: "Geschlossen",
};

function positionLine(pos: Position, quotes: QuoteMap): string {
  const q = quotes[pos.ticker];
  const pnl = q ? positionPnl(pos, q.close) : null;
  const pnlText = pnl === null ? "Kurs fehlt" : `P&L ${usd(pnl)} (${sign((pnl / pos.stake) * 100)}%)`;
  const tp = pos.takeProfit !== undefined ? `, TP ${pos.takeProfit}` : "";
  const wake =
    pos.wakeAbove !== undefined || pos.wakeBelow !== undefined
      ? `, Wake ${pos.wakeBelow ?? "—"}/${pos.wakeAbove ?? "—"}`
      : "";
  return (
    `[${pos.id}] ${pos.ticker} ${pos.side} ${pos.leverage}x, Einsatz ${usd(pos.stake)}, ` +
    `Entry ${pos.entryPrice}${q ? `, Kurs ${q.close}` : ""}, SL ${pos.stopLoss}${tp}${wake}, ` +
    `Liq ${liquidationPrice(pos).toFixed(2)} — ${pnlText}`
  );
}

/** One human line for an entry order: type, stop, ladder marker and validity (expiresOn ?? day). */
export function orderLine(o: EntryOrder): string {
  const entry = o.entryType === "market" ? "Market" : `Limit ${o.limitPrice}`;
  const tp = o.takeProfit !== undefined ? `, TP ${o.takeProfit}` : "";
  const rung = o.rungGroup !== undefined ? ", Leiter-Rung" : "";
  return `[${o.id}] ${o.ticker} ${o.side} ${o.leverage}x, Einsatz ${usd(o.stake)}, ${entry}, SL ${o.stopLoss}${tp}${rung} (gültig bis Handelsschluss ${o.expiresOn ?? o.day})`;
}

/** Compact depot block — used in prompts and the /journal status message. */
export function renderPortfolio(p: Portfolio, quotes: QuoteMap): string {
  const lines = [
    `Guthaben (frei): ${usd(p.balance)}`,
    `Equity (gesamt): ${usd(equity(p, quotes))}`,
  ];
  lines.push("", p.positions.length > 0 ? "Offene Positionen:" : "Offene Positionen: keine");
  for (const pos of p.positions) lines.push("  " + positionLine(pos, quotes));
  lines.push("", p.orders.length > 0 ? "Offene Orders:" : "Offene Orders: keine");
  for (const o of p.orders) lines.push("  " + orderLine(o));
  return lines.join("\n");
}

/** Current quotes block for prompts. */
export function renderQuotes(quotes: QuoteMap): string {
  const entries = Object.entries(quotes);
  if (entries.length === 0) return "Keine Kurse verfügbar.";
  return entries
    .map(
      ([t, q]) =>
        `${t}: ${q.close} (heute ${sign(q.changePct)}%, Tageshoch ${q.high}, Tagestief ${q.low})${formatTech(q)}`,
    )
    .join("\n");
}

/** One Telegram line per tick event (also reused as the journal record). */
export function formatEvent(e: TickEvent): string {
  if (e.kind === "entry-filled") {
    const p = e.position;
    const tp = p.takeProfit !== undefined ? `, TP ${p.takeProfit}` : "";
    return `🟢 Eröffnet: ${p.ticker} ${p.side} ${p.leverage}x @ ${p.entryPrice} — Einsatz ${usd(p.stake)}, SL ${p.stopLoss}${tp}`;
  }
  if (e.kind === "order-expired") {
    return `⏳ Order verfallen: ${e.order.ticker} ${e.order.side} (${e.order.entryType === "limit" ? `Limit ${e.order.limitPrice}` : "Market"}) — Einsatz ${usd(e.order.stake)} zurück`;
  }
  const t = e.trade;
  const emoji = t.pnl >= 0 ? "✅" : t.reason === "liquidation" ? "💀" : "🔴";
  return `${emoji} ${closeReasonLabel[t.reason]}: ${t.ticker} ${t.side} @ ${t.exitPrice} — P&L ${usd(t.pnl)} (${sign((t.pnl / t.stake) * 100)}%)`;
}

/** The Kandidatenkür Telegram post. */
export function formatKuer(accepted: EntryOrder[], rejectedReasons: string[], journal: string): string {
  const lines = [`🦍 Mr Ape — Kandidatenkür (${new Date().toISOString().slice(0, 10)})`, ""];
  if (accepted.length === 0) {
    lines.push("Heute keine neuen Trades — kein Setup hat überzeugt.");
  } else {
    for (const o of accepted) lines.push("• " + orderLine(o), o.thesis ? `  ↳ ${o.thesis}` : "");
  }
  if (rejectedReasons.length > 0) {
    lines.push("", "Vom Risiko-Check abgelehnt:", ...rejectedReasons.map((r) => `  ✗ ${r}`));
  }
  if (journal.trim() !== "") lines.push("", journal.trim());
  lines.push("", "Paper-Trading — kein echtes Geld, keine Anlageberatung.");
  return lines.filter((l) => l !== undefined).join("\n");
}

/** One human line per manager adjustment (journal + Telegram). */
export function describeAdjustment(a: Adjustment): string {
  switch (a.type) {
    case "set_stop":
      return `Stop von ${a.positionId} auf ${a.price}`;
    case "set_take_profit":
      return `Take-Profit von ${a.positionId} auf ${a.price === null ? "entfernt" : a.price}`;
    case "set_wake_band":
      return `Wake-Band von ${a.positionId}: oben ${a.above ?? "—"}, unten ${a.below ?? "—"}`;
    case "close_position":
      return `Position ${a.positionId} schließen`;
    case "cancel_order":
      return `Order ${a.orderId} streichen`;
  }
}

/**
 * The bundled Telegram message for one manager tick (ADR 0003): the why
 * (journal note), every applied adjustment, rejections with reason, and
 * manager-initiated closes. "" when there is nothing to say.
 */
export function formatManagerNote(
  time: string,
  journal: string,
  applied: Adjustment[],
  rejected: Array<{ adjustment: Adjustment; reason: string }>,
  closeEvents: TickEvent[],
  breachLines: string[] = [],
): string {
  if (
    journal.trim() === "" &&
    applied.length === 0 &&
    rejected.length === 0 &&
    closeEvents.length === 0 &&
    breachLines.length === 0
  ) {
    return "";
  }
  const lines = [`🦍 Mr Ape — Manager-Tick ${time}`];
  // A breached wake band is always surfaced — even on a hold (ADR 0003
  // amendment): a wake must never end in silence. With no reason from Mr Ape we
  // still say he looked and held.
  if (breachLines.length > 0) lines.push("", ...breachLines);
  if (journal.trim() !== "") lines.push("", journal.trim());
  else if (breachLines.length > 0 && applied.length === 0 && closeEvents.length === 0) {
    lines.push("", "↳ Mr Ape hält die Position (keine Begründung geliefert).");
  }
  const closes = closeEvents.map(formatEvent);
  if (closes.length > 0) lines.push("", ...closes);
  const nonClose = applied.filter((a) => a.type !== "close_position");
  if (nonClose.length > 0) lines.push("", ...nonClose.map((a) => `🔧 ${describeAdjustment(a)}`));
  if (rejected.length > 0) lines.push("", ...rejected.map((r) => `✗ abgelehnt (${r.reason}): ${describeAdjustment(r.adjustment)}`));
  return lines.join("\n");
}

/** The after-close Telegram daily summary. */
export function formatDailySummary(
  p: Portfolio,
  quotes: QuoteMap,
  day: string,
  opts: { staleQuotesFrom?: string; healthLine?: string } = {},
): string {
  const todayTrades = p.history.filter((t) => t.closedAt.startsWith(day));
  const dayPnl = todayTrades.reduce((s, t) => s + t.pnl, 0);
  const stale = opts.staleQuotesFrom !== undefined ? ` (Kurse von ${opts.staleQuotesFrom})` : "";
  const lines = [
    `🦍 Mr Ape — Tagesabschluss ${day}`,
    "",
    `Equity: ${usd(equity(p, quotes))} · Guthaben frei: ${usd(p.balance)}${stale}`,
    `Heute realisiert: ${usd(dayPnl)} (${todayTrades.length} Trade${todayTrades.length === 1 ? "" : "s"})`,
    "",
    renderPortfolio(p, quotes).split("\n").slice(2).join("\n"),
  ];
  if (opts.healthLine !== undefined) lines.push("", opts.healthLine);
  return lines.join("\n");
}

/** Reflection block: the last `limit` closed trades as one line each (for the decider prompt). */
export function renderTrackRecord(history: ClosedTrade[], limit: number): string {
  const recent = history.slice(-limit).reverse();
  const lines = ["## Bisheriger Track-Record (Lehren)"];
  if (recent.length === 0) {
    lines.push("(noch keine abgeschlossenen Trades)");
    return lines.join("\n");
  }
  for (const t of recent) {
    const days = (Date.parse(t.closedAt) - Date.parse(t.openedAt)) / 86_400_000;
    const hold = days < 1 ? "<1 Tag" : `${Math.round(days)} Tag${Math.round(days) === 1 ? "" : "e"}`;
    const pnlPct = sign((t.pnl / t.stake) * 100);
    const thesis = t.thesis?.trim() ? `These „${t.thesis.trim()}"` : "ohne These";
    lines.push(`${t.ticker} ${t.side}, ${thesis} → ${closeReasonLabel[t.reason]}, P&L ${pnlPct}% (${hold})`);
  }
  return lines.join("\n");
}
