import { describe, expect, it } from "vitest";
import { buildDecisionPrompt, buildTickPrompt } from "./prompts";

describe("buildTickPrompt", () => {
  const base = {
    stamp: "2026-06-11 15:35",
    portfolioBlock: "(depot)",
    quotesBlock: "(quotes)",
    eventsBlock: "",
    wakeBlock: "⚡ AAPL: Kurs 111 riss Wake-Band oben (110)",
    journalTail: "",
    isClose: false,
  };

  it("includes the wake reason block and the set_wake_band contract", () => {
    const p = buildTickPrompt(base);
    expect(p).toContain("## Weckgrund");
    expect(p).toContain("riss Wake-Band oben");
    expect(p).toContain("set_wake_band");
  });

  it("omits the wake section when there is no breach", () => {
    expect(buildTickPrompt({ ...base, wakeBlock: "" })).not.toContain("## Weckgrund");
  });

  it("forces a journal note on a band wake (never null)", () => {
    expect(buildTickPrompt(base)).toContain('NIE "journal": null');
  });

  it("keeps the journal-null-ok rule when there is no breach", () => {
    const p = buildTickPrompt({ ...base, wakeBlock: "" });
    expect(p).toContain('"journal": null.');
    expect(p).not.toContain('NIE "journal"');
  });
});

describe("buildDecisionPrompt", () => {
  it("offers wakeAbove/wakeBelow in the trade contract", () => {
    const p = buildDecisionPrompt({
      day: "2026-06-11", dossierBlock: "", debateBlock: "", quotesBlock: "",
      portfolioBlock: "", journalTail: "",
    });
    expect(p).toContain("wakeAbove");
    expect(p).toContain("Wake-Up-Band");
  });
});

import { buildAdminPrompt, buildDossierPrompt } from "./prompts";

describe("prompt language label", () => {
  it("decision prompt defaults to a German free-text directive", () => {
    const p = buildDecisionPrompt({
      day: "2026-06-11", dossierBlock: "", debateBlock: "", quotesBlock: "",
      portfolioBlock: "", journalTail: "",
    });
    expect(p).toContain("DEUTSCH");
  });

  it("decision prompt switches the free-text directive to English", () => {
    const p = buildDecisionPrompt({
      day: "2026-06-11", dossierBlock: "", debateBlock: "", quotesBlock: "",
      portfolioBlock: "", journalTail: "", language: "en",
    });
    expect(p).toContain("ENGLISCH");
    expect(p).not.toContain("auf DEUTSCH");
    expect(p).toContain("long | short");
  });

  it("tick prompt honours the language flag", () => {
    const base = {
      stamp: "2026-06-11 15:35", portfolioBlock: "(d)", quotesBlock: "(q)",
      eventsBlock: "", wakeBlock: "", journalTail: "", isClose: false,
    };
    expect(buildTickPrompt({ ...base, language: "en" })).toContain("ENGLISCH");
    expect(buildTickPrompt(base)).toContain("DEUTSCH");
  });

  it("admin prompt honours the language flag and drops the hard-coded 'deutsche'", () => {
    expect(buildAdminPrompt("setz auf 500", 100, "en")).toContain("ENGLISCH");
    const de = buildAdminPrompt("setz auf 500", 100);
    expect(de).toContain("DEUTSCH");
    expect(de).not.toContain("deutsche Journal-Notiz");
  });

  it("dossier prompt honours the language flag", () => {
    const input = { day: "2026-06-11", scanSummary: "", journalTail: "" };
    expect(buildDossierPrompt({ ...input, language: "en" })).toContain("ENGLISCH");
    expect(buildDossierPrompt(input)).toContain("DEUTSCH");
  });
});

describe("session-neutral wording", () => {
  it("decision prompt says 'Handelsstart' not 'US-Open'", () => {
    const p = buildDecisionPrompt({
      day: "2026-06-11", dossierBlock: "", debateBlock: "", quotesBlock: "",
      portfolioBlock: "", journalTail: "",
    });
    expect(p).toContain("kurz vor Handelsstart");
    expect(p).not.toContain("US-Open");
  });

  it("tick prompt uses session-neutral session/close wording", () => {
    const base = {
      stamp: "2026-06-11 15:35", portfolioBlock: "(d)", quotesBlock: "(q)",
      eventsBlock: "", wakeBlock: "", journalTail: "", isClose: false,
    };
    expect(buildTickPrompt(base)).toContain("Handelssession läuft");
    expect(buildTickPrompt({ ...base, isClose: true })).toContain("Handelsschluss");
    expect(buildTickPrompt(base)).not.toContain("US-Session");
  });
});
