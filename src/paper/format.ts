// src/paper/format.ts — plain-text rendering of the depot for prompts,
// Telegram messages and the journal. Pure string builders.
import { equity, liquidationPrice, positionPnl } from "./engine";
import { formatTech } from "./trend";
import type { Adjustment, ClosedTrade, EntryOrder, Portfolio, Position, QuoteMap, TickEvent } from "./types";
import type { Debate, Dossier } from "./decision";

// Money with the instrument/depot currency symbol. Default EUR — the depot is
// EUR-denominated after the German-pricing migration (ADR 0005); legacy USD
// positions still render with "$" via their stored currency.
const CCY_SYMBOL: Record<string, string> = { EUR: "€", USD: "$" };
export const money = (n: number, currency = "EUR") =>
  `${n >= 0 ? "" : "-"}${CCY_SYMBOL[currency] ?? "€"}${Math.abs(n).toFixed(2)}`;
const sign = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

/** "Klarname (TICKER)" when a clear name is known (ADR 0005), else just the ticker. */
export const label = (x: { ticker: string; name?: string }) =>
  x.name && x.name.trim() !== "" ? `${x.name} (${x.ticker})` : x.ticker;

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
  const pnlText = pnl === null ? "Kurs fehlt" : `P&L ${money(pnl, pos.currency)} (${sign((pnl / pos.stake) * 100)}%)`;
  const tp = pos.takeProfit !== undefined ? `, TP ${pos.takeProfit}` : "";
  const wake =
    pos.wakeAbove !== undefined || pos.wakeBelow !== undefined
      ? `, Wake ${pos.wakeBelow ?? "—"}/${pos.wakeAbove ?? "—"}`
      : "";
  return (
    `[${pos.id}] ${label(pos)} ${pos.side} ${pos.leverage}x, Einsatz ${money(pos.stake, pos.currency)}, ` +
    `Entry ${pos.entryPrice}${q ? `, Kurs ${q.close}` : ""}, SL ${pos.stopLoss}${tp}${wake}, ` +
    `Liq ${liquidationPrice(pos).toFixed(2)} — ${pnlText}`
  );
}

/** One human line for an entry order: type, stop, ladder marker and validity (expiresOn ?? day). */
export function orderLine(o: EntryOrder): string {
  const entry = o.entryType === "market" ? "Market" : `Limit ${o.limitPrice}`;
  const tp = o.takeProfit !== undefined ? `, TP ${o.takeProfit}` : "";
  const rung = o.rungGroup !== undefined ? ", Leiter-Rung" : "";
  return `[${o.id}] ${label(o)} ${o.side} ${o.leverage}x, Einsatz ${money(o.stake, o.currency)}, ${entry}, SL ${o.stopLoss}${tp}${rung} (gültig bis Handelsschluss ${o.expiresOn ?? o.day})`;
}

/** Compact depot block — used in prompts and the /journal status message. */
export function renderPortfolio(p: Portfolio, quotes: QuoteMap): string {
  const lines = [
    `Guthaben (frei): ${money(p.balance)}`,
    `Equity (gesamt): ${money(equity(p, quotes))}`,
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
    return `🟢 Eröffnet: ${label(p)} ${p.side} ${p.leverage}x @ ${p.entryPrice} — Einsatz ${money(p.stake, p.currency)}, SL ${p.stopLoss}${tp}`;
  }
  if (e.kind === "order-expired") {
    return `⏳ Order verfallen: ${label(e.order)} ${e.order.side} (${e.order.entryType === "limit" ? `Limit ${e.order.limitPrice}` : "Market"}) — Einsatz ${money(e.order.stake, e.order.currency)} zurück`;
  }
  const t = e.trade;
  const emoji = t.pnl >= 0 ? "✅" : t.reason === "liquidation" ? "💀" : "🔴";
  return `${emoji} ${closeReasonLabel[t.reason]}: ${label(t)} ${t.side} @ ${t.exitPrice} — P&L ${money(t.pnl, t.currency)} (${sign((t.pnl / t.stake) * 100)}%)`;
}

