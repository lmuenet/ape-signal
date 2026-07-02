import { describe, expect, it } from "vitest";
import { describeAdjustment, formatDailySummary, formatDecisionMirror, formatEvent, formatKuerSignal, formatKuerStory, formatManagerSignal, formatManagerStory, formatWakeHold, orderLine, renderPortfolio, renderTrackRecord } from "./format";
import type { Adjustment, ClosedTrade, EntryOrder, Portfolio, Position, QuoteMap, TickEvent } from "./types";
import type { Debate, Dossier } from "./decision";

const pos: Position = {
  id: "P1", ticker: "AAPL", side: "long", stake: 200, leverage: 2,
  entryPrice: 100, units: 4, stopLoss: 90, takeProfit: 120,
  wakeAbove: 110, wakeBelow: 95,
  openedAt: "2026-06-11T14:00:00.000Z", thesis: "",
};
const quotes: QuoteMap = { AAPL: { close: 105, changePct: 1, high: 106, low: 99 } };
const p: Portfolio = { balance: 800, positions: [pos], orders: [], history: [] };

const ct = (over: Partial<ClosedTrade> = {}): ClosedTrade => ({
  id: "1", ticker: "AMD", side: "long", stake: 100, leverage: 2,
  entryPrice: 100, exitPrice: 106, pnl: 12, reason: "take-profit",
  openedAt: "2026-06-06T13:00:00Z", closedAt: "2026-06-09T13:00:00Z",
  thesis: "EMA-Cross Pullback", ...over,
});

describe("renderTrackRecord", () => {
  it("is empty-friendly", () => {
    expect(renderTrackRecord([], 8)).toContain("noch keine abgeschlossenen Trades");
  });
  it("renders one line per trade with reason, pnl% and hold duration", () => {
    const out = renderTrackRecord([ct()], 8);
    expect(out).toContain("AMD long");
    expect(out).toContain("EMA-Cross Pullback");
    expect(out).toContain("Take-Profit");
    expect(out).toContain("+12.00%");
    expect(out).toContain("3 Tage");
  });
  it("marks sub-day holds and respects the limit", () => {
    const intraday = ct({ openedAt: "2026-06-09T13:00:00Z", closedAt: "2026-06-09T17:00:00Z", reason: "stop", pnl: -20 });
    expect(renderTrackRecord([intraday], 8)).toContain("<1 Tag");
    const many = Array.from({ length: 10 }, (_, i) => ct({ id: String(i), ticker: `T${i}` }));
    const out = renderTrackRecord(many, 3);
    expect(out.split("\n").filter((l) => l.includes("long")).length).toBe(3);
  });
});

describe("formatDecisionMirror", () => {
  const dossier: Dossier = {
    candidates: [{ ticker: "AMD", angle: "Long auf Pullback", catalyst: "Earnings", sentiment: "bullisch" }],
    marketContext: "SPY ruhig, VIX niedrig",
  };
  const debate: Debate = { debates: [{ ticker: "AMD", bull: "Trend intakt", bear: "RSI hoch" }] };

  it("merges dossier + debate into one line per candidate plus market line", () => {
    const out = formatDecisionMirror(dossier, debate);
    expect(out).toContain("Research & Debatte");
    expect(out).toContain("AMD: Long auf Pullback");
    expect(out).toContain("Bull Trend intakt / Bear RSI hoch");
    expect(out).toContain("Marktlage: SPY ruhig, VIX niedrig");
  });
  it("renders angle only when a candidate has no debate", () => {
    const out = formatDecisionMirror(dossier, { debates: [] });
    expect(out).toContain("AMD: Long auf Pullback");
    expect(out).not.toContain("Bull");
  });
  it("returns empty string when there is nothing to mirror", () => {
    expect(formatDecisionMirror(null, null)).toBe("");
    expect(formatDecisionMirror({ candidates: [], marketContext: "" }, null)).toBe("");
  });
});

