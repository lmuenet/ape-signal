import { describe, it, expect } from "vitest";
import { snapshotToRows } from "./trending";
import type { ApewisdomSnapshot } from "../core/ape-intel";

function snap(): ApewisdomSnapshot {
  return new Map([
    ["TSLA", { rank: 2, mentions: 300, mentions24hAgo: 100 }],
    ["GME", { rank: 1, mentions: 500, mentions24hAgo: 600 }],
    ["AMC", { rank: 3, mentions: 50, mentions24hAgo: 50 }],
  ]);
}

describe("snapshotToRows", () => {
  it("sorts by rank ascending and carries ticker + mentions", () => {
    const rows = snapshotToRows(snap());
    expect(rows.map((r) => r.ticker)).toEqual(["GME", "TSLA", "AMC"]);
    expect(rows[0]).toMatchObject({ ticker: "GME", rank: 1, mentions: 500, mentions24hAgo: 600 });
  });

  it("applies the limit", () => {
    expect(snapshotToRows(snap(), 2)).toHaveLength(2);
  });
});
