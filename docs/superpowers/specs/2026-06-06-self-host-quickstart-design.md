# Design — Self-host "in a few commands" (public-repo quickstart)

Date: 2026-06-06
Status: Approved (brainstorming) → ready for implementation plan
Repo: `ape-signal` (branch `master`)

## Goal

Make the public `ape-signal` repo approachable so that a technically-capable
stranger can get it running on their own VPS **in a few commands**, each running
their *own* Claude subscription and their *own* API keys. This is NOT a product,
SaaS, or multi-tenant system — it is packaging + onboarding polish for a
single-operator self-host.

## Scoping decisions (from brainstorming)

1. **Ambition is modest:** "publish the code; if someone really wants it, a few
   commands get it running." No SaaS, no click-onboarding, no billing.
2. **Claude Code CLI is a documented PREREQUISITE, not something we package or
   automate.** The operator installs the Claude Code CLI and runs the normal
   interactive login (`claude login`, paste token) once, **as the same OS user
   the services run as**. We do not change the auth model and do not try to
   containerize it.
3. **No Docker.** The interactive Claude login does not containerize cleanly, and
   a container over-serves the "a few commands on a VPS" goal. We keep and polish
   the existing **systemd / Linux** path.
4. **No interactive env wizard.** A thin script + a validation command + good
   docs is the chosen automation level.
5. **Target platform: Debian/Ubuntu VPS with systemd** (like the author's),
   explicitly documented; nothing broader (no macOS/Windows host support).

## Current state (verified)

- Zero runtime deps; `tsx` (a devDependency) is the runtime, so installs need
  dev deps (`npm ci`, NOT `--omit=dev`). Node ≥ 20.
- App reads `process.env` directly. systemd injects via
  `EnvironmentFile=/etc/ape-signal.env`. Nothing auto-loads a `.env` for local
  runs (no dotenv).
- Claude auth = the host CLI's login state for the user running the service;
  `.env` carries NO Claude key. `spawnClaudeRunner` spawns `claude -p`.
- `loadEnv` (`src/config/env.ts`) validates only *presence* of the required
  Telegram vars; there is no live credential check and no check that `claude`
  works.
- Deploy artifacts already exist: `systemd/` (4 units + README), `.env.example`.

## Architecture

One real new code component (`doctor`, TDD-able); the rest is glue/docs. Four
deliverables:

### 1. `src/config/doctor.ts` + `npm run doctor` (the only new logic)

A diagnostics entrypoint. Each check prints `✅ / ❌ / ⚠️` with a one-line reason.
Exits non-zero if any **required** check fails (so `setup.sh` can gate on it).

Checks:
- **Required env present** — reuse `loadEnv` (Telegram vars). ❌ if missing.
- **Claude** — spawn `claude -p` with a trivial prompt (e.g. "reply with OK");
  pass on exit 0 + non-empty stdout. This single check proves the CLI is both
  installed AND authenticated as the current user (the main footgun). ❌ on
  failure, with a hint to run `claude login` as the service user.
- **Telegram** — `getMe` (token valid) + `getChat` for `TELEGRAM_CHAT_ID`
  (chat reachable). Silent by default (no message sent). ❌ on failure.
- **Finnhub** (only if `FINNHUB_API_KEY` set) — a `/quote?symbol=AAPL` probe.
  ⚠️ (not ❌) on failure, since Finnhub is optional.
- **TradingView scanner** — a minimal `postScan` reachability probe (no key).
  ⚠️ on failure (briefing degrades without it).
- **Reddit** (only if `ENABLE_REDDIT_CRAWL` truthy) — token fetch. ⚠️ on failure.

Behaviour details:
- **Env loading:** accepts `--env-file=PATH`; default search order
  `/etc/ape-signal.env` then `./.env`. Reads the file (tiny hand-rolled parser:
  `KEY=VALUE`, skip blank/`#` lines) and injects into `process.env` before
  `loadEnv`, so `doctor` works in both the systemd and local contexts with no
  new dependency. If neither file exists, fall back to the ambient `process.env`.
- **Telegram test message:** silent by default; an opt-in `--send-test` flag
  sends one visible message to the chat as proof of the full bot→chat path.
- **Design for testability:** each check is a pure async function taking an
  injected `fetch` (and, for Claude, an injected runner/spawn) and returning a
  `{ name, status: "ok"|"warn"|"fail", detail }` result. The entrypoint wires the
  real `fetch`/`spawnClaudeRunner`, runs all checks, prints, and sets the exit
  code. This mirrors the existing dependency-injection style in `rsScreener`,
  `pipeline`, and `env`.

### 2. `scripts/setup.sh` — idempotent bootstrap (Debian/Ubuntu + systemd)

Bash, uses `sudo` for `/etc` and systemd steps. Re-runnable; never overwrites an
existing env file. Steps, in order:
1. **Prereq check:** `node` (≥20), `git`, `claude` present in `PATH`; clear
   message + non-zero exit if any missing (with install hints; Claude login is
   the operator's responsibility).
2. `git submodule update --init --recursive`.
3. `npm ci` (with dev deps; note `tsx` is the runtime).
4. Create `/etc/ape-signal.env` from `.env.example` **only if absent**
   (`chmod 600`); if it was just created, print "fill in your secrets, then
   re-run" and stop before enabling services.
5. Install systemd units: copy the 4 files to `/etc/systemd/system/`,
   `daemon-reload`, `enable --now` the two timers + the listener (per the steps
   already documented in `systemd/README.md`).
6. Run `npm run doctor --env-file=/etc/ape-signal.env`; if it fails, report and
   exit non-zero.

Optional `--check` flag: run only the prereq check + doctor (no mutations) for a
"is my box ready / is my config valid" pass.

### 3. `.env.example` polish

Small edits: state the Claude prerequisite explicitly (CLI installed +
`claude login` as the **service user**); add `SCAN_LIMIT` and `OFFSET_PATH` with
sane defaults/comments. Keep the existing Telegram/Finnhub/Reddit sections.

### 4. README quickstart

Add a top-level "Self-hosting in a few commands" section:
- **Prerequisites box:** Debian/Ubuntu VPS with systemd; Node ≥ 20; Claude Code
  CLI installed and logged in *as the user the services run as*; a Telegram bot
  + chat id (BotFather); optional Finnhub key and Reddit OAuth app.
- **Steps:** `git clone --recurse-submodules …` → `./scripts/setup.sh` → fill
  `/etc/ape-signal.env` → re-run `./scripts/setup.sh` (or `npm run doctor`) →
  done. Link to `systemd/README.md` for the per-unit details.

## Testing

- `doctor` check functions: unit-tested with injected `fetch`/runner — ok / fail
  / missing-optional-key paths, and the `--env-file` parser (KEY=VALUE, comments,
  blanks, missing file). Mirrors `env.test.ts` / `rsScreener.test.ts` style.
- `setup.sh`: not unit-tested (bash); kept small and idempotent; the `--check`
  mode is the manual smoke test.
- `npm test` + `npm run typecheck` stay green.

## Constraints honoured

- Subscription `claude -p` only; no paid LLM key introduced.
- `vendor/ape-intel` untouched.
- New `doctor` follows the existing dependency-injection + TDD patterns.

## Out of scope (YAGNI)

Docker/containers, an interactive env wizard, automating or packaging the Claude
login, multi-user/multi-tenant, non-Linux hosts, and any change to the runtime
auth model.
