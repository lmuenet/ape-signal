import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createUiServer } from "./server";

const AUTH = { authorization: "Basic " + Buffer.from("ape:secret").toString("base64") };

let dir: string;
let server: Server;

function start(): Promise<string> {
  server = createUiServer({ dir, user: "ape", pass: "secret", startBalance: 2000 });
  return new Promise((res) => server.listen(0, () => res(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

function fixture(): void {
  dir = mkdtempSync(join(tmpdir(), "ape-ui-"));
  writeFileSync(
    join(dir, "portfolio.json"),
    JSON.stringify({
      balance: 800,
      positions: [{
        id: "P1", ticker: "AAPL", side: "long", stake: 200, leverage: 2,
        entryPrice: 100, units: 4, stopLoss: 90, takeProfit: 120,
        wakeAbove: 110, wakeBelow: 95, openedAt: "2026-06-11T14:00:00.000Z", thesis: "Test",
      }],
      orders: [], history: [],
      lastTick: { at: "2026-06-11T15:35:00.000Z", day: "2026-06-11", quotes: { AAPL: { close: 105, changePct: 1, high: 106, low: 99 } } },
    }),
  );
  writeFileSync(join(dir, "journal.md"), "# Mr Ape — Trading-Journal\n\n## 2026-06-11 17:35 — Test\n\nHallo.\n");
  mkdirSync(join(dir, "ticks"));
  writeFileSync(
    join(dir, "ticks", "2026-06-11.ndjson"),
    JSON.stringify({ at: "2026-06-11T15:35:00.000Z", quotes: { AAPL: { close: 105, changePct: 1, high: 106, low: 99 } } }) + "\n",
  );
  mkdirSync(join(dir, "kuer"));
  writeFileSync(
    join(dir, "kuer", "2026-06-11.json"),
    JSON.stringify({
      day: "2026-06-11",
      createdAt: "2026-06-11T13:25:00.000Z",
      scanSummary: "AAPL: signal",
      dossier: { candidates: [{ ticker: "AAPL", angle: "Momentum", catalyst: "Earnings", sentiment: "bullish" }], marketContext: "" },
      debate: { debates: [{ ticker: "AAPL", bull: "stark", bear: "teuer" }] },
      decisionJournal: "AAPL long.",
      orders: [],
      rejected: [],
      status: "decided",
    }),
  );
}

afterEach(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ui server", () => {
  it("rejects requests without credentials (401 + WWW-Authenticate)", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/api/state`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");
  });

  it("serves portfolio state with live equity", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/api/state`, { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.portfolio.balance).toBe(800);
    // equity = 800 free + 200 stake + 4 units * (105-100) = 1020
    expect(body.equity).toBe(1020);
    expect(body.startBalance).toBe(2000);
  });

  it("serves the journal as markdown text", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/api/journal`, { headers: AUTH });
    expect(await res.text()).toContain("Trading-Journal");
  });

  it("serves a tick series per ticker", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/api/ticks?ticker=aapl`, { headers: AUTH });
    const series = await res.json();
    expect(series).toEqual([{ at: "2026-06-11T15:35:00.000Z", close: 105, high: 106, low: 99 }]);
  });

  it("serves the equity series and the index page", async () => {
    fixture();
    const base = await start();
    expect((await fetch(`${base}/api/equity`, { headers: AUTH })).status).toBe(200);
    const index = await fetch(`${base}/`, { headers: AUTH });
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
  });

  it("serves the daily performance series as a JSON array", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/api/daily`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true); // empty here: the fixture has no closed history
  });

  it("serves the legend module as javascript", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/legend.js`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("buildLegend");
  });

  it("serves the live-chart module as javascript", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/liveChart.js`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("tvWidgetConfig");
  });

  it("serves the time module as javascript (app.js imports it)", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/time.js`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("berlinChartTime");
  });

  it("404s unknown paths and blocks path traversal", async () => {
    fixture();
    const base = await start();
    expect((await fetch(`${base}/api/nope`, { headers: AUTH })).status).toBe(404);
    expect((await fetch(`${base}/..%2f..%2fetc%2fpasswd`, { headers: AUTH })).status).toBe(404);
  });
});

describe("kuer routes (Kür-Ansicht spec)", () => {
  it("lists kuer days newest first", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/api/kuer/days`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["2026-06-11"]);
  });

  it("serves the artifact for a day", async () => {
    fixture();
    const base = await start();
    const res = await fetch(`${base}/api/kuer?day=2026-06-11`, { headers: AUTH });
    expect(res.status).toBe(200);
    const a = await res.json();
    expect(a.decisionJournal).toBe("AAPL long.");
    expect(a.dossier.candidates[0].ticker).toBe("AAPL");
  });

  it("400s a malformed day and 404s a missing one", async () => {
    fixture();
    const base = await start();
    expect((await fetch(`${base}/api/kuer?day=..%2Fjournal`, { headers: AUTH })).status).toBe(400);
    expect((await fetch(`${base}/api/kuer?day=2026-01-01`, { headers: AUTH })).status).toBe(404);
  });
});
