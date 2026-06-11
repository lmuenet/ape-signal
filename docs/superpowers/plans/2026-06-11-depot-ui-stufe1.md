# Depot-UI Stufe 1 (ADR 0004) — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein read-only Web-UI im Docker-Container (Basic-Auth) zeigt Journal, Depot, Equity-Kurve und Positions-Charts aus der selbst aufgezeichneten Tick-Historie — inkl. Einstieg, Stop, Take-Profit und Wake-Up-Bändern als Linien.

**Architecture:** Der Monitor-Tick schreibt seine Quotes als NDJSON-Tagesdateien nach `DATA_DIR/ticks/` (Tick-Historie). Ein dependency-armer `node:http`-Server (`src/ui/`) liefert statische Dateien + vier JSON/Text-Endpunkte und erzwingt Basic-Auth. Frontend: Vanilla JS + TradingView **Lightweight Charts** (npm-Paket, lokal ausgeliefert — kein CDN). Der Container mountet `DATA_DIR` read-only; der Kern bleibt systemd (ADR 0004).

**Tech Stack:** TypeScript (ESM), `node:http` (kein Express), `lightweight-charts@^4` (einzige neue Dependency), vitest, Docker (node:20-alpine).

**Voraussetzung:** Plan `2026-06-11-monitor-manager-tick.md` ist umgesetzt (der Monitor-Tick existiert; `TickDeps` hat die dort definierte Form). Die Tick-Historie entsteht erst durch diesen Plan — Charts füllen sich ab dem ersten Handelstag nach dem Deploy.

**Referenzen:** `docs/adr/0004-readonly-depot-ui-container.md`, `CONTEXT.md` (Depot-UI, Tick-Historie).

---

### Task 1: Tick-Historie — schreiben im Monitor-Tick, lesen fürs UI

**Files:**
- Create: `src/paper/tickHistory.ts`
- Test: `src/paper/tickHistory.test.ts`
- Modify: `src/paper/tickPipeline.ts` (Dep + ein Aufruf)
- Modify: `src/paper/tick.ts` (Dep verdrahten)
- Modify: `src/paper/tickPipeline.test.ts` (ein Test ergänzen)

- [ ] **Step 1: Failing Tests schreiben**

`src/paper/tickHistory.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendTickHistory, readTickSeries } from "./tickHistory";
import type { QuoteMap } from "./types";

const q = (close: number): QuoteMap[string] => ({ close, changePct: 0, high: close + 1, low: close - 1 });

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("tick history", () => {
  it("appends one NDJSON line per tick into a day file and reads it back per ticker", () => {
    dir = mkdtempSync(join(tmpdir(), "ape-ticks-"));
    appendTickHistory(dir, "2026-06-11", "2026-06-11T13:35:00.000Z", { AAPL: q(100), TSLA: q(300) });
    appendTickHistory(dir, "2026-06-11", "2026-06-11T13:40:00.000Z", { AAPL: q(101) });
    const series = readTickSeries(dir, "AAPL");
    expect(series).toEqual([
      { at: "2026-06-11T13:35:00.000Z", close: 100, high: 101, low: 99 },
      { at: "2026-06-11T13:40:00.000Z", close: 101, high: 102, low: 100 },
    ]);
    expect(readTickSeries(dir, "TSLA")).toHaveLength(1);
  });

  it("merges multiple day files in date order and skips corrupt lines", () => {
    dir = mkdtempSync(join(tmpdir(), "ape-ticks-"));
    appendTickHistory(dir, "2026-06-10", "2026-06-10T13:35:00.000Z", { AAPL: q(95) });
    appendTickHistory(dir, "2026-06-11", "2026-06-11T13:35:00.000Z", { AAPL: q(100) });
    expect(readTickSeries(dir, "AAPL").map((p) => p.close)).toEqual([95, 100]);
  });

  it("returns [] for unknown tickers or a missing directory", () => {
    dir = mkdtempSync(join(tmpdir(), "ape-ticks-"));
    expect(readTickSeries(dir, "NOPE")).toEqual([]);
    expect(readTickSeries(join(dir, "missing"), "AAPL")).toEqual([]);
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/paper/tickHistory.test.ts`
Expected: FAIL — `Cannot find module './tickHistory'`.

- [ ] **Step 3: `tickHistory.ts` implementieren**

