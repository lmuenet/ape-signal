// src/config/genTimers.ts — erzeugt die drei session-getriebenen systemd-Timer
// aus der SessionConfig (A2). Reiner Kern (buildTimerFiles) + ein dünner main,
// der nach --out=<dir> (Default /etc/systemd/system) schreibt. Der Tick-Timer
// feuert fix jede Minute im Fenster; das effektive Intervall drosselt zur Laufzeit.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSession, type SessionConfig } from "./session";

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

/** Filename → unit-file content for the three session-driven timers. */
export function buildTimerFiles(session: SessionConfig): Record<string, string> {
  return {
    "ape-signal-scan-preus.timer": [
      "[Unit]",
      `Description=Ape Signal pre-session scan (${session.kuerScan} Europe/Berlin, Kandidatenkuer-Trigger)`,
      "",
      "[Timer]",
      `OnCalendar=Mon..Fri *-*-* ${session.kuerScan}:00 Europe/Berlin`,
      "Persistent=true",
      "Unit=ape-signal-scan@PreUS.service",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n"),
    "ape-signal-tick.timer": [
      "[Unit]",
      `Description=Ape Signal paper-trading monitor tick (every minute ${session.open}-${session.close} Europe/Berlin; effektives Intervall drosselt zur Laufzeit)`,
      "",
      "[Timer]",
      tickOnCalendar(session.open, session.close),
      "Unit=ape-signal-tick@Tick.service",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n"),
    "ape-signal-tick-close.timer": [
      "[Unit]",
      `Description=Ape Signal paper-trading closing tick (${session.close} Europe/Berlin)`,
      "",
      "[Timer]",
      `OnCalendar=Mon..Fri *-*-* ${session.close}:00 Europe/Berlin`,
      "Persistent=true",
      "Unit=ape-signal-tick@Close.service",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n"),
  };
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
  const session = loadSession(source);
  const files = buildTimerFiles(session);

  mkdirSync(out, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(out, name), content, "utf8");
  }
  console.log(`[gen-timers] wrote ${Object.keys(files).length} timers to ${out} for session ${session.open}-${session.close} (Kuer ${session.kuerScan}). Run: systemctl daemon-reload`);
}

if (process.argv[1] && process.argv[1].endsWith("genTimers.ts")) {
  main();
}
