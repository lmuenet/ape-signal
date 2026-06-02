import { defineConfig } from "vitest/config";

// Scope vitest to this project's own tests only. The ape-intel submodule under
// vendor/ ships its own (browser-oriented) test suite — those must never run as
// part of ape-signal's suite.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["vendor/**", "node_modules/**", "dist/**"],
  },
});
