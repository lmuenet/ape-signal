// src/paper/store.ts — persistence for the paper depot: portfolio.json (the
// machine-readable truth) and journal.md (Mr Ape's append-only narrative).
// Both live in DATA_DIR (gitignored), default <cwd>/data.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { freshPortfolio, type Portfolio } from "./types";

export function dataDir(env: Record<string, string | undefined> = process.env): string {
  return env.DATA_DIR && env.DATA_DIR.trim() !== "" ? env.DATA_DIR : join(process.cwd(), "data");
}

const PORTFOLIO_FILE = "portfolio.json";
const JOURNAL_FILE = "journal.md";

/** Load the portfolio, creating a fresh one (startBalance) on first run. */
export function loadPortfolio(dir: string, startBalance: number): Portfolio {
  const path = join(dir, PORTFOLIO_FILE);
  if (!existsSync(path)) return freshPortfolio(startBalance);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Portfolio;
  if (typeof parsed.balance !== "number" || !Array.isArray(parsed.positions)) {
    throw new Error(`Corrupt portfolio file: ${path}`);
  }
  return { ...parsed, history: parsed.history ?? [], orders: parsed.orders ?? [] };
}

/** Atomic save: write to a temp file, then rename over the target. */
export function savePortfolio(dir: string, p: Portfolio): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, PORTFOLIO_FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(p, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

/** Append one journal entry under a "## <timestamp> — <title>" heading. */
export function appendJournal(dir: string, title: string, body: string, now: Date = new Date()): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, JOURNAL_FILE);
  if (!existsSync(path)) {
    writeFileSync(path, "# Mr Ape — Trading-Journal\n", "utf8");
  }
  const stamp = berlinStamp(now);
  appendFileSync(path, `\n## ${stamp} — ${title}\n\n${body.trim()}\n`, "utf8");
}

/** The last `maxChars` of the journal (for prompts/Telegram), "" if none. */
export function readJournalTail(dir: string, maxChars = 4000): string {
  const path = join(dir, JOURNAL_FILE);
  if (!existsSync(path)) return "";
  const content = readFileSync(path, "utf8");
  if (content.length <= maxChars) return content;
  const cut = content.slice(-maxChars);
  // Start at the first full entry inside the window when possible.
  const idx = cut.indexOf("\n## ");
  return idx === -1 ? cut : cut.slice(idx + 1);
}

/** "YYYY-MM-DD HH:mm" in Europe/Berlin (journal headings, day keys). */
export function berlinStamp(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return fmt.format(now).replace(",", "");
}

/** "YYYY-MM-DD" Berlin trading day. */
export function berlinDay(now: Date = new Date()): string {
  return berlinStamp(now).slice(0, 10);
}