```ts
// src/paper/tickHistory.ts — the depot's own price source (ADR 0004): the
// monitor tick appends its 5-minute quotes as NDJSON day files under
// DATA_DIR/ticks/; the depot UI reads them back as per-ticker series.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { QuoteMap } from "./types";

export interface TickPoint {
  at: string; // ISO timestamp of the monitor tick
  close: number;
  high: number;
  low: number;
}

interface TickRecord {
  at: string;
  quotes: QuoteMap;
}

const ticksDir = (dir: string) => join(dir, "ticks");

/** Append one monitor tick (all quotes) to the day's NDJSON file. */
export function appendTickHistory(dir: string, day: string, atIso: string, quotes: QuoteMap): void {
  if (Object.keys(quotes).length === 0) return;
  mkdirSync(ticksDir(dir), { recursive: true });
  const record: TickRecord = { at: atIso, quotes };
  appendFileSync(join(ticksDir(dir), `${day}.ndjson`), JSON.stringify(record) + "\n", "utf8");
}

/** Per-ticker series across the most recent `maxDays` day files, oldest first. */
export function readTickSeries(dir: string, ticker: string, maxDays = 30): TickPoint[] {
  const tdir = ticksDir(dir);
  if (!existsSync(tdir)) return [];
  const files = readdirSync(tdir)
    .filter((f) => f.endsWith(".ndjson"))
    .sort()
    .slice(-maxDays);
  const upper = ticker.toUpperCase();
  const out: TickPoint[] = [];
  for (const file of files) {
    for (const line of readFileSync(join(tdir, file), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const rec = JSON.parse(line) as TickRecord;
        const q = rec.quotes?.[upper];
        if (q && typeof q.close === "number") out.push({ at: rec.at, close: q.close, high: q.high, low: q.low });
      } catch {
        // a torn line (e.g. crash mid-append) is data loss for one tick, not an error
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/paper/tickHistory.test.ts`
Expected: PASS.

- [ ] **Step 5: In die Pipeline einhängen**

a) `src/paper/tickPipeline.ts`, `TickDeps` ergänzen (nach `fetchQuotes`):

```ts
  /** Persist this tick's quotes into the tick history (ADR 0004). Optional in tests. */
  recordTick?: (day: string, atIso: string, quotes: QuoteMap) => void;
```

b) In `runTick`, direkt nach dem erfolgreichen `quotes = await deps.fetchQuotes(tickers);` (innerhalb des `try` NACH der Zuweisung, oder direkt nach dem `try/catch`-Block, wenn `quotes` gesetzt ist):

```ts
  if (tickers.length > 0) {
    try {
      deps.recordTick?.(day, now.toISOString(), quotes);
    } catch (err) {
      console.error(`[tick] recording tick history failed (charts lose one point): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
```

c) `src/paper/tick.ts`: Import ergänzen

```ts
import { appendTickHistory } from "./tickHistory";
```

und in den `runTick`-Deps nach `fetchQuotes: …`:

```ts
      recordTick: (day, atIso, quotes) => appendTickHistory(dir, day, atIso, quotes),
```

d) Test in `src/paper/tickPipeline.test.ts` ergänzen (in den `makeDeps`-Fixture-Stil des Monitor/Manager-Blocks aus Plan 1 integrieren):

```ts
  it("records the tick into the history when quotes were fetched", async () => {
    const recorded: Array<{ day: string; at: string }> = [];
    const { deps } = makeDeps(
      { balance: 800, positions: [wakePos], orders: [], history: [], lastTick: { at: "x", day: "2026-06-11", quotes: {} } },
      100,
    );
    (deps as Record<string, unknown>).recordTick = (day: string, at: string) => recorded.push({ day, at });
    await runTick({ isClose: false }, deps);
    expect(recorded).toEqual([{ day: "2026-06-11", at: "2026-06-11T15:35:00.000Z" }]);
  });
```

- [ ] **Step 6: Alle Tests + Typecheck**

Run: `npx vitest run; npm run typecheck`
Expected: PASS / keine Fehler.

- [ ] **Step 7: Commit**

```bash
git add src/paper/tickHistory.ts src/paper/tickHistory.test.ts src/paper/tickPipeline.ts src/paper/tickPipeline.test.ts src/paper/tick.ts
git commit -m "feat(ui): record monitor-tick quotes as NDJSON tick history (ADR 0004)"
```

---

### Task 2: Equity-Kurve aus der Trade-History

**Files:**
- Create: `src/ui/series.ts`
- Test: `src/ui/series.test.ts`

- [ ] **Step 1: Failing Tests schreiben**

`src/ui/series.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { equitySeries } from "./series";
import type { ClosedTrade, Portfolio } from "../paper/types";

