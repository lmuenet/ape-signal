import { describe, it, expect } from "vitest";
import { GERMAN_DIRECTIVE_STRATEGY, GERMAN_DIRECTIVE_TRENDING, HEADLESS_JSON_DIRECTIVE } from "./language";

describe("language directives", () => {
  it("strategy directive demands German free text but English JSON keys + enums", () => {
    expect(GERMAN_DIRECTIVE_STRATEGY).toContain("DEUTSCH");
    expect(GERMAN_DIRECTIVE_STRATEGY).toContain("long | short | stay-out");
    expect(GERMAN_DIRECTIVE_STRATEGY).toContain("low | medium | high");
  });

  it("trending directive keeps verdict English to protect the parser", () => {
    expect(GERMAN_DIRECTIVE_TRENDING).toContain("DEUTSCH");
    expect(GERMAN_DIRECTIVE_TRENDING).toContain("signal | noise | watch");
    expect(GERMAN_DIRECTIVE_TRENDING.toLowerCase()).toContain("verdict");
  });

  it("headless directive forbids tools and demands JSON-only, no preamble", () => {
    expect(HEADLESS_JSON_DIRECTIVE).toContain("headless");
    expect(HEADLESS_JSON_DIRECTIVE).toContain("KEINE Tools");
    expect(HEADLESS_JSON_DIRECTIVE).toContain("JSON-Block");
    expect(HEADLESS_JSON_DIRECTIVE).toContain("Rückfrage");
  });
});