describe("renderPortfolio", () => {
  it("shows the wake band on the position line", () => {
    expect(renderPortfolio(p, quotes)).toContain("Wake 95/110");
  });

  it("shows the multi-day expiry and a ladder-rung marker on the order line (Stufe 1)", () => {
    const order: EntryOrder = {
      id: "AAPL-2026-06-11-1", ticker: "AAPL", side: "long", stake: 100, leverage: 1,
      entryType: "limit", limitPrice: 98, stopLoss: 90, thesis: "",
      createdAt: "2026-06-11T13:00:00.000Z", day: "2026-06-11",
      expiresOn: "2026-06-13", rungGroup: "AAPL-long-2026-06-11-ladder",
    };
    const out = renderPortfolio({ balance: 800, positions: [], orders: [order], history: [] }, {});
    expect(out).toContain("gültig bis Handelsschluss 2026-06-13");
    expect(out).toContain("Leiter-Rung");
  });
});

describe("EUR-Anzeige (ADR 0005): Klarname + Waehrungssymbol", () => {
  const eurPos: Position = { ...pos, ticker: "QCOM", name: "QUALCOMM Incorporated", currency: "EUR", deSymbol: "TRADEGATE:QCI" };
  const eurQuotes: QuoteMap = { QCOM: { close: 175, changePct: -1, high: 190, low: 174 } };

  it("zeigt den Klarnamen und € auf der Positionszeile", () => {
    const out = renderPortfolio({ balance: 800, positions: [eurPos], orders: [], history: [] }, eurQuotes);
    expect(out).toContain("QUALCOMM Incorporated (QCOM)");
    expect(out).toContain("Einsatz €200.00");
    expect(out).not.toContain("$");
  });

  it("nutzt € fuer Guthaben/Equity per Default (EUR-Depot)", () => {
    const out = renderPortfolio({ balance: 800, positions: [], orders: [], history: [] }, {});
    expect(out).toContain("Guthaben (frei): €800.00");
  });

  it("zeigt Klarname + € im entry-filled-Event", () => {
    const line = formatEvent({ kind: "entry-filled", position: eurPos } as TickEvent);
    expect(line).toContain("QUALCOMM Incorporated (QCOM)");
    expect(line).toContain("Einsatz €200.00");
  });

  it("faellt auf den Ticker zurueck, wenn kein Klarname gesetzt ist", () => {
    const out = orderLine({
      id: "X-1", ticker: "AMD", side: "long", stake: 100, leverage: 1,
      entryType: "market", stopLoss: 90, thesis: "", createdAt: "2026-06-11T13:00:00.000Z", day: "2026-06-11",
    });
    expect(out).toContain("AMD long"); // Ticker-only Label (kein "Name (AMD)")
  });
});

describe("describeAdjustment", () => {
  it("describes set_wake_band including cleared sides", () => {
    const adj: Adjustment = { type: "set_wake_band", positionId: "P1", above: 112, below: null };
    expect(describeAdjustment(adj)).toBe("Wake-Band von P1: oben 112, unten —");
  });
});

