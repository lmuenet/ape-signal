import { describe, it, expect, vi } from "vitest";
import { parseVerbosity, createNotifier, type NotifyCategory } from "./notify";

describe("parseVerbosity", () => {
  it("defaults to trade+digest+alert when unset or empty", () => {
    for (const raw of [undefined, "", "   "]) {
      expect([...parseVerbosity(raw)].sort()).toEqual(["alert", "digest", "trade"]);
    }
  });
  it("'all' enables every category", () => {
    expect(parseVerbosity("all").size).toBe(5);
  });
  it("parses an explicit comma list (trim + case-insensitive)", () => {
    expect([...parseVerbosity("trade, RESEARCH")].sort()).toEqual(["research", "trade"]);
  });
  it("ignores unknown tokens; falls back to default only if nothing valid remains", () => {
    expect([...parseVerbosity("bogus,nonsense")].sort()).toEqual(["alert", "digest", "trade"]);
    expect([...parseVerbosity("trade,bogus")].sort()).toEqual(["trade"]);
  });
});

describe("createNotifier", () => {
  it("sends enabled categories, mutes the rest", async () => {
    const sent: string[] = [];
    const notify = createNotifier((t) => void sent.push(t), parseVerbosity(undefined)); // trade,digest,alert
    await notify("order", "trade");
    await notify("summary", "digest");
    await notify("risk", "alert");
    await notify("ping", "progress"); // muted
    await notify("signal", "research"); // muted
    expect(sent).toEqual(["order", "summary", "risk"]);
  });
  it("treats an untagged message as 'trade' (always on by default)", async () => {
    const sent: string[] = [];
    const notify = createNotifier((t) => void sent.push(t), parseVerbosity(undefined));
    await notify("untagged");
    expect(sent).toEqual(["untagged"]);
  });
  it("a muted message resolves to undefined without calling send", async () => {
    const send = vi.fn();
    const notify = createNotifier(send, parseVerbosity("trade"));
    const r = await notify("ping", "progress");
    expect(r).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
  it("verbosity 'all' lets every category through", async () => {
    const sent: string[] = [];
    const notify = createNotifier((t) => void sent.push(t), parseVerbosity("all"));
    for (const c of ["trade", "digest", "alert", "progress", "research"] as NotifyCategory[]) await notify(c, c);
    expect(sent.length).toBe(5);
  });
});
