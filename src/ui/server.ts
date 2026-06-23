// src/ui/server.ts — the read-only depot UI (ADR 0004): basic-auth guarded
// node:http server over DATA_DIR. No framework, no write path — the UI shows,
// the engine books, Mr Ape decides.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { equity } from "../paper/engine";
import { loadPortfolio } from "../paper/store";
import { readTickSeries } from "../paper/tickHistory";
import { listKuerDays, loadKuerArtifact } from "../paper/kuerArtifact";
import { dailyPerformance, equitySeries } from "./series";

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
  "/legend.js": { file: join(PUBLIC_DIR, "legend.js"), type: "text/javascript; charset=utf-8" },
  "/liveChart.js": { file: join(PUBLIC_DIR, "liveChart.js"), type: "text/javascript; charset=utf-8" },
  "/style.css": { file: join(PUBLIC_DIR, "style.css"), type: "text/css; charset=utf-8" },
  "/vendor/lightweight-charts.js": {
    // The package's "exports" hides dist/, so resolve the entry and go from there.
    file: join(dirname(require_.resolve("lightweight-charts")), "dist", "lightweight-charts.standalone.production.js"),
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
      if (path === "/api/daily") {
        const portfolio = loadPortfolio(opts.dir, opts.startBalance);
        sendJson(res, dailyPerformance(portfolio, opts.startBalance));
        return;
      }
      if (path === "/api/kuer/days") {
        sendJson(res, listKuerDays(opts.dir));
        return;
      }
      if (path === "/api/kuer") {
        const day = url.searchParams.get("day") ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          res.writeHead(400).end("bad day");
          return;
        }
        const artifact = loadKuerArtifact(opts.dir, day);
        if (!artifact) {
          res.writeHead(404).end("no kuer for that day");
          return;
        }
        sendJson(res, artifact);
        return;
      }

      res.writeHead(404).end("Not found");
    } catch (err) {
      console.error(`[ui] request failed: ${err instanceof Error ? err.message : String(err)}`);
      res.writeHead(500).end("Internal error");
    }
  });
}