describe("formatManagerSignal / formatManagerStory / formatWakeHold (Signal-Split)", () => {
  const applied: Adjustment[] = [{ type: "set_stop", positionId: "P1", price: 98 }];
  const rejected = [{ adjustment: { type: "set_take_profit", positionId: "P1", price: 90 } as Adjustment, reason: "falsche Seite" }];
  const breach = ["⚡ AAPL: Kurs 111 riss Wake-Band oben (110)"];

  it("signal carries only closes and applied adjustments — no prose, no rejections", () => {
    const closeEvent: TickEvent = {
      kind: "position-closed",
      trade: {
        id: "P2", ticker: "TSLA", side: "long", stake: 100, leverage: 1,
        entryPrice: 200, exitPrice: 210, pnl: 5, reason: "manual",
        openedAt: "2026-06-10T14:00:00.000Z", closedAt: "2026-06-11T15:00:00.000Z",
      },
    };
    const msg = formatManagerSignal("15:35", applied, [closeEvent]);
    expect(msg).toContain("Mr Ape — Manager-Tick 15:35");
    expect(msg).toContain("🔧 Stop von P1 auf 98");
    expect(msg).toContain("TSLA");
    expect(msg).not.toContain("abgelehnt");
  });

  it('signal is "" when nothing actionable happened', () => {
    expect(formatManagerSignal("15:35", [], [])).toBe("");
  });

  it("story bundles journal, breach context and rejections — '' without content", () => {
    const msg = formatManagerStory("15:35", "Stop nachgezogen, Trend intakt.", rejected, breach);
    expect(msg).toContain("Begründung");
    expect(msg).toContain("Stop nachgezogen");
    expect(msg).toContain("✗ abgelehnt (falsche Seite)");
    expect(msg).toContain("riss Wake-Band oben");
    expect(formatManagerStory("15:35", "", [], [])).toBe("");
  });

  it("wake-hold always surfaces the breach, with reason or default note", () => {
    const held = formatWakeHold("15:35", "", breach);
    expect(held).toContain("riss Wake-Band oben");
    expect(held).toContain("hält die Position");
    const reasoned = formatWakeHold("15:35", "Halte — Trend intakt.", breach);
    expect(reasoned).toContain("Trend intakt");
    expect(reasoned).not.toContain("keine Begründung");
  });
});

describe("formatKuerSignal / formatKuerStory (Signal-Split)", () => {
  const order: EntryOrder = {
    id: "AMD-2026-07-02-1", ticker: "AMD", side: "long", stake: 380, leverage: 3,
    entryType: "limit", limitPrice: 472.5, stopLoss: 451, takeProfit: 515,
    expiresOn: "2026-07-03", thesis: "Pullback in intaktem Trend.",
    createdAt: "2026-07-02T13:15:59.736Z", day: "2026-07-02",
    deSymbol: "TRADEGATE:AMD", isin: "US0079031078", name: "Advanced Micro Devices, Inc.", currency: "EUR",
  };

  it("renders the terse 3-line signal with venue, ISIN, validity and %-equity", () => {
    const msg = formatKuerSignal([order], { day: "2026-07-02", marketLabel: "US-Markt", equity: 2000 });
    expect(msg).toContain("Kandidatenkür 2026-07-02 · US-Markt");
    expect(msg).toContain("🟢 LONG AMD — Limit €472.50");
    expect(msg).toContain("SL 451 · TP 515 · 3x · Einsatz €380.00 (19%)");
    expect(msg).toContain("Tradegate · US0079031078 · gültig bis 2026-07-03");
    expect(msg).not.toContain("Pullback"); // no thesis in the signal
  });

  it("keeps the no-trade day as a signal", () => {
    expect(formatKuerSignal([], { day: "2026-07-02" })).toContain("keine neuen Trades");
  });

  it("story carries thesis, journal and rejections — '' without content", () => {
    const msg = formatKuerStory([order], ["XYZ: kein Kurs"], "Ruhiger Markt.", { day: "2026-07-02" });
    expect(msg).toContain("Begründung");
    expect(msg).toContain("AMD: Pullback in intaktem Trend.");
    expect(msg).toContain("Ruhiger Markt.");
    expect(msg).toContain("✗ XYZ: kein Kurs");
    expect(formatKuerStory([], [], "", { day: "2026-07-02" })).toBe("");
  });
});

describe("formatDailySummary extras (Lebenszeichen spec)", () => {
  const empty: Portfolio = { balance: 800, positions: [], orders: [], history: [] };

  it("marks stale quotes and appends the health line when given", () => {
    const s = formatDailySummary(empty, {}, "2026-06-12", {
      staleQuotesFrom: "15:30",
      healthLine: "Monitor: 5 Ticks ok, 3 Quote-Fehler",
    });
    expect(s).toContain("(Kurse von 15:30)");
    expect(s.trimEnd().endsWith("Monitor: 5 Ticks ok, 3 Quote-Fehler")).toBe(true);
  });

  it("stays identical to the old output without opts", () => {
    const s = formatDailySummary(empty, {}, "2026-06-12");
    expect(s).not.toContain("Kurse von");
    expect(s).not.toContain("Monitor:");
  });
});
