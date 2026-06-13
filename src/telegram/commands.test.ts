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

  it("parses /journal with and without free text", () => {
    expect(parseCommand("/journal")).toEqual({ kind: "journal" });
    expect(parseCommand("/journal@ape_bot")).toEqual({ kind: "journal" });
    expect(parseCommand("/journal dein Guthaben ist jetzt 500")).toEqual({
      kind: "journal",
      text: "dein Guthaben ist jetzt 500",
    });
  });

  it("treats /strategie with no ticker as unknown", () => {
    expect(parseCommand("/strategie")).toEqual({ kind: "unknown", text: "/strategie" });
  });

  it("treats plain text as unknown", () => {
    expect(parseCommand("hello")).toEqual({ kind: "unknown", text: "hello" });
  });
});

describe("parseCommand /ticker", () => {
  it("parses a valid integer", () => {
    expect(parseCommand("/ticker 3")).toEqual({ kind: "ticker", minutes: 3 });
  });
  it("treats a bare /ticker as a query", () => {
    expect(parseCommand("/ticker")).toEqual({ kind: "ticker" });
  });
  it("flags a non-integer / out-of-range arg as badArg", () => {
    expect(parseCommand("/ticker abc")).toEqual({ kind: "ticker", badArg: "abc" });
    expect(parseCommand("/ticker 2.5")).toEqual({ kind: "ticker", badArg: "2.5" });
    expect(parseCommand("/ticker 0")).toEqual({ kind: "ticker", badArg: "0" });
    expect(parseCommand("/ticker 61")).toEqual({ kind: "ticker", badArg: "61" });
  });
  it("ignores a bot @suffix on the command", () => {
    expect(parseCommand("/ticker@apebot 5")).toEqual({ kind: "ticker", minutes: 5 });
  });
});