/** "TRADEGATE:AMD" → "Tradegate" — the human venue part of a deSymbol, null without one. */
function venueLabel(deSymbol?: string): string | null {
  const raw = deSymbol?.split(":")[0]?.trim();
  if (!raw) return null;
  return raw[0].toUpperCase() + raw.slice(1).toLowerCase();
}

const SIDE_TAG: Record<EntryOrder["side"], string> = { long: "🟢 LONG", short: "🔻 SHORT" };

/**
 * Three terse signal lines for one entry order (Signal-Split, Beschluss
 * 2026-07-02): what to do, the guardrail levels + size, and how to reproduce it
 * (venue, ISIN, validity). Deliberately NO thesis — the story travels
 * separately as a "research" message.
 */
export function signalOrderLines(o: EntryOrder, equityAtPlacement?: number): string[] {
  const entry = o.entryType === "market" ? "Market" : `Limit ${money(o.limitPrice ?? 0, o.currency)}`;
  const pct =
    equityAtPlacement !== undefined && equityAtPlacement > 0
      ? ` (${Math.round((o.stake / equityAtPlacement) * 100)}%)`
      : "";
  const levels = [
    `SL ${o.stopLoss}`,
    ...(o.takeProfit !== undefined ? [`TP ${o.takeProfit}`] : []),
    `${o.leverage}x`,
    `Einsatz ${money(o.stake, o.currency)}${pct}`,
  ].join(" · ");
  const venue = venueLabel(o.deSymbol);
  const origin = [
    ...(venue ? [venue] : []),
    ...(o.isin ? [o.isin] : []),
    `gültig bis ${o.expiresOn ?? o.day}`,
    ...(o.rungGroup !== undefined ? ["Leiter-Rung"] : []),
  ].join(" · ");
  return [`${SIDE_TAG[o.side]} ${o.ticker} — ${entry}`, `   ${levels}`, `   ${origin}`];
}

export interface KuerMessageOpts {
  day: string;
  /** Human market label ("Xetra"/"US-Markt") in xetra+us mode — which Kür this is. */
  marketLabel?: string;
  /** Equity at placement — renders each stake also as % of equity. */
  equity?: number;
}

const kuerHeader = (opts: KuerMessageOpts, suffix = "") =>
  `🦍 Mr Ape — Kandidatenkür ${opts.day}${opts.marketLabel ? ` · ${opts.marketLabel}` : ""}${suffix}`;

/** The terse Kür signal post ("trade"): one 3-line block per placed order, no prose. */
export function formatKuerSignal(accepted: EntryOrder[], opts: KuerMessageOpts): string {
  const lines = [kuerHeader(opts), ""];
  if (accepted.length === 0) {
    lines.push("Heute keine neuen Trades — kein Setup hat überzeugt.");
  } else {
    accepted.forEach((o, i) => {
      if (i > 0) lines.push("");
      lines.push(...signalOrderLines(o, opts.equity));
    });
  }
  lines.push("", "Paper-Trading — kein echtes Geld, keine Anlageberatung.");
  return lines.join("\n");
}

/**
 * The Kür's reasoning ("research", default-muted): journal, per-order theses and
 * risk-check rejections. "" when there is nothing to explain.
 */
