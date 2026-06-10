import { describe, expect, it } from "vitest";
import { extractJson, parseAdminAction, parseDebate, parseDecision, parseDossier, parseTickResponse } from "./decision";

describe("extractJson", () => {
  it("extracts a balanced object despite surrounding prose and nested braces", () => {
    const raw = 'Hier mein Ergebnis:\n{"a": {"b": "x } y"}, "c": 1}\nViel Erfolg!';
    expect(extractJson(raw)).toEqual({ a: { b: "x } y" }, c: 1 });
  });

  it("returns null for no/broken JSON", () => {
    expect(extractJson("kein json")).toBeNull();
    expect(extractJson("{broken: }")).toBeNull();
  });
});

describe("parseDebate", () => {
  it("parses bull/bear entries despite surrounding prose and uppercases tickers", () => {
    const raw = 'Meine Debatte:\n{"debates":[{"ticker":"nvda","bull":"Momentum nach Earnings","bear":"überkauft, Gap-Risiko"}]}\nFertig.';
    expect(parseDebate(raw)).toEqual({
      debates: [{ ticker: "NVDA", bull: "Momentum nach Earnings", bear: "überkauft, Gap-Risiko" }],
    });
  });

  it("returns null for missing or non-array debates", () => {
    expect(parseDebate("kein json")).toBeNull();
    expect(parseDebate('{"debates": "nope"}')).toBeNull();
  });

  it("drops entries without a valid ticker, keeps partial bull/bear as empty strings", () => {
    const raw = JSON.stringify({
      debates: [
        { ticker: "", bull: "a", bear: "b" },
        { ticker: "TSLA", bull: "nur Bull-Case" },
        { ticker: "not a ticker!", bull: "x", bear: "y" },
      ],
    });
    expect(parseDebate(raw)).toEqual({ debates: [{ ticker: "TSLA", bull: "nur Bull-Case", bear: "" }] });
  });
});

describe("parseDossier", () => {
  it("keeps valid candidates, uppercases tickers, drops junk", () => {
    const d = parseDossier(
      JSON.stringify({
        candidates: [
          { ticker: "nvda", angle: "a", catalyst: "b", sentiment: "c" },
          { ticker: "TOOLONG123", angle: "x" },
          { angle: "ohne ticker" },
        ],
        marketContext: "ruhig",
      }),
    );
    expect(d?.candidates).toEqual([{ ticker: "NVDA", angle: "a", catalyst: "b", sentiment: "c" }]);
    expect(d?.marketContext).toBe("ruhig");
  });

  it("returns null without a candidates array", () => {
    expect(parseDossier('{"marketContext": "x"}')).toBeNull();
  });
});

describe("parseDecision", () => {
  it("parses trades with market and limit entries", () => {
    const d = parseDecision(
      JSON.stringify({
        trades: [
          { ticker: "nvda", side: "long", stake: 200, leverage: 2, entry: "market", stopLoss: 95, thesis: "t" },
          { ticker: "TSLA", side: "short", stake: 100, entry: 250.5, stopLoss: 260, takeProfit: 220 },
        ],
        journal: "Eintrag",
      }),
    );
    expect(d?.trades).toHaveLength(2);
    expect(d?.trades[0]).toMatchObject({ ticker: "NVDA", entry: "market", leverage: 2 });
    expect(d?.trades[1]).toMatchObject({ entry: 250.5, leverage: 1, takeProfit: 220 });
    expect(d?.journal).toBe("Eintrag");
  });

  it("drops structurally broken trades but keeps the rest", () => {
    const d = parseDecision(
      JSON.stringify({
        trades: [
          { ticker: "NVDA", side: "long", stake: 200, entry: "market", stopLoss: 95 },
          { ticker: "X", side: "sideways", stake: 1, entry: "market", stopLoss: 1 },
          { ticker: "Y", side: "long", entry: "market", stopLoss: 1 },
        ],
        journal: "",
      }),
    );
    expect(d?.trades).toHaveLength(1);
  });

  it("an empty trades array is a valid no-trade decision", () => {
    expect(parseDecision('{"trades": [], "journal": "heute nichts"}')?.trades).toEqual([]);
  });
});

describe("parseTickResponse", () => {
  it("parses all four adjustment types and drops invalid ones", () => {
    const r = parseTickResponse(
      JSON.stringify({
        adjustments: [
          { type: "set_stop", positionId: "p1", price: 100 },
          { type: "set_take_profit", positionId: "p1", price: null },
          { type: "close_position", positionId: "p2" },
          { type: "cancel_order", orderId: "o1" },
          { type: "set_stop", positionId: "p3" }, // no price
          { type: "explode" },
        ],
        journal: null,
      }),
    );
    expect(r?.adjustments).toHaveLength(4);
    expect(r?.journal).toBe("");
  });
});

describe("parseAdminAction", () => {
  it("parses balance actions and notes", () => {
    expect(parseAdminAction('{"action":"set_balance","amount":500,"note":"n"}')).toEqual({
      action: { action: "set_balance", amount: 500 },
      note: "n",
    });
    expect(parseAdminAction('{"action":"note","amount":null,"note":"nur notiz"}')).toEqual({
      action: { action: "note" },
      note: "nur notiz",
    });
  });

  it("rejects negative or missing amounts for balance actions", () => {
    expect(parseAdminAction('{"action":"deposit","amount":-5}')).toBeNull();
    expect(parseAdminAction('{"action":"withdraw"}')).toBeNull();
  });
});
