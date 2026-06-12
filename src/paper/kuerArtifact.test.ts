import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listKuerDays, loadKuerArtifact, saveKuerArtifact, type KuerArtifact } from "./kuerArtifact";

function artifact(day: string): KuerArtifact {
  return {
    day,
    createdAt: `${day}T13:25:00.000Z`,
    scanSummary: "NVDA: signal",
    dossier: {
      candidates: [{ ticker: "NVDA", angle: "Momentum", catalyst: "Earnings", sentiment: "euphorisch" }],
      marketContext: "risk-on",
    },
    debate: { debates: [{ ticker: "NVDA", bull: "stark", bear: "überkauft" }] },
    decisionJournal: "Heute NVDA long.",
    orders: [],
    rejected: [{ ticker: "TSLA", side: "short", reason: "kein Kurs" }],
    status: "decided",
  };
}

describe("kuerArtifact", () => {
  it("round-trips through kuer/<day>.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ape-kuer-"));
    try {
      const a = artifact("2026-06-12");
      saveKuerArtifact(dir, a);
      expect(loadKuerArtifact(dir, "2026-06-12")).toEqual(a);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for a missing day", () => {
    const dir = mkdtempSync(join(tmpdir(), "ape-kuer-"));
    try {
      expect(loadKuerArtifact(dir, "2026-06-12")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists days newest first, ignoring foreign files", () => {
    const dir = mkdtempSync(join(tmpdir(), "ape-kuer-"));
    try {
      saveKuerArtifact(dir, artifact("2026-06-10"));
      saveKuerArtifact(dir, artifact("2026-06-12"));
      saveKuerArtifact(dir, artifact("2026-06-11"));
      expect(listKuerDays(dir)).toEqual(["2026-06-12", "2026-06-11", "2026-06-10"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists nothing when the directory does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "ape-kuer-"));
    try {
      expect(listKuerDays(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
