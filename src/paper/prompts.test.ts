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