export function formatKuerStory(
  accepted: EntryOrder[],
  rejectedReasons: string[],
  journal: string,
  opts: KuerMessageOpts,
): string {
  const parts: string[] = [];
  if (journal.trim() !== "") parts.push(journal.trim());
  const theses = accepted
    .filter((o) => o.thesis && o.thesis.trim() !== "")
    .map((o) => `${o.ticker}: ${o.thesis?.trim()}`);
  if (theses.length > 0) parts.push(theses.join("\n"));
  if (rejectedReasons.length > 0) {
    parts.push(["Vom Risiko-Check abgelehnt:", ...rejectedReasons.map((r) => `  ✗ ${r}`)].join("\n"));
  }
  if (parts.length === 0) return "";
  return [kuerHeader(opts, " — Begründung"), "", parts.join("\n\n")].join("\n");
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
 * The terse manager signal ("trade", Signal-Split Beschluss 2026-07-02): only
 * what actually changed — manager-initiated closes and applied adjustments.
 * "" when nothing actionable happened (the story/hold paths cover the rest).
 */
export function formatManagerSignal(time: string, applied: Adjustment[], closeEvents: TickEvent[]): string {
  const nonClose = applied.filter((a) => a.type !== "close_position");
  if (nonClose.length === 0 && closeEvents.length === 0) return "";
  const lines = [`🦍 Mr Ape — Manager-Tick ${time}`];
  const closes = closeEvents.map(formatEvent);
  if (closes.length > 0) lines.push("", ...closes);
  if (nonClose.length > 0) lines.push("", ...nonClose.map((a) => `🔧 ${describeAdjustment(a)}`));
  return lines.join("\n");
}

/**
 * The manager's reasoning ("research", default-muted): journal note, breach
 * context and rejected adjustments. "" when there is nothing to explain.
 */
export function formatManagerStory(
  time: string,
  journal: string,
  rejected: Array<{ adjustment: Adjustment; reason: string }>,
  breachLines: string[] = [],
): string {
  if (journal.trim() === "" && rejected.length === 0 && breachLines.length === 0) return "";
  const lines = [`🦍 Mr Ape — Manager-Tick ${time} — Begründung`];
  if (breachLines.length > 0) lines.push("", ...breachLines);
  if (journal.trim() !== "") lines.push("", journal.trim());
  if (rejected.length > 0) lines.push("", ...rejected.map((r) => `✗ abgelehnt (${r.reason}): ${describeAdjustment(r.adjustment)}`));
  return lines.join("\n");
}

/**
 * A breached wake band with NO resulting action ("alert"): breach lines plus
 * Mr Ape's hold reason — a wake must never end in silence (ADR 0003), and with
 * default verbosity only trade/digest/alert reach the chat.
 */
export function formatWakeHold(time: string, journal: string, breachLines: string[]): string {
  const lines = [`🦍 Mr Ape — Manager-Tick ${time}`, "", ...breachLines];
  lines.push("", journal.trim() !== "" ? journal.trim() : "↳ Mr Ape hält die Position (keine Begründung geliefert).");
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
    `Equity: ${money(equity(p, quotes))} · Guthaben frei: ${money(p.balance)}${stale}`,
    `Heute realisiert: ${money(dayPnl)} (${todayTrades.length} Trade${todayTrades.length === 1 ? "" : "s"})`,
    "",
    renderPortfolio(p, quotes).split("\n").slice(2).join("\n"),
  ];
  if (opts.healthLine !== undefined) lines.push("", opts.healthLine);
  return lines.join("\n");
}

/** Condensed Telegram mirror of the Kür's research dossier + bull/bear debate. */
export function formatDecisionMirror(dossier: Dossier | null, debate: Debate | null): string {
  if (!dossier && !debate) return "";
  const candidates = dossier?.candidates ?? [];
  const lines: string[] = [];
  for (const c of candidates) {
    const d = debate?.debates.find((x) => x.ticker === c.ticker);
    lines.push(d ? `${c.ticker}: ${c.angle} · Bull ${d.bull} / Bear ${d.bear}` : `${c.ticker}: ${c.angle}`);
  }
  if (lines.length === 0) return "";
  const header = [`🦍 Mr Ape — Research & Debatte (${new Date().toISOString().slice(0, 10)})`, ""];
  if (dossier && dossier.marketContext.trim() !== "") lines.push("", `Marktlage: ${dossier.marketContext.trim()}`);
  return [...header, ...lines].join("\n");
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
    lines.push(`${label(t)} ${t.side}, ${thesis} → ${closeReasonLabel[t.reason]}, P&L ${pnlPct}% (${hold})`);
  }
  return lines.join("\n");
}