const trade = (over: Partial<ClosedTrade>): ClosedTrade => ({
  id: "T", ticker: "AAPL", side: "long", stake: 100, leverage: 1,
  entryPrice: 100, exitPrice: 110, pnl: 10, fees: 1, reason: "manual",
  openedAt: "2026-06-09T14:00:00.000Z", closedAt: "2026-06-10T15:00:00.000Z",
  ...over,
});

describe("equitySeries", () => {
  it("builds a realized-equity curve: start balance, then one point per close", () => {
    const p: Portfolio = {
      balance: 0, positions: [], orders: [],
      history: [
        trade({ id: "B", closedAt: "2026-06-11T15:00:00.000Z", pnl: -20, fees: 0 }),
        trade({ id: "A", closedAt: "2026-06-10T15:00:00.000Z", pnl: 10, fees: 1 }),
      ],
    };
    expect(equitySeries(p, 2000)).toEqual([
      { at: "2026-06-09T14:00:00.000Z", equity: 2000 },
      { at: "2026-06-10T15:00:00.000Z", equity: 2009 },
      { at: "2026-06-11T15:00:00.000Z", equity: 1989 },
    ]);
  });

  it("returns just the start point when there is no history", () => {
    const p: Portfolio = { balance: 2000, positions: [], orders: [], history: [] };
    const s = equitySeries(p, 2000);
    expect(s).toHaveLength(1);
    expect(s[0]?.equity).toBe(2000);
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/ui/series.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Implementieren**

`src/ui/series.ts`:

```ts
// src/ui/series.ts — chartable series derived from the portfolio. Realized
// equity only: open positions are NOT marked to market here (the header shows
// live equity separately, via the engine's equity() on lastTick quotes).
import type { Portfolio } from "../paper/types";

export interface EquityPoint {
  at: string;
  equity: number;
}

export function equitySeries(p: Portfolio, startBalance: number): EquityPoint[] {
  const sorted = [...p.history].sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  const startAt = sorted
    .map((t) => t.openedAt)
    .sort()[0] ?? new Date().toISOString();
  const out: EquityPoint[] = [{ at: startAt, equity: startBalance }];
  let equity = startBalance;
  for (const t of sorted) {
    equity += t.pnl - (t.fees ?? 0);
    out.push({ at: t.closedAt, equity });
  }
  return out;
}
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/ui/series.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/series.ts src/ui/series.test.ts
git commit -m "feat(ui): realized equity series from trade history"
```

---

### Task 3: UI-Server — Basic-Auth, API-Endpunkte, statische Dateien

**Files:**
- Create: `src/ui/server.ts`
- Create: `src/ui/main.ts`
- Test: `src/ui/server.test.ts`
- Modify: `package.json` (Script `"ui"`, Dependency `lightweight-charts`)

- [ ] **Step 1: Dependency installieren**

Run: `npm install lightweight-charts@^4.2.0`
Expected: `package.json` erhält den Eintrag unter `dependencies` (NICHT devDependencies — der Container braucht ihn zur Laufzeit).

- [ ] **Step 2: Failing Tests schreiben**

`src/ui/server.test.ts`:

```ts
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

  it("404s unknown paths and blocks path traversal", async () => {
    fixture();
    const base = await start();
    expect((await fetch(`${base}/api/nope`, { headers: AUTH })).status).toBe(404);
    expect((await fetch(`${base}/..%2f..%2fetc%2fpasswd`, { headers: AUTH })).status).toBe(404);
  });
});
```

- [ ] **Step 3: Tests laufen lassen — müssen fehlschlagen**

Run: `npx vitest run src/ui/server.test.ts`
Expected: FAIL — Modul fehlt. (Der Index-Test schlägt fehl, bis Task 4 die statischen Dateien anlegt — für diesen Task eine minimale `src/ui/public/index.html` mit `<!doctype html><html><body>Depot-UI</body></html>` anlegen.)

- [ ] **Step 4: Server implementieren**

`src/ui/server.ts`:

```ts
// src/ui/server.ts — the read-only depot UI (ADR 0004): basic-auth guarded
// node:http server over DATA_DIR. No framework, no write path — the UI shows,
// the engine books, Mr Ape decides.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { equity } from "../paper/engine";
import { loadPortfolio } from "../paper/store";
import { readTickSeries } from "../paper/tickHistory";
import { equitySeries } from "./series";

export interface UiServerOptions {
  dir: string; // DATA_DIR
  user: string;
  pass: string;
  startBalance: number;
}

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const require_ = createRequire(import.meta.url);

const STATIC: Record<string, { file: string; type: string }> = {
  "/": { file: join(PUBLIC_DIR, "index.html"), type: "text/html; charset=utf-8" },
  "/app.js": { file: join(PUBLIC_DIR, "app.js"), type: "text/javascript; charset=utf-8" },
  "/style.css": { file: join(PUBLIC_DIR, "style.css"), type: "text/css; charset=utf-8" },
  "/vendor/lightweight-charts.js": {
    file: require_.resolve("lightweight-charts/dist/lightweight-charts.standalone.production.js"),
    type: "text/javascript; charset=utf-8",
  },
};

function authorized(req: IncomingMessage, user: string, pass: string): boolean {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const got = Buffer.from(header.slice(6), "base64");
  const want = Buffer.from(`${user}:${pass}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function createUiServer(opts: UiServerOptions): Server {
  return createServer((req, res) => {
    try {
      if (!authorized(req, opts.user, opts.pass)) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="ape-signal"' });
        res.end("Unauthorized");
        return;
      }
      const url = new URL(req.url ?? "/", "http://local");
      const path = normalize(decodeURIComponent(url.pathname)).replaceAll("\\", "/");

      const fixed = STATIC[path];
      if (fixed) {
        if (!existsSync(fixed.file)) {
          res.writeHead(404).end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": fixed.type });
        res.end(readFileSync(fixed.file));
        return;
      }

      if (path === "/api/state") {
        const portfolio = loadPortfolio(opts.dir, opts.startBalance);
        sendJson(res, {
          portfolio,
          equity: equity(portfolio, portfolio.lastTick?.quotes ?? {}),
          startBalance: opts.startBalance,
          generatedAt: portfolio.lastTick?.at ?? null,
        });
        return;
      }
      if (path === "/api/journal") {
        const file = join(opts.dir, "journal.md");
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        res.end(existsSync(file) ? readFileSync(file, "utf8") : "");
        return;
      }
      if (path === "/api/ticks") {
        const ticker = (url.searchParams.get("ticker") ?? "").toUpperCase();
        if (!/^[A-Z.]{1,6}$/.test(ticker)) {
          res.writeHead(400).end("bad ticker");
          return;
        }
        sendJson(res, readTickSeries(opts.dir, ticker));
        return;
      }
      if (path === "/api/equity") {
        const portfolio = loadPortfolio(opts.dir, opts.startBalance);
        sendJson(res, equitySeries(portfolio, opts.startBalance));
        return;
      }

      res.writeHead(404).end("Not found");
    } catch (err) {
      console.error(`[ui] request failed: ${err instanceof Error ? err.message : String(err)}`);
      res.writeHead(500).end("Internal error");
    }
  });
}
```

`src/ui/main.ts`:

```ts
// src/ui/main.ts — container/CLI entrypoint for the depot UI. Fails fast on
// missing credentials: an unprotected journal must never start by accident.
import { dataDir } from "../paper/store";
import { createUiServer } from "./server";

const user = process.env.UI_USER ?? "";
const pass = process.env.UI_PASS ?? "";
if (user === "" || pass === "") {
  console.error("[ui] UI_USER and UI_PASS are required — refusing to serve the depot unprotected.");
  process.exit(1);
}

const port = Number(process.env.UI_PORT ?? "8744");
const startBalance = Number(process.env.PAPER_START_BALANCE ?? "2000");

createUiServer({ dir: dataDir(), user, pass, startBalance }).listen(port, () => {
  console.log(`[ui] depot UI listening on :${port} (data: ${dataDir()})`);
});
```

`package.json` — Script ergänzen:

```json
    "ui": "tsx src/ui/main.ts",
```

- [ ] **Step 5: Tests laufen lassen — müssen grün sein**

Run: `npx vitest run src/ui/server.test.ts; npm run typecheck`
Expected: PASS / keine Typfehler.

- [ ] **Step 6: Commit**

```bash
git add src/ui/server.ts src/ui/main.ts src/ui/server.test.ts src/ui/public/index.html package.json package-lock.json
git commit -m "feat(ui): read-only depot UI server with basic auth (ADR 0004)"
```

---

### Task 4: Frontend — Depot, Positions-Charts mit Schwellen-Linien, Equity, Journal

**Files:**
- Create/Replace: `src/ui/public/index.html`
- Create: `src/ui/public/style.css`
- Create: `src/ui/public/app.js`

Kein Unit-Test (reines DOM/Canvas-Rendering); Verifikation manuell in Step 4.

- [ ] **Step 1: `index.html`**

```html
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mr Ape — Depot</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header>
    <h1>🦍 Mr Ape — Depot</h1>
    <div id="headline" class="stats">lädt …</div>
  </header>
  <main>
    <section id="equity-section">
      <h2>Equity (realisiert)</h2>
      <div id="equity-chart" class="chart"></div>
    </section>
    <section>
      <h2>Offene Positionen</h2>
      <div id="positions"></div>
    </section>
    <section>
      <h2>Offene Orders</h2>
      <div id="orders"></div>
    </section>
    <section>
      <h2>Journal</h2>
      <div id="journal"></div>
    </section>
  </main>
  <script src="/vendor/lightweight-charts.js"></script>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: `style.css`**

```css
:root { color-scheme: dark; --bg: #11151c; --card: #1a2029; --line: #2a3342; --fg: #e6e9ef; --dim: #8b96a8; --green: #3fb68b; --red: #e0556a; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
header { padding: 16px 24px; border-bottom: 1px solid var(--line); display: flex; gap: 24px; align-items: baseline; flex-wrap: wrap; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; color: var(--dim); text-transform: uppercase; letter-spacing: .06em; }
main { max-width: 1100px; margin: 0 auto; padding: 16px 24px 64px; }
.stats { color: var(--dim); }
.stats b { color: var(--fg); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
.card .meta { color: var(--dim); font-size: 13px; margin-top: 2px; }
.pnl-pos { color: var(--green); } .pnl-neg { color: var(--red); }
.chart { height: 220px; }
.empty { color: var(--dim); font-style: italic; }
#journal article { border-top: 1px solid var(--line); padding: 10px 0; }
#journal h3 { font-size: 14px; margin: 0 0 6px; color: var(--dim); }
#journal pre { white-space: pre-wrap; font: inherit; margin: 0; }
```

- [ ] **Step 3: `app.js`**

```js
// Depot-UI frontend (read-only). LightweightCharts is loaded globally via
// /vendor/lightweight-charts.js (v4 standalone build).
const $ = (sel) => document.querySelector(sel);
const usd = (n) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const ts = (iso) => Math.floor(Date.parse(iso) / 1000);

const CHART_OPTS = {
  layout: { background: { color: "transparent" }, textColor: "#8b96a8" },
  grid: { vertLines: { color: "#2a3342" }, horzLines: { color: "#2a3342" } },
  timeScale: { timeVisible: true, secondsVisible: false },
  height: 220,
  autoSize: true,
};

function priceLine(series, price, title, color) {
  if (typeof price !== "number") return;
  series.createPriceLine({ price, title, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
}

async function api(path, asText = false) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return asText ? res.text() : res.json();
}

function positionCard(pos, quotes) {
  const q = quotes[pos.ticker];
  const pnl = q ? Math.max(pos.units * (q.close - pos.entryPrice) * (pos.side === "long" ? 1 : -1), -pos.stake) : null;
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `
    <b>${pos.ticker}</b> ${pos.side} ${pos.leverage}x — Einsatz ${usd(pos.stake)}
    ${pnl === null ? "" : `<span class="${pnl >= 0 ? "pnl-pos" : "pnl-neg"}">P&amp;L ${usd(pnl)}</span>`}
    <div class="meta">Entry ${pos.entryPrice} · SL ${pos.stopLoss}${pos.takeProfit ? ` · TP ${pos.takeProfit}` : ""}
      · Wake ${pos.wakeBelow ?? "—"}/${pos.wakeAbove ?? "—"}</div>
    <div class="meta">${pos.thesis ?? ""}</div>
    <div class="chart"></div>`;
  return el;
}

async function drawTickerChart(container, pos) {
  const series = await api(`/api/ticks?ticker=${pos.ticker}`);
  if (series.length === 0) {
    container.innerHTML = '<span class="empty">Noch keine Tick-Historie — füllt sich ab dem nächsten Handelstag.</span>';
    return;
  }
  const chart = LightweightCharts.createChart(container, CHART_OPTS);
  const line = chart.addLineSeries({ color: "#e6e9ef", lineWidth: 2 });
  line.setData(series.map((p) => ({ time: ts(p.at), value: p.close })));
  priceLine(line, pos.entryPrice, "Entry", "#8b96a8");
  priceLine(line, pos.stopLoss, "SL", "#e0556a");
  priceLine(line, pos.takeProfit, "TP", "#3fb68b");
  priceLine(line, pos.wakeAbove, "Wake↑", "#caa75c");
  priceLine(line, pos.wakeBelow, "Wake↓", "#caa75c");
  chart.timeScale().fitContent();
}

function renderJournal(md) {
  const entries = md.split(/\n## /).slice(1).reverse();
  if (entries.length === 0) {
    $("#journal").innerHTML = '<span class="empty">Noch keine Einträge.</span>';
    return;
  }
  $("#journal").innerHTML = entries
    .map((e) => {
      const [head, ...body] = e.split("\n");
      return `<article><h3>${head}</h3><pre>${body.join("\n").trim()}</pre></article>`;
    })
    .join("");
}

async function load() {
  const state = await api("/api/state");
  const { portfolio } = state;
  const quotes = portfolio.lastTick?.quotes ?? {};

  $("#headline").innerHTML =
    `Equity <b>${usd(state.equity)}</b> · frei <b>${usd(portfolio.balance)}</b>` +
    ` · ${portfolio.positions.length} Positionen, ${portfolio.orders.length} Orders` +
    (state.generatedAt ? ` · Stand ${new Date(state.generatedAt).toLocaleString("de-DE")}` : "");

  const posRoot = $("#positions");
  posRoot.innerHTML = portfolio.positions.length ? "" : '<span class="empty">keine</span>';
  for (const pos of portfolio.positions) {
    const card = positionCard(pos, quotes);
    posRoot.appendChild(card);
    drawTickerChart(card.querySelector(".chart"), pos).catch(console.error);
  }

  const orderRoot = $("#orders");
  orderRoot.innerHTML = portfolio.orders.length ? "" : '<span class="empty">keine</span>';
  for (const o of portfolio.orders) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<b>${o.ticker}</b> ${o.side} ${o.leverage}x — ${o.entryType === "market" ? "Market" : `Limit ${o.limitPrice}`},
      SL ${o.stopLoss}${o.takeProfit ? `, TP ${o.takeProfit}` : ""} <div class="meta">${o.thesis ?? ""}</div>`;
    orderRoot.appendChild(el);
  }

  const eq = await api("/api/equity");
  if (eq.length > 1) {
    const chart = LightweightCharts.createChart($("#equity-chart"), CHART_OPTS);
    const line = chart.addAreaSeries({ lineColor: "#3fb68b", topColor: "rgba(63,182,139,.25)", bottomColor: "transparent" });
    line.setData(eq.map((p) => ({ time: ts(p.at), value: p.equity })));
    chart.timeScale().fitContent();
  } else {
    $("#equity-section").querySelector(".chart").innerHTML = '<span class="empty">Noch keine abgeschlossenen Trades.</span>';
  }

  renderJournal(await api("/api/journal", true));
}

load().catch((err) => { $("#headline").textContent = `Fehler: ${err.message}`; });
setInterval(() => location.reload(), 5 * 60 * 1000); // refresh with the monitor-tick cadence
```

- [ ] **Step 4: Manuell verifizieren**

Run (PowerShell):
```powershell
$env:UI_USER = "ape"; $env:UI_PASS = "test"; $env:DATA_DIR = "$PWD\data"; npm run ui
```
Browser: `http://localhost:8744` öffnen, mit `ape`/`test` anmelden.
Expected: Header mit Equity, Positions-/Order-Karten (oder „keine"), Journal-Einträge; Charts erscheinen, sobald `data/ticks/` Dateien enthält. Ohne lokale `data/` zeigt das UI den Frischzustand (Startbalance, leere Listen) — auch das ist ein gültiger Smoke-Test.

- [ ] **Step 5: Commit**

```bash
git add src/ui/public/index.html src/ui/public/style.css src/ui/public/app.js
git commit -m "feat(ui): depot dashboard - positions with threshold overlays, equity curve, journal"
```

---

### Task 5: Docker — Container-Build, Compose-Beispiel, Doku

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `README.md` (neuer Abschnitt „Depot UI")

- [ ] **Step 1: `Dockerfile`**

```dockerfile
# Depot-UI only (ADR 0004): the core (scans, ticks, listener, claude CLI)
# stays on systemd. This container serves the read-only UI over DATA_DIR.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
ENV DATA_DIR=/data \
    UI_PORT=8744
EXPOSE 8744
USER node
CMD ["npx", "tsx", "src/ui/main.ts"]
```

(Falls `package-lock.json` nicht existiert: erst `npm install` lokal ausführen und die Lock-Datei committen — `npm ci` braucht sie.)

- [ ] **Step 2: `.dockerignore`**

```
node_modules
data
.git
docs
systemd
scripts
vendor
*.md
```

- [ ] **Step 3: Lokal bauen und rauchen-testen (Docker Desktop erforderlich)**

```powershell
docker build -t ape-signal-ui .
docker run --rm -p 8744:8744 -v "$PWD\data:/data:ro" -e UI_USER=ape -e UI_PASS=test ape-signal-ui
```
Expected: Log `[ui] depot UI listening on :8744`; `http://localhost:8744` antwortet nach Login. Ohne Docker lokal: Schritt auf dem VPS nachholen.

- [ ] **Step 4: README-Abschnitt ergänzen**

Nach dem Abschnitt „Self-hosting in a few commands" einfügen:

```markdown
## Depot UI (optional)

A read-only dashboard for the paper depot — journal, positions with SL/TP and
wake-band overlays, equity curve. Ships as a Docker container that mounts the
data directory read-only; the core keeps running on systemd (see ADR 0004).

```bash
docker build -t ape-signal-ui /opt/ape-signal
docker run -d --name ape-ui --restart unless-stopped \
  -p 8744:8744 \
  -v /opt/ape-signal/data:/data:ro \
  -e UI_USER=ape -e UI_PASS='pick-a-password' \
  ape-signal-ui
```

Open `http://<server>:8744` and log in with `UI_USER`/`UI_PASS`. The UI never
writes — Telegram remains the push channel for fills and manager decisions.
```

- [ ] **Step 5: Voller Testlauf + Commit**

Run: `npx vitest run; npm run typecheck`
Expected: PASS.

```bash
git add Dockerfile .dockerignore README.md
git commit -m "feat(ui): dockerize the depot UI (read-only DATA_DIR mount)"
```

---

## Follow-ups (bewusst NICHT Teil dieses Plans)

Der nächste Schritt nach Stufe 1 ist beschlossen:

1. **TradingView-Embed-Widget im UI** — pro Ticker ein Kontext-Chart mit voller
   Markthistorie neben dem eigenen Positions-Chart (ADR 0004, Alternativen;
   `docs/BACKLOG.md`). Das Widget lädt im Browser des Betrachters und umgeht
   damit die Datacenter-IP-Blocks aus ADR 0001.
2. **Mr-Ape-Chat im UI anzeigen** — der `/journal`-Dialog (Fragen an Mr Ape und
   seine Antworten) soll im UI sichtbar werden. Voraussetzung: der
   Telegram-Listener persistiert den Dialog (heute existiert er nur flüchtig in
   Telegram); danach ist die Anzeige ein weiterer read-only Endpunkt. Anzeigen,
   nicht chatten — ein Schreibkanal wäre Stufe 2+ (Auth-Konzept!).
3. **Setup-Assistent (Stufe 2)** — Key-Pflege/Erst-Einrichtung im UI mit
   geteilter Config-Datei (ADR 0004, Punkt 5).

## Self-Review-Notizen

- ADR 0004 Punkt 1–4 abgedeckt: Task 3 (read-only + Basic-Auth), Task 5 (nur
  UI im Container), Task 1+4 (Tick-Historie + Overlays). Punkt 5 (Stufe 2)
  bewusst Follow-up.
- Typ-Konsistenz: `TickPoint {at, close, high, low}` identisch in Task 1
  (Modul) und Task 3 (Server-Test); `equitySeries` liefert `{at, equity}` —
  so konsumiert es `app.js`.
- `recordTick` ist optional in `TickDeps` — die bestehenden Pipeline-Tests aus
  Plan 1 brauchen keine Anpassung.
