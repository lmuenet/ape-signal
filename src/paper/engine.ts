// src/paper/engine.ts — deterministic bookkeeping for the paper depot.
// Pure functions only: portfolio in, portfolio out. The conservative fill rule
// is documented in docs/adr/0001-tradingview-scanner-fill-simulation.md.
import {
  COSTS,
  GUARDRAILS,
  type Adjustment,
  type ClosedTrade,
  type EntryOrder,
  type EvidenceBaseline,
  type Portfolio,
  type Position,
  type QuoteMap,
  type Side,
  type TickEvent,
  type TickQuote,
  type TradeDecision,
  type TradeSource,
} from "./types";

/**
 * Add `n` calendar days to a Berlin trading-day string (YYYY-MM-DD). Pure date
 * arithmetic on the date itself (UTC midnight) — no timezone drift, since the
 * input is already a plain Berlin date. Used for multi-day order expiry (TTL).
 */
export function addBerlinDays(day: string, n: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** P&L of a position at a price, capped at -stake (margin is the max loss). */
export function positionPnl(pos: Position, price: number): number {
  const raw =
    pos.side === "long" ? pos.units * (price - pos.entryPrice) : pos.units * (pos.entryPrice - price);
  return Math.max(raw, -pos.stake);
}

/**
 * Total depot value: free cash + reserved order stakes + each position's
 * margin plus its unrealized P&L (at the quoted price; without a quote the
 * position is counted at its margin).
 */
export function equity(p: Portfolio, quotes: QuoteMap = {}): number {
  const orderStakes = p.orders.reduce((s, o) => s + o.stake, 0);
  const positionValue = p.positions.reduce((s, pos) => {
    const q = quotes[pos.ticker];
    return s + pos.stake + (q ? positionPnl(pos, q.close) : 0);
  }, 0);
  return p.balance + orderStakes + positionValue;
}

/**
 * Evidence that the price provably traded at/below `level` since the last
 * tick: the close crossed the level downwards, or the day low moved to a new
 * extreme at/below it (on the first tick of a day the day low counts as-is).
 */
function touchedDown(level: number, now: TickQuote, prev: TickQuote | undefined, firstTick: boolean): boolean {
  if (now.low <= level && (firstTick || prev === undefined || now.low < prev.low)) return true;
  return prev !== undefined && prev.close >= level && now.close <= level;
}

/** Mirror of touchedDown for upward levels. */
function touchedUp(level: number, now: TickQuote, prev: TickQuote | undefined, firstTick: boolean): boolean {
  if (now.high >= level && (firstTick || prev === undefined || now.high > prev.high)) return true;
  return prev !== undefined && prev.close <= level && now.close >= level;
}

/**
 * Evidence that the price provably TRADED AT `level` since the baseline — the
 * fill rule for limit entries. Directional touchedDown/touchedUp are one-sided
 * ("traded at/below" / "at/above") and one of them is trivially true for ANY
 * level, so combining them would fill every limit order (phantom fills at
 * levels the price never visited). Instead:
 * - without a baseline (first tick of the day for an order from an earlier
 *   day): the level must lie INSIDE today's traded range — the overnight-gap
 *   catch-up of ADR 0001;
 * - with a baseline: a day extreme must have moved ACROSS the level since the
 *   baseline, or the close must have crossed it.
 */
function levelTraded(
  level: number,
  now: TickQuote,
  prev: EvidenceBaseline | undefined,
  firstTick: boolean,
): boolean {
  if (firstTick || prev === undefined) return now.low <= level && level <= now.high;
  if (prev.high < level && now.high >= level) return true;
  if (prev.low > level && now.low <= level) return true;
  return (prev.close >= level && now.close <= level) || (prev.close <= level && now.close >= level);
}

/**
 * Fill price for a market entry at this tick, or null when the quote is not
 * trustworthy enough to execute on:
 * - a collapsed print (high == low) is a single stale market-maker quote on a
 *   thin venue, not a live price — wait for the next tick;
 * - a close that drifted more than the band from the placement close means the
 *   price ran away from the level Mr Ape decided on — don't chase it. The
 *   order stays open; if the price never comes back it expires at the close.
 * Legacy orders without a baseline skip the drift check.
 */
function marketFillPrice(order: EntryOrder, q: TickQuote): number | null {
  if (q.high <= q.low) return null;
  if (order.baseline !== undefined && Math.abs(q.close - order.baseline.close) > order.baseline.close * GUARDRAILS.maxMarketDrift) {
    return null;
  }
  return q.close * (order.side === "long" ? 1 + COSTS.halfSpread : 1 - COSTS.halfSpread);
}

/** Price at which the loss equals the full stake (forced liquidation level). */
export function liquidationPrice(pos: Position): number {
  const move = pos.stake / pos.units; // price move that wipes the margin
  return pos.side === "long" ? pos.entryPrice - move : pos.entryPrice + move;
}

/** Flat execution fee — every execution pays it, regardless of order volume. */
export function executionFee(): number {
  return COSTS.orderFee;
}

/**
 * Close a position at `level`. Market-type exits (stop, liquidation, manual)
 * slip half a spread against the trade; a take-profit is a limit and fills
 * exactly at its level. The exit fee is returned separately because the entry
 * fee was already deducted from the balance at fill time.
 */
function closeTrade(
  pos: Position,
  level: number,
  reason: ClosedTrade["reason"],
  now: string,
): { trade: ClosedTrade; exitFee: number } {
  const slip = reason === "take-profit" ? 0 : COSTS.halfSpread;
  const exitPrice = pos.side === "long" ? level * (1 - slip) : level * (1 + slip);
  const raw =
    pos.side === "long" ? pos.units * (exitPrice - pos.entryPrice) : pos.units * (pos.entryPrice - exitPrice);
  const exitFee = executionFee();
  return {
    trade: {
      id: pos.id,
      ticker: pos.ticker,
      side: pos.side,
      stake: pos.stake,
      leverage: pos.leverage,
      entryPrice: pos.entryPrice,
      exitPrice,
      pnl: Math.max(raw, -pos.stake),
      fees: (pos.fees ?? 0) + exitFee,
      reason,
      openedAt: pos.openedAt,
      closedAt: now,
      source: pos.source,
      thesis: pos.thesis,
      // Carry the EUR listing into history (clear name + currency for the UI/journal).
      deSymbol: pos.deSymbol,
      isin: pos.isin,
      name: pos.name,
      currency: pos.currency,
    },
    exitFee,
  };
}

export interface TickOptions {
  now: string; // ISO timestamp of this tick
  day: string; // Berlin trading day YYYY-MM-DD
  isClose: boolean; // the 22:00 closing tick (expires day orders)
}

export interface TickOutcome {
  portfolio: Portfolio;
  events: TickEvent[];
}

/**
 * Process one tick: fill entry orders, trigger stops/take-profits/liquidations
 * on the conservative evidence rule, expire day orders at the closing tick,
 * and record the tick as the next evidence baseline. Tickers without a quote
 * are left untouched. Exits for positions opened in this same tick are NOT
 * evidence-checked (the window evidence predates the entry); only the
 * liquidation level applies from the next tick on.
 */
export function applyTick(p: Portfolio, quotes: QuoteMap, opts: TickOptions): TickOutcome {
  const firstTick = !p.lastTick || p.lastTick.day !== opts.day;
  const prevQuotes = firstTick ? {} : (p.lastTick?.quotes ?? {});
  const events: TickEvent[] = [];

  let balance = p.balance;
  const positions: Position[] = [...p.positions];
  const history = [...p.history];
  const orders: EntryOrder[] = [];
  const openedThisTick = new Set<string>();
  // Ladder rungs that already filled THIS tick — their siblings get cancelled,
  // never double-entered (Stufe 1 mutual-cancel).
  const filledGroups = new Set<string>();

  // 1) Entry orders: fill or (at the closing tick) expire.
  for (const order of p.orders) {
    // A sibling rung of this order's ladder already filled this tick → cancel it
    // (refund the reserved stake), even without a quote.
    if (order.rungGroup && filledGroups.has(order.rungGroup)) {
      balance += order.stake;
      events.push({ kind: "order-expired", order });
      continue;
    }
    const q = quotes[order.ticker];
    if (q) {
      // An order placed mid-day carries its placement quote as the evidence
      // baseline: price action from BEFORE the order existed never fills it.
      // From the next day on the stored baseline is stale → whole-day evidence.
      const baselineApplies = order.baseline !== undefined && order.day === opts.day;
      const evidencePrev = baselineApplies ? order.baseline : prevQuotes[order.ticker];
      const evidenceFirstTick = !baselineApplies && firstTick;
      // A market entry crosses half a spread; a limit entry guarantees its level.
      const fillPrice =
        order.entryType === "market"
          ? marketFillPrice(order, q)
          : levelTraded(order.limitPrice!, q, evidencePrev, evidenceFirstTick)
            ? order.limitPrice!
            : null;
      if (fillPrice !== null && fillPrice > 0) {
        if (order.rungGroup) filledGroups.add(order.rungGroup);
        const entryFee = executionFee();
        balance -= entryFee;
        const position: Position = {
          id: order.id,
          ticker: order.ticker,
          side: order.side,
          stake: order.stake,
          leverage: order.leverage,
          entryPrice: fillPrice,
          units: (order.stake * order.leverage) / fillPrice,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          wakeAbove: order.wakeAbove,
          wakeBelow: order.wakeBelow,
          openedAt: opts.now,
          thesis: order.thesis,
          fees: entryFee,
          source: order.source,
          // Carry the EUR listing onto the position so the monitor tick prices
          // the same venue this order was entered on.
          deSymbol: order.deSymbol,
          isin: order.isin,
          name: order.name,
          currency: order.currency,
        };
        positions.push(position);
        openedThisTick.add(position.id);
        events.push({ kind: "entry-filled", position });
        continue;
      }
    }
    if (opts.isClose && (order.expiresOn ?? order.day) <= opts.day) {
      balance += order.stake; // release the reserved margin
      events.push({ kind: "order-expired", order });
    } else {
      orders.push(order);
    }
  }

  // Second pass: a rung kept earlier in this loop whose sibling filled later must
  // still be cancelled (placement order need not match price order).
  const survivingOrders: EntryOrder[] = [];
  for (const o of orders) {
    if (o.rungGroup && filledGroups.has(o.rungGroup)) {
      balance += o.stake;
      events.push({ kind: "order-expired", order: o });
    } else {
      survivingOrders.push(o);
    }
  }

  // 2) Open positions: stop → take-profit → liquidation (stop wins ties).
  const remaining: Position[] = [];
  for (const pos of positions) {
    const q = quotes[pos.ticker];
    if (!q || openedThisTick.has(pos.id)) {
      remaining.push(pos);
      continue;
    }
    const prev = prevQuotes[pos.ticker];
    const stopTouched =
      pos.side === "long"
        ? touchedDown(pos.stopLoss, q, prev, firstTick)
        : touchedUp(pos.stopLoss, q, prev, firstTick);
    const tpTouched =
      pos.takeProfit !== undefined &&
      (pos.side === "long"
        ? touchedUp(pos.takeProfit, q, prev, firstTick)
        : touchedDown(pos.takeProfit, q, prev, firstTick));
    const liqPrice = liquidationPrice(pos);
    const liqTouched =
      pos.side === "long" ? touchedDown(liqPrice, q, prev, firstTick) : touchedUp(liqPrice, q, prev, firstTick);

    // Falling (long) the price hits the HIGHER of stop/liquidation first —
    // whichever touched level is closer to the entry wins; ties go to the stop.
    let closed: { trade: ClosedTrade; exitFee: number } | null = null;
    if (stopTouched || liqTouched) {
      const useStop = stopTouched && (!liqTouched || !isWorse(pos.stopLoss, liqPrice, pos.side));
      closed = useStop
        ? closeTrade(pos, pos.stopLoss, "stop", opts.now)
        : closeTrade(pos, liqPrice, "liquidation", opts.now);
    } else if (tpTouched) {
      closed = closeTrade(pos, pos.takeProfit!, "take-profit", opts.now);
    }

    if (closed) {
      balance += Math.max(0, closed.trade.stake + closed.trade.pnl) - closed.exitFee;
      history.push(closed.trade);
      events.push({ kind: "position-closed", trade: closed.trade });
    } else {
      remaining.push(pos);
    }
  }

  return {
    // Spread first: meta fields like lastManagerCallAt must survive a tick.
    portfolio: {
      ...p,
      balance,
      positions: remaining,
      orders: survivingOrders,
      history,
      lastTick: { at: opts.now, day: opts.day, quotes },
    },
    events,
  };
}

/**
 * Expire due day orders WITHOUT processing quotes — for the stale-close path
 * (Lebenszeichen spec): when the closing tick has no fresh quotes, fills,
 * stops and band checks must not run, but the time-based expiry still must.
 * lastTick (the fill-evidence baseline) is deliberately left untouched.
 */
export function expireDayOrders(p: Portfolio, day: string): TickOutcome {
  const events: TickEvent[] = [];
  let balance = p.balance;
  const orders = p.orders.filter((order) => {
    if ((order.expiresOn ?? order.day) <= day) {
      balance += order.stake; // release the reserved margin
      events.push({ kind: "order-expired", order });
      return false;
    }
    return true;
  });
  return { portfolio: { ...p, balance, orders }, events };
}

/** True if `a` is a worse exit than `b` for the given side (lower for longs). */
function isWorse(a: number, b: number, side: Side): boolean {
  return side === "long" ? a < b : a > b;
}

export interface PlacementResult {
  portfolio: Portfolio;
  accepted: EntryOrder[];
  rejected: Array<{ decision: TradeDecision; reason: string }>;
}

/** Count today's nominated trades (open orders, fills and closes from today). */
export function tradesPlacedToday(p: Portfolio, day: string): number {
  return (
    p.orders.filter((o) => o.day === day).length +
    p.positions.filter((pos) => pos.openedAt.startsWith(day)).length +
    p.history.filter((t) => t.openedAt.startsWith(day)).length
  );
}

/**
 * Count today's trades that came from the gated intraday opportunism loop
 * (source === "intraday") — the separate Stufe-3 budget tier, distinct from the Kür.
 */
export function intradayTradesPlacedToday(p: Portfolio, day: string): number {
  return (
    p.orders.filter((o) => o.source === "intraday" && o.day === day).length +
    p.positions.filter((pos) => pos.source === "intraday" && pos.openedAt.startsWith(day)).length +
    p.history.filter((t) => t.source === "intraday" && t.openedAt.startsWith(day)).length
  );
}

/**
 * Validate Mr Ape's Kür decisions against the balanced guardrails and reserve
 * the stakes. Leverage is clamped to [1, max]; the stake is clamped to the
 * 20%-of-equity cap and the free balance. Structurally broken decisions
 * (no quote, stop on the wrong side, non-positive numbers, daily budget
 * exhausted) are rejected with a reason instead of being repaired.
 */
export function placeOrders(
  p: Portfolio,
  decisions: TradeDecision[],
  quotes: QuoteMap,
  opts: { now: string; day: string; source?: TradeSource },
): PlacementResult {
  const accepted: EntryOrder[] = [];
  const rejected: PlacementResult["rejected"] = [];
  let portfolio: Portfolio = { ...p, orders: [...p.orders] };
  const placedBefore = tradesPlacedToday(p, opts.day);
  let budget = GUARDRAILS.maxTradesPerDay - placedBefore;

  decisions.forEach((d) => {
    const ticker = d.ticker.toUpperCase();
    const q = quotes[ticker];
    const reference = d.entry === "market" ? q?.close : d.entry;
    const reject = (reason: string) => rejected.push({ decision: d, reason });

    if (budget <= 0) return reject(`Tagesbudget (${GUARDRAILS.maxTradesPerDay} Trades) erschöpft`);
    if (!q) return reject("kein Kurs vom Scanner — Ticker unbekannt?");
    if (d.side !== "long" && d.side !== "short") return reject(`ungültige Seite: ${String(d.side)}`);
    if (typeof reference !== "number" || reference <= 0) return reject("ungültiger Entry-Preis");
    if (typeof d.stopLoss !== "number" || d.stopLoss <= 0) return reject("Stop-Loss fehlt (Pflicht)");
    const stopOk = d.side === "long" ? d.stopLoss < reference : d.stopLoss > reference;
    if (!stopOk) return reject("Stop-Loss liegt auf der falschen Seite des Entry");
    if (d.takeProfit !== undefined) {
      const tpOk = d.side === "long" ? d.takeProfit > reference : d.takeProfit < reference;
      if (!tpOk) return reject("Take-Profit liegt auf der falschen Seite des Entry");
    }
    if (typeof d.stake !== "number" || d.stake <= 0) return reject("ungültiger Einsatz");

    const leverage = Math.min(Math.max(Math.round(d.leverage) || 1, 1), GUARDRAILS.maxLeverage);
    const maxStake = equity(portfolio, quotes) * GUARDRAILS.maxStakeFraction;
    const stake = Math.min(d.stake, maxStake, portfolio.balance);
    if (stake <= 0) return reject("kein freies Guthaben für den Einsatz");

    // Wake bands are soft: an invalid side is dropped, never a trade rejection.
    const wakeAbove = typeof d.wakeAbove === "number" && d.wakeAbove > reference ? d.wakeAbove : undefined;
    const wakeBelow = typeof d.wakeBelow === "number" && d.wakeBelow > 0 && d.wakeBelow < reference ? d.wakeBelow : undefined;

    // Multi-day TTL (Stufe 1): clamp to [1, max]; only future-dated orders carry
    // an expiresOn — same-day orders stay undefined (= today, the existing behaviour).
    const ttlDays = Math.min(Math.max(Math.round(d.ttlDays ?? 1) || 1, 1), GUARDRAILS.maxTtlDays);
    const expiresOn = ttlDays > 1 ? addBerlinDays(opts.day, ttlDays - 1) : undefined;

    const order: EntryOrder = {
      id: `${ticker}-${opts.day}-${placedBefore + accepted.length + 1}`,
      ticker,
      side: d.side,
      stake,
      leverage,
      entryType: d.entry === "market" ? "market" : "limit",
      limitPrice: d.entry === "market" ? undefined : d.entry,
      stopLoss: d.stopLoss,
      takeProfit: d.takeProfit,
      wakeAbove,
      wakeBelow,
      expiresOn,
      source: opts.source,
      thesis: d.thesis ?? "",
      createdAt: opts.now,
      day: opts.day,
      // EUR listing carried from the resolved decision (ADR 0005) — undefined on
      // legacy/US decisions, in which case pricing falls back to the US ticker.
      deSymbol: d.deSymbol,
      isin: d.isin,
      name: d.name,
      currency: d.currency,
      // Placement snapshot: touch evidence starts HERE, not at today's open.
      baseline: { close: q.close, high: q.high, low: q.low },
    };
    portfolio = { ...portfolio, balance: portfolio.balance - stake, orders: [...portfolio.orders, order] };
    accepted.push(order);
    budget -= 1;
  });

  // Ladder rungs (Stufe 1): ≥2 accepted LIMIT orders on the same ticker+side placed
  // in THIS call are rungs of one conviction → shared rungGroup (one fills, the engine
  // cancels the rest). Keyed by order id so pre-existing same-ticker orders are never
  // retroactively grouped.
  const limitCounts = new Map<string, number>();
  for (const o of accepted) {
    if (o.entryType !== "limit") continue;
    const key = `${o.ticker}|${o.side}`;
    limitCounts.set(key, (limitCounts.get(key) ?? 0) + 1);
  }
  const rungGroupById = new Map<string, string>();
  for (const o of accepted) {
    if (o.entryType === "limit" && (limitCounts.get(`${o.ticker}|${o.side}`) ?? 0) >= 2) {
      rungGroupById.set(o.id, `${o.ticker}-${o.side}-${opts.day}-ladder`);
    }
  }
  if (rungGroupById.size === 0) return { portfolio, accepted, rejected };

  const withGroup = (o: EntryOrder): EntryOrder =>
    rungGroupById.has(o.id) ? { ...o, rungGroup: rungGroupById.get(o.id) } : o;
  return {
    portfolio: { ...portfolio, orders: portfolio.orders.map(withGroup) },
    accepted: accepted.map(withGroup),
    rejected,
  };
}

export interface AdjustmentResult {
  portfolio: Portfolio;
  applied: Adjustment[];
  rejected: Array<{ adjustment: Adjustment; reason: string }>;
  events: TickEvent[];
}

/**
 * Apply Mr Ape's tick adjustments. A new stop must sit on the losing side of
 * the current price (otherwise it would fire instantly on the next tick);
 * closes happen at the current quote. Invalid requests are rejected, never
 * repaired.
 */
export function applyAdjustments(
  p: Portfolio,
  adjustments: Adjustment[],
  quotes: QuoteMap,
  now: string,
): AdjustmentResult {
  let portfolio: Portfolio = { ...p, positions: [...p.positions], orders: [...p.orders], history: [...p.history] };
  const applied: Adjustment[] = [];
  const rejected: AdjustmentResult["rejected"] = [];
  const events: TickEvent[] = [];

  for (const adj of adjustments) {
    const reject = (reason: string) => rejected.push({ adjustment: adj, reason });

    if (adj.type === "cancel_order") {
      const order = portfolio.orders.find((o) => o.id === adj.orderId);
      if (!order) {
        reject(`Order ${adj.orderId} nicht gefunden`);
        continue;
      }
      portfolio = {
        ...portfolio,
        balance: portfolio.balance + order.stake,
        orders: portfolio.orders.filter((o) => o.id !== order.id),
      };
      events.push({ kind: "order-expired", order });
      applied.push(adj);
      continue;
    }

    const pos = portfolio.positions.find((x) => x.id === adj.positionId);
    if (!pos) {
      reject(`Position ${adj.positionId} nicht gefunden`);
      continue;
    }
    const q = quotes[pos.ticker];

    if (adj.type === "set_stop") {
      if (!q) {
        reject("kein aktueller Kurs — Stop unverändert");
        continue;
      }
      const ok = adj.price > 0 && (pos.side === "long" ? adj.price < q.close : adj.price > q.close);
      if (!ok) {
        reject("neuer Stop liegt auf der falschen Seite des aktuellen Kurses");
        continue;
      }
      portfolio = replacePosition(portfolio, { ...pos, stopLoss: adj.price });
      applied.push(adj);
    } else if (adj.type === "set_take_profit") {
      if (adj.price !== null) {
        if (!q) {
          reject("kein aktueller Kurs — Take-Profit unverändert");
          continue;
        }
        const ok = adj.price > 0 && (pos.side === "long" ? adj.price > q.close : adj.price < q.close);
        if (!ok) {
          reject("Take-Profit liegt auf der falschen Seite des aktuellen Kurses");
          continue;
        }
      }
      portfolio = replacePosition(portfolio, { ...pos, takeProfit: adj.price ?? undefined });
      applied.push(adj);
    } else if (adj.type === "set_wake_band") {
      if (!q) {
        reject("kein aktueller Kurs — Wake-Band unverändert");
        continue;
      }
      if (adj.above !== null && !(adj.above > q.close)) {
        reject("Wake-Band oben muss über dem aktuellen Kurs liegen");
        continue;
      }
      if (adj.below !== null && !(adj.below > 0 && adj.below < q.close)) {
        reject("Wake-Band unten muss unter dem aktuellen Kurs liegen");
        continue;
      }
      portfolio = replacePosition(portfolio, {
        ...pos,
        wakeAbove: adj.above ?? undefined,
        wakeBelow: adj.below ?? undefined,
      });
      applied.push(adj);
    } else {
      // close_position
      if (!q) {
        reject("kein aktueller Kurs — Position bleibt offen");
        continue;
      }
      const { trade, exitFee } = closeTrade(pos, q.close, "manual", now);
      portfolio = {
        ...portfolio,
        balance: portfolio.balance + Math.max(0, trade.stake + trade.pnl) - exitFee,
        positions: portfolio.positions.filter((x) => x.id !== pos.id),
        history: [...portfolio.history, trade],
      };
      events.push({ kind: "position-closed", trade });
      applied.push(adj);
    }
  }

  return { portfolio, applied, rejected, events };
}

function replacePosition(p: Portfolio, pos: Position): Portfolio {
  return { ...p, positions: p.positions.map((x) => (x.id === pos.id ? pos : x)) };
}

export type AdminAction =
  | { action: "set_balance"; amount: number }
  | { action: "deposit"; amount: number }
  | { action: "withdraw"; amount: number }
  | { action: "note" };

/** Apply a /journal admin instruction to the FREE balance (never positions). */
export function adminAdjust(p: Portfolio, action: AdminAction): Portfolio {
  if (action.action === "set_balance" && action.amount >= 0) return { ...p, balance: action.amount };
  if (action.action === "deposit" && action.amount > 0) return { ...p, balance: p.balance + action.amount };
  if (action.action === "withdraw" && action.amount > 0)
    return { ...p, balance: Math.max(0, p.balance - action.amount) };
  return p;
}
