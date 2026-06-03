// src/reddit/agentBrowser.test.ts
import { describe, it, expect } from "vitest";
import { parseScore, toPosts, parseEvalJson } from "./agentBrowser";

describe("parseScore", () => {
  it("parses plain, k and m suffixes; hidden/garbage -> 0", () => {
    expect(parseScore("12")).toBe(12);
    expect(parseScore("1.2k")).toBe(1200);
    expect(parseScore("3M")).toBe(3_000_000);
    expect(parseScore("•")).toBe(0);
    expect(parseScore(undefined)).toBe(0);
  });
});

describe("toPosts", () => {
  it("normalises raw posts and drops title-less rows", () => {
    const posts = toPosts([
      { title: "$GME squeeze", score: "1.2k", comments: "45 comments" },
      { score: "5", comments: "0 comments" },
      { title: "KSS run", score: "•", comments: "1 comment" },
    ]);
    expect(posts).toEqual([
      { title: "$GME squeeze", selftext: "", score: 1200, numComments: 45 },
      { title: "KSS run", selftext: "", score: 0, numComments: 1 },
    ]);
  });
});

describe("parseEvalJson", () => {
  const arr = [{ title: "$GME", score: "5", comments: "1 comment" }];
  it("parses a raw JSON array printed by eval", () => {
    expect(parseEvalJson(JSON.stringify(arr))).toEqual(arr);
  });
  it("parses a double-encoded JSON string (eval returned a string)", () => {
    expect(parseEvalJson(JSON.stringify(JSON.stringify(arr)))).toEqual(arr);
  });
  it("parses a {result: ...} wrapper (--json style)", () => {
    expect(parseEvalJson(JSON.stringify({ result: JSON.stringify(arr) }))).toEqual(arr);
    expect(parseEvalJson(JSON.stringify({ result: arr }))).toEqual(arr);
  });
  it("recovers an array embedded in surrounding log noise", () => {
    expect(parseEvalJson(`some log\n${JSON.stringify(arr)}\nbye`)).toEqual(arr);
  });
  it("returns [] when no array can be found", () => {
    expect(parseEvalJson("no json here")).toEqual([]);
  });
});
