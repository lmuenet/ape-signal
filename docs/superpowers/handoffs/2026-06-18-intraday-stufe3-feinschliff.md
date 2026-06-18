# Handoff — 2026-06-18: Intraday-Opportunismus — Stufe 3 Feinschliff (Folge-PR)

**Status:** Der Opportunismus-PR (**lmuenet/ape-signal#2**) ist **gemergt** (`master` @ `d163692`)
und läuft **live im Test** — Stufe 1 (Limit-Leiter + TTL) und Stufe 2 (Setup-Radar) sind aktiv;
Stufe 3 (aktive Eröffnung) ist im Code, aber per `ENABLE_INTRADAY_OPPORTUNISM` **OFF**.

**Ziel dieses Folge-PR:** den **strukturellen** Feinschliff von Stufe 3 + den direkt
zugehörigen Rest **fertig** und als **fertigen PR bereit** haben — sodass nach genug
Live-Daten nur noch die **datenabhängigen Stellschrauben** nachgezogen werden müssen, statt
neuen Code zu schreiben. Kickoff: `docs/superpowers/plans/2026-06-18-intraday-stufe3-EXECUTION-PROMPT.md`.

Grundlage: Brainstorm `…/brainstorms/2026-06-18-intraday-opportunismus.md`, Specs
`…/specs/2026-06-18-intraday-opportunismus-stufe1-design.md` und `…-stufe2-3-design.md`.

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
