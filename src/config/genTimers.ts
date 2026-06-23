// src/config/genTimers.ts — erzeugt die session-getriebenen systemd-Timer aus
// den aktiven Märkten (A2). Reiner Kern (buildTimerFiles) + ein dünner main, der
// nach --out=<dir> (Default /etc/systemd/system) schreibt. Pro aktivem Markt ein
// Pre-Session-Kür-Timer; der Tick feuert jede Minute über das Vereinigungs-
// fenster (effektives Intervall drosselt zur Laufzeit), Close am spätesten Close.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { activeMarkets, type Market } from "./session";

const pad = (n: number): string => String(n).padStart(2, "0");

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** OnCalendar lines for the per-minute tick raster, one line per hour. */
function tickOnCalendar(open: string, close: string): string {
  const openT = toMinutes(open);
  const closeT = toMinutes(close);
  const byHour = new Map<number, number[]>();
  for (let t = openT; t < closeT; t++) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(m);
  }
  return [...byHour.entries()]
    .map(([h, mins]) => `OnCalendar=Mon..Fri *-*-* ${pad(h)}:${mins.map(pad).join(",")}:00 Europe/Berlin`)
    .join("\n");
}

/**
 * One pre-session Kür timer PER active market (`PreXetra` / `PreUS`) plus a
 * single combined tick + close timer over the union window. Returns
 * filename → unit-file content.
 */
export function buildTimerFiles(markets: Market[]): Record<string, string> {
  const open = markets.reduce((min, m) => (toMinutes(m.open) < toMinutes(min) ? m.open : min), markets[0].open);
  const close = markets.reduce((max, m) => (toMinutes(m.close) > toMinutes(max) ? m.close : max), markets[0].close);

  const files: Record<string, string> = {};
  for (const m of markets) {
    files[`ape-signal-scan-${m.scanLabel.toLowerCase()}.timer`] = [
      "[Unit]",
      `Description=Ape Signal pre-session scan ${m.name} (${m.kuerScan} Europe/Berlin, Kandidatenkuer-Trigger)`,
      "",
      "[Timer]",
      `OnCalendar=Mon..Fri *-*-* ${m.kuerScan}:00 Europe/Berlin`,
      "Persistent=true",
      `Unit=ape-signal-scan@${m.scanLabel}.service`,
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n");
  }

  files["ape-signal-tick.timer"] = [
    "[Unit]",
    `Description=Ape Signal paper-trading monitor tick (every minute ${open}-${close} Europe/Berlin; effektives Intervall drosselt zur Laufzeit)`,
    "",
    "[Timer]",
    tickOnCalendar(open, close),
    "Unit=ape-signal-tick@Tick.service",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");

  files["ape-signal-tick-close.timer"] = [
    "[Unit]",
    `Description=Ape Signal paper-trading closing tick (${close} Europe/Berlin)`,
    "",
    "[Timer]",
    `OnCalendar=Mon..Fri *-*-* ${close}:00 Europe/Berlin`,
    "Persistent=true",
    "Unit=ape-signal-tick@Close.service",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");

  return files;
}

/** Read an env file (KEY=VALUE) into a record; missing file → empty. */
function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const out = args.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "/etc/systemd/system";
  const envFileArg = args.find((a) => a.startsWith("--env-file="))?.slice("--env-file=".length) ?? "/etc/ape-signal.env";

  const fileEnv = loadEnvFile(envFileArg);
  const source: Record<string, string | undefined> = { ...fileEnv, ...process.env };
  const markets = activeMarkets(source);
  const files = buildTimerFiles(markets);

  mkdirSync(out, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(out, name), content, "utf8");
  }
  const summary = markets.map((m) => `${m.name}@${m.kuerScan}`).join(", ");
  console.log(`[gen-timers] wrote ${Object.keys(files).length} timers to ${out} for markets ${summary}. Run: systemctl daemon-reload`);
}

if (process.argv[1] && process.argv[1].endsWith("genTimers.ts")) {
  main();
}
