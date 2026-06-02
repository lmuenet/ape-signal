# Plan 2 — Execution Prompt (paste into a fresh Claude Code chat)

Copy everything in the fenced block below into a new session, working in the
`ape-signal` project.

```
Execute the implementation plan at docs/plans/2026-06-02-plan2-reddit-offradar.md
in this repo (C:\Users\lmueller\ape-signal). Use the superpowers:subagent-driven-development
skill: dispatch one implementer subagent per task, verify each, then a final
review, then finish with superpowers:finishing-a-development-branch (merge to
master + push).

## Project context (so you don't have to re-derive it)
- This is `ape-signal`, a private VPS companion to the `ape-intel` Firefox
  extension. `ape-intel` is embedded as a git submodule at `vendor/ape-intel`;
  its pure lib functions are re-exported through `src/core/ape-intel.ts` (the
  barrel). Import shared logic from the barrel, never with deep vendor paths.
- Plan 1 is DONE and merged to `master`: `npm run scan` fetches Apewisdom
  trending, has Claude (`claude -p`, the local subscription CLI) challenge each
  ticker signal/noise/watch, and pushes a report to Telegram. It has been
  verified live. Plan 2 enriches that scan; do NOT regress it.
- Stack: Node 20+, TypeScript ESM, `tsx` (no build step), `vitest`.
- Tests: `npx vitest run` (vitest is scoped to `src/` via vitest.config.ts; the
  submodule's own tests are excluded — do not change that).
- Typecheck: `npx tsc --noEmit` (tsconfig includes DOM lib and scopes to `src`,
  excludes tests; submodule types resolve this way — do not change that).
- `.env` already exists locally (gitignored) with TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID and FINNHUB_API_KEY. The live scan runs with
  `node --env-file=.env --import tsx src/scan/index.ts Morning`.
- `gh` is installed and authenticated (account lmuenet); `git push` works.

## How to run it
1. Read the plan file in full first.
2. Create a feature branch off master: `git checkout -b feat/plan2-reddit-offradar`.
3. Work the tasks in order (1→9). Each task is TDD with complete code and exact
   commands — follow them; do not improvise alternative designs. Mechanical
   tasks can use a fast model; review independently.
4. After each task: confirm the task's tests pass. Run the FULL suite
   (`npx vitest run`) + `npx tsc --noEmit` green before moving on where the plan
   says so (Tasks 6, 8, 9).
5. After all tasks: dispatch a final code-quality + spec-compliance review over
   the whole branch diff (master...HEAD). Fix any Important findings.
6. Finish via superpowers:finishing-a-development-branch → option "Merge locally
   + push": merge --no-ff into master, delete the branch, push origin master.

## Important notes / gotchas
- Tasks 1–8 are pure Node TDD and need NO external tools or credentials.
- Only Task 9's MANUAL smoke test (step 4) needs the real tools:
  `npm i -g agent-browser && agent-browser install`, plus `claude login` and the
  `.env`. If agent-browser is not installed on this machine, SKIP the manual run
  (note it), set `ENABLE_REDDIT_CRAWL` empty, and rely on the unit suite — the
  scan still works Plan-1-style without the crawl.
- The Reddit crawl uses the agent-browser CLI (Vercel Labs), not Playwright/
  Python. The Node↔CLI boundary is the JSON contract `Record<sub, RawRedditPost[]>`;
  if the installed agent-browser's flags differ from the plan (`--session`,
  `open`, `eval`), adjust only `spawnAgentBrowser`/`EXTRACT_JS` in
  `src/reddit/agentBrowser.ts` — keep the contract and all unit tests intact.
- Do not commit secrets. `.env` stays local (it is gitignored).
- Commit messages: end with the project's Co-Authored-By trailer if that is the
  repo convention; keep one commit per task as the plan specifies.

When done, report: tasks completed, final test/typecheck results, the merge
commit SHA, and whether the live smoke test was run or skipped.
```

## After execution (next steps, for the human)
- If the live run was skipped: install agent-browser on the VPS/locally, set
  `ENABLE_REDDIT_CRAWL=1` in `.env`, and run the smoke test from Task 9.
- Then: **Plan 3** (Telegram listener + `/strategie TICKER` two-way analysis),
  **Plan 4** (systemd timers 08:45 / 15:15 on the VPS — go live).
