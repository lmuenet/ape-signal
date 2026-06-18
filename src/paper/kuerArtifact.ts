// src/paper/kuerArtifact.ts — structured per-day record of the Kandidatenkür
// (Kür-Ansicht spec 2026-06-12): dossier, debate, decision and orders are
// persisted at the source so the depot UI can replay why Mr Ape traded.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Debate, Dossier } from "./decision";
import type { EntryOrder, Side } from "./types";

export interface KuerArtifact {
  day: string;
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

/** Atomic save (tmp + rename), one file per Kür day. */
export function saveKuerArtifact(dir: string, artifact: KuerArtifact): void {
  mkdirSync(kuerDir(dir), { recursive: true });
  const path = join(kuerDir(dir), `${artifact.day}.json`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

export function loadKuerArtifact(dir: string, day: string): KuerArtifact | null {
  const path = join(kuerDir(dir), `${day}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as KuerArtifact;
}

/** Days with a Kür artifact, newest first. */
export function listKuerDays(dir: string): string[] {
  const kdir = kuerDir(dir);
  if (!existsSync(kdir)) return [];
  return readdirSync(kdir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse();
}
