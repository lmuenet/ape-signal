import { describe, it, expect } from "vitest";
import { parseCommand } from "./commands";

describe("parseCommand", () => {
  it("parses /strategie TICKER with default profile", () => {
    const c = parseCommand("/strategie tsla");
    expect(c).toEqual({ kind: "strategie", ticker: "TSLA", profile: { risk: "balanced", horizon: "swing" } });
  });

  it("parses risk + horizon args", () => {
    const c = parseCommand("/strategie nvda aggressive intraday");
    expect(c).toEqual({ kind: "strategie", ticker: "NVDA", profile: { risk: "aggressive", horizon: "intraday" } });
  });

  it("strips a @botname suffix and ignores bad profile words", () => {
    const c = parseCommand("/strategie@ape_bot amd wild forever");
    expect(c).toEqual({ kind: "strategie", ticker: "AMD", profile: { risk: "balanced", horizon: "swing" } });
  });

  it("recognises /scan", () => {
    expect(parseCommand("/scan")).toEqual({ kind: "scan" });
  });

  it("treats /strategie with no ticker as unknown", () => {
    expect(parseCommand("/strategie")).toEqual({ kind: "unknown", text: "/strategie" });
  });

  it("treats plain text as unknown", () => {
    expect(parseCommand("hello")).toEqual({ kind: "unknown", text: "hello" });
  });
});
