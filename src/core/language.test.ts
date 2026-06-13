import { describe, it, expect } from "vitest";
import {
  strategyDirective,
  trendingDirective,
  HEADLESS_JSON_DIRECTIVE,
  SUPPORTED_LANGUAGES,
  type Language,
} from "./language";

describe("language directives", () => {
  it("strategy directive (de) demands German free text but English JSON keys + enums", () => {
    const d = strategyDirective("de");
    expect(d).toContain("DEUTSCH");
    expect(d).toContain("long | short | stay-out");
    expect(d).toContain("low | medium | high");
  });

  it("strategy directive (en) swaps the language label, keeps the enums English", () => {
    const d = strategyDirective("en");
    expect(d).toContain("ENGLISCH");
    expect(d).not.toContain("DEUTSCH");
    expect(d).toContain("long | short | stay-out");
    expect(d).toContain("low | medium | high");
  });

  it("strategy directive defaults to German when no language is passed", () => {
    expect(strategyDirective()).toBe(strategyDirective("de"));
  });

  it("trending directive (de) keeps verdict English to protect the parser", () => {
    const d = trendingDirective("de");
    expect(d).toContain("DEUTSCH");
    expect(d).toContain("signal | noise | watch");
    expect(d.toLowerCase()).toContain("verdict");
  });

  it("trending directive (en) swaps the language label, keeps verdict English", () => {
    const d = trendingDirective("en");
    expect(d).toContain("ENGLISCH");
    expect(d).not.toContain("DEUTSCH");
    expect(d).toContain("signal | noise | watch");
  });

  it("trending directive defaults to German", () => {
    expect(trendingDirective()).toBe(trendingDirective("de"));
  });

  it("headless directive forbids tools and demands JSON-only, no preamble", () => {
    expect(HEADLESS_JSON_DIRECTIVE).toContain("headless");
    expect(HEADLESS_JSON_DIRECTIVE).toContain("KEINE Tools");
    expect(HEADLESS_JSON_DIRECTIVE).toContain("JSON-Block");
    expect(HEADLESS_JSON_DIRECTIVE).toContain("Rückfrage");
  });

  it("exposes the supported language set (de, en)", () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual<Language[]>(["de", "en"]);
  });
});
