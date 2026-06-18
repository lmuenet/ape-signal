# Handoff — 2026-06-18: Intraday-Opportunismus — Stufe 3 Feinschliff (Folge-PR)

**Status (aktualisiert):** Der **strukturelle Feinschliff ist umgesetzt** (PR
**lmuenet/ape-signal#3**, Branch `feat/intraday-stufe3-feinschliff`). Tasks 1–3 erledigt
(TDD, je 1 Commit); der optionale Trailing-Stop (Task 4) ist **bewusst ausgelassen** →
eigener Folge-PR (Begründung unten). Voller `npx vitest run` (443) + `npx tsc --noEmit`
**grün**. Finaler adversarialer Multi-Agent-Review gelaufen — keine Important-Findings;
drei minor/nit-Punkte adressiert.

Basis: Der Opportunismus-PR (**#2**) ist **gemergt** (`master` @ `d163692`) und läuft **live
im Test** — Stufe 1 (Limit-Leiter + TTL) und Stufe 2 (Setup-Radar) aktiv; Stufe 3 (aktive
Eröffnung) im Code, aber per `ENABLE_INTRADAY_OPPORTUNISM` **OFF**.

**Ziel dieses Folge-PR:** den **strukturellen** Feinschliff von Stufe 3 + den direkt
zugehörigen Rest **fertig** und als **fertigen PR bereit** haben — sodass nach genug
Live-Daten nur noch die **datenabhängigen Stellschrauben** nachgezogen werden müssen, statt
neuen Code zu schreiben. Kickoff: `docs/superpowers/plans/2026-06-18-intraday-stufe3-EXECUTION-PROMPT.md`.

Grundlage: Brainstorm `…/brainstorms/2026-06-18-intraday-opportunismus.md`, Specs
`…/specs/2026-06-18-intraday-opportunismus-stufe1-design.md` und `…-stufe2-3-design.md`.

---

## Umgesetzt in diesem Folge-PR (Stand 2026-06-18)

1. **Research/Debatte limit-aware (Constraint #6)** — `select.ts`: neuer `degradeAlert`/
   `tryDegradeAlert`; ein 5h-Limit/Timeout in Recherche oder Debatte wird jetzt per Telegram
   sichtbar (statt still in stderr), die Kür degradiert weiter graceful. Commit `b5b1e64`.
2. **Kür-Journal-Parität (TTL/Leiter)** — `format.ts` exportiert `orderLine`; der Kür-Journal-
   Body nutzt es (zeigt `expiresOn ?? day` + Leiter-Rung, analog Telegram). Commit `73a9db0`.
3. **`OPPORTUNISM`-Konstanten zentralisiert** — `types.ts` (+ `SetupThresholds`), `setupRadar.ts`
   darauf umgestellt; **bit-identische Defaults** (reines Refactor). Commit `b28e5cd`.
4. **Trailing-Stop — AUSGELASSEN.** Begründung: berührt `engine.ts/applyTick` (kritischster,
   live laufender Pfad), braucht eine eigene Spec, und der PR ist mit Tasks 1–3 substanziell
   genug. → **eigener Folge-PR** (siehe Backlog).

Review-Fixes (Commit `0a4985d`): Degrade-Alert-`send` best-effort gekapselt (kein Kür-Abbruch,
falls Telegram im seltenen Doppelfehler-Fall down ist); zwei zahnlose OPPORTUNISM-Tests ehrlich
gemacht/entfernt; Debatte-`timeout`-Test ergänzt.

### Datenabhängige Konstanten — Stelle + aktueller Default (nach Live-Daten kalibrieren)

| Konstante | Stelle | Default heute | Bedeutung |
|---|---|---|---|
| `rsiOverbought` | `types.ts` `OPPORTUNISM` | `70` | RSI-Overbought-Schwelle (Setup-Radar) |
| `rsiOversold` | `types.ts` `OPPORTUNISM` | `30` | RSI-Oversold-Schwelle |
| `emaCrossMinGap` | `types.ts` `OPPORTUNISM` | `0` | Min. EMA10−EMA20-Abstand für Cross (0 = exakter Vorzeichenwechsel, Whipsaw-Guard) |
| `maxIntradayTrades` | `types.ts` `GUARDRAILS` | `1` | Intraday-Budget-Tier (Stufe 3) |
| `maxTtlDays` | `types.ts` `GUARDRAILS` | `5` | Max. TTL-Tage einer Order |
| `ENABLE_INTRADAY_OPPORTUNISM` | `.env` / `env.ts` | `OFF` | Flag für Stufe-3-Eröffnung |

Das spätere **Update nach Daten** ist ein Edit dieser Werte — kein neuer Code. `emaCrossMinGap`
ist bewusst auf Default `0` (heutiges Verhalten); erhöhen, falls die Live-Daten Whipsaw-Cluster
zeigen. Der optionale `thresholds`-Parameter von `detectSetups` existiert nur zur Testbarkeit —
die Produktion (`radar.ts`) nutzt immer den `OPPORTUNISM`-Default.

> Review-Notiz (by-design): `deps.send` gilt projektweit als best-effort. Der finale Kür-Post und
> der Decider-Skip-Alert rufen `send` weiterhin ungekapselt auf (ihr Scheitern fängt
> `main().catch`); nur der mitten-im-Ablauf liegende Degrade-Alert ist gekapselt, weil sein
> Scheitern sonst die noch ausstehende Opus-Entscheidung verhindern würde.

---

## Was live getestet wird (PR #2, bereits auf master)

- **Stufe 1:** Kür platziert Limit-Leitern (`rungGroup` + Mutual-Cancel) + Multi-Day-TTL
  (`ttlDays`/`expiresOn`); Prompt bevorzugt Limits.
- **Stufe 2:** Kür seedet `data/watchlist.json`; Monitor-Tick erkennt close-basierte Trigger
  (EMA10×EMA20-Cross, RSI-Extrem) und **meldet** sie (`⚡ Setup …`), kein Auto-Trade.
- **Stufe 3 (OFF):** `runIntradayOpportunity` würde hinter dem Flag **eine** Limit-Order setzen.

**Was die Live-Daten liefern sollen** (Grundlage fürs spätere „Update"):
Trigger-Frequenz (zu laut/zu still?), Qualität der Setups, ob die Limit-Leitern füllen, wie oft
die Kür Multi-Day-TTL nutzt — und daraus die richtigen Werte für die Stellschrauben unten.

---

## In diesem PR umsetzen (strukturell, jetzt — datenunabhängig)

1. **Constraint #6 — Research/Debatte limit-aware (Voraussetzung für Stufe-3-Vertrauen).**
   Heute fangen die Sonnet-Research-/Debatte-Calls in `select.ts` (~Z. 82 u. 106) Fehler
   **generisch** ab — ein `ClaudeError.kind === "limit"|"timeout"` wird dort NICHT unterschieden
   (anders als Entscheider/Manager). Angleichen, damit ein 5h-Limit auch in der Recherche
   sichtbar wird (Telegram-Hinweis statt stiller „degrade"). Dann erbt jeder künftige
   Intraday-LLM-Pfad die limit-bewusste Degradation vollständig.
2. **Kür-Journal zeigt TTL/Leiter (Parität).** Der inline-Journaltext in `select.ts` (~Z. 189)
   weist `expiresOn`/`rungGroup` noch nicht aus; die Telegram-Kür (`formatKuer`→`orderLine`)
   schon. Angleichen.
3. **Opportunismus-Konstanten zentralisieren + dokumentieren.** Alle datenabhängigen Werte an
   EINE gut sichtbare Stelle ziehen (z. B. ein `OPPORTUNISM`-Objekt in `types.ts` neben
   `GUARDRAILS`), jeweils mit Kommentar „aus Live-Daten kalibrieren". Heute verstreut:
   - RSI-Schwellen 70/30 — `setupRadar.ts` (`rsiExtreme`).
   - EMA-Cross-Sensitivität (heute exakter Vorzeichenwechsel; evtl. Mindest-Gap gegen Whipsaw).
   - `maxIntradayTrades` (1), `maxTtlDays` (5) — `types.ts` `GUARDRAILS`.
   - Setup-Verbrauch/Cooldown (heute „1×/Kind/Ticker/Tag" via `firedKinds` in `radar.ts`).
   So wird das spätere „Update nach Daten" ein **Konstanten-Edit**, kein Re-Design.
4. **(Optional, passt thematisch) Deterministischer Trailing-Stop** (`trailBy` an `Position`,
   in `applyTick` nachgezogen) — Exit-Seite der Order-Geometrie, senkt LLM-Abhängigkeit. Wenn
   der PR sonst dünn bleibt, hier mit reinnehmen; sonst als eigener PR (eigene Spec).

Jeder Punkt: **TDD** (red→green), `npm test` + `npm run typecheck` grün, Commit pro Task.

---

## Datenabhängig — NICHT jetzt festlegen, nach Live-Daten nachziehen

Dies ist bewusst der „Update"-Teil, den Lars nach genug Daten macht (kleine Edits an den in
Punkt 3 zentralisierten Konstanten + ggf. das Flag):

- **RSI-Schwellen** 70/30 — evtl. enger/weiter je nach Trigger-Qualität.
- **EMA-Cross** — evtl. Mindest-Abstand/Bestätigung gegen Whipsaw-Cluster.
- **`maxIntradayTrades`** 1 → evtl. 2, je nach Disziplin der Stufe-3-Trades.
- **`ttlDays`-Default/Max** — je nachdem, wie oft Multi-Day-Limits real füllen.
- **Setup-Radar-Lautstärke** — falls zu viele `⚡ Setup`-Meldungen: zusätzlicher Zeit-Cooldown.
- **`ENABLE_INTRADAY_OPPORTUNISM`** scharf schalten — erst wenn Stufe 1+2 sauber aussehen.
- **Ladder/Group-Budget** — „Gruppe = 1 Trade" statt N Slots (Stufe-1-Spec-Option), falls die
  Daten zeigen, dass Leitern das Tagesbudget zu schnell aufbrauchen.

---

## Backlog (später, eigene PRs — NICHT dieser PR)

- **Trailing-Stop (deterministisch):** `trailBy?` (absolut/%) an `Position`; in `applyTick` nach
  günstiger Bewegung den Stop deterministisch nachziehen (nie lockern). Eigene Spec zuerst
  (`docs/superpowers/specs/`). Bewusst aus diesem PR herausgehalten — berührt den live laufenden
  `engine.ts/applyTick`-Pfad und ist eigenständig genug für einen separaten PR.
- **B:** Intent-Event-Stream, `/status`-Command + opt-in Heartbeat.
- **C:** B1 Residential-Proxy, Timing-Fix (Finding B), B3 Trending-Rückbau, C1-Embed,
  agent-reach, C2/C3/C4. Reihenfolge im MASTERPLAN.

---

## Schlüsseldateien

| Bereich | Dateien |
|---|---|
| Setup-Erkennung (RSI/EMA-Schwellen) | `src/paper/setupRadar.ts` |
| Radar-Orchestrierung (Verbrauch/Cooldown) | `src/paper/radar.ts` |
| Intraday-Eröffnung (Stufe 3, gegated) | `src/paper/intraday.ts` |
| Guardrails/Konstanten | `src/paper/types.ts` (`GUARDRAILS`; Ziel: `OPPORTUNISM`) |
| Kür (Research/Debatte-Fehlerpfad, Journal) | `src/paper/select.ts` |
| Flag | `src/config/env.ts` (`ENABLE_INTRADAY_OPPORTUNISM`) |
| Engine (Trailing-Stop, falls Punkt 4) | `src/paper/engine.ts`, `src/paper/types.ts` |

---

## Deploy / Live-Beobachtung (für Lars)

PR #2 ist auf master. Kein Dep-/UI-Change → Deploy war/ist klein:
```bash
! /c/Windows/System32/OpenSSH/ssh.exe vps "cd /opt/ape-signal && git pull && systemctl restart ape-signal-listener"
```
Timer-Dienste (`scan@PreUS`, `tick@Tick`) ziehen den tsx-Code automatisch. Stufe 3 bleibt OFF,
bis die Daten passen. `data/watchlist.json` entsteht zur Laufzeit (gitignored), keine Migration.

## Arbeitsweise (beibehalten)

- Superpowers-Workflow: spec/handoff lesen → TDD pro Task (Commit pro Task) → finaler Review →
  PR. **Inline**-Entwicklung. `npm test` + `npm run typecheck` grün vor jedem Commit.
- **PR-Route (Cross-Fork):** `git push fork <branch>` + `gh pr create --repo lmuenet/ape-signal
  --head lm-obs:<branch>`. **Merge & Squash macht Lars selbst.**
- Commit-Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- SSH nur der Nutzer: `! /c/Windows/System32/OpenSSH/ssh.exe vps "…"`.

## Wie weiter

Den Execution-Prompt (`…/plans/2026-06-18-intraday-stufe3-EXECUTION-PROMPT.md`) in eine Session
geben → Punkte 1–3 (+ optional 4) TDD umsetzen → Cross-Fork-PR. Der PR ist dann „bereit"; das
spätere **Update nach Live-Daten** ist nur noch ein Edit der zentralisierten Konstanten (+ ggf.
das Flag).
