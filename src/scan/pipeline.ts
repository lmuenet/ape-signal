import {
  buildTrendingClipboardPayload,
  parseTrendingChallenge,
  type ApewisdomSnapshot,
  type TrendingChallenge,
} from "../core/ape-intel";
import { snapshotToRows } from "./trending";
import { formatReport } from "./format";

export interface ScanOptions {
  label: string;
  limit: number;
}

export interface ScanDeps {
  fetchSnapshot: () => Promise<ApewisdomSnapshot>;
  claudeRunner: (prompt: string) => Promise<string>;
  send: (text: string) => Promise<void>;
}

/**
 * One scan run: fetch trending → ask Claude to challenge each ticker →
 * parse → format → send. If parsing fails, fall back to the raw trending list
 * so the user still gets a report.
 */
export async function runScan(
  options: ScanOptions,
  deps: ScanDeps,
): Promise<TrendingChallenge> {
  const snapshot = await deps.fetchSnapshot();
  const rows = snapshotToRows(snapshot, options.limit);

  const payload = buildTrendingClipboardPayload(rows);
  const raw = await deps.claudeRunner(payload);

  const challenge = parseTrendingChallenge(raw) ?? { summary: "", verdicts: [] };
  const report = formatReport(rows, challenge, { label: options.label });
  await deps.send(report);

  return challenge;
}
