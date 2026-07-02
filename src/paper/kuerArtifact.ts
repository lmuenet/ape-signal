// src/paper/kuerArtifact.ts — structured per-day record of the Kandidatenkür
// (Kür-Ansicht spec 2026-06-12): dossier, debate, decision and orders are
// persisted at the source so the depot UI can replay why Mr Ape traded.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Debate, Dossier } from "./decision";
import type { EntryOrder, Side } from "./types";

export interface KuerArtifact {
  day: string;
  /** Market this Kür ran for ("xetra"/"us") — in xetra+us mode two Kürs run per
   *  day and must not overwrite each other (Beschluss 2026-07-02). */
  market?: string;
  createdAt: string; // ISO
  /** Compact PreUS scan block — the basis the research worked from. */
  scanSummary: string;
  /** null = research degraded (scan-only decision). */
  dossier: Dossier | null;
  /** null = debate failed or never attempted (no dossier). */
  debate: Debate | null;
  /** Opus' reasoning; null = unreadable decision. */
  decisionJournal: string | null;
  /** Accepted orders verbatim (incl. wake bands). */
  orders: EntryOrder[];
  rejected: Array<{ ticker: string; side: Side; reason: string }>;
  status: "decided" | "skipped-unreadable" | "skipped-limit" | "skipped-timeout";
}

const kuerDir = (dir: string) => join(dir, "kuer");

/** File stem for an artifact: the day, plus the market when present
 *  ("2026-07-02-us") — market-less legacy files keep their day-only key. */
export function kuerKey(a: Pick<KuerArtifact, "day" | "market">): string {
  return a.market ? `${a.day}-${a.market.toLowerCase()}` : a.day;
}

/** Atomic save (tmp + rename), one file per Kür day+market. */
export function saveKuerArtifact(dir: string, artifact: KuerArtifact): void {
  mkdirSync(kuerDir(dir), { recursive: true });
  const path = join(kuerDir(dir), `${kuerKey(artifact)}.json`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

export function loadKuerArtifact(dir: string, key: string): KuerArtifact | null {
  const path = join(kuerDir(dir), `${key}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as KuerArtifact;
}

/** Artifact keys (day or day-market), newest first; legacy day-only files stay listed. */
export function listKuerKeys(dir: string): string[] {
  const kdir = kuerDir(dir);
  if (!existsSync(kdir)) return [];
  return readdirSync(kdir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}(-[a-z]+)?\.json$/.test(f))
    .map((f) => f.slice(0, -".json".length))
    .sort()
    .reverse();
}
