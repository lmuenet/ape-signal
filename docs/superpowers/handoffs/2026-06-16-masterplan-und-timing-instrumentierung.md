# Handoff — 2026-06-16: Masterplan + Einstieg Timing-Instrumentierung

Session-Übergabe. Diese Session war **Planung + Diagnose + ein Deploy**, kein
Feature-Code. Alles committet und nach `origin/master` gepusht (`f6241f9`).
Die nächste Session **arbeitet** los — Einstiegspunkt unten.

## Was diese Session geliefert hat

- **`docs/MASTERPLAN.md`** (neu, gepusht) — konsolidierter Plan über die
  nächsten Sessions. Vereint Backlog + neue Findings:
  - **Finding A:** Datenintake via **Residential-Proxy** (B1) + agent-reach.
    Anbieter-Shortlist recherchiert (Webshare ~$1,40/GB bzw. Static-ISP
    ~$0,30/IP; IPRoyal ~$1,75/GB, Traffic verfällt nicht). Proxy zuerst
    (breiter Nutzen), agent-reach danach als Recherche-Anreicherung.
  - **Finding B:** VPS-Timing. **Gemessen** (siehe unten): kein TZ-Problem,
    sondern ~85 min LLM-Latenz der Kür.
  - **Finding C:** Refokus — Trending-Report abschalten (B3). **Verifiziert:
    Kür ist StockTwits-immun** → Rückbau gefahrlos verschoben. Scope steht
    („Report weg, Daten bleiben").
  - **Finding D:** Intraday-Opportunismus (B4) — teils sofort über Limit-Orders.
  - **Finding E (neu, Nutzer):** **Claude-Health über Telegram** (D1
    konkretisiert) — Alert bei langer/ausbleibender Antwort + Usage-Limit.
- **C1-Baseline deployed** — `ape-ui`-Container neu gebaut + neu gestartet
  (`docker build`, `--network my-lab-net`, Port 8744). Legende ist live, sobald
  eine offene Position existiert. (Deploy-Punkt aus dem vorigen Handoff erledigt.)
- **CLAUDE.md:** funktionierender SSH-Stil festgehalten (lokal, da gitignored):
  `! /c/Windows/System32/OpenSSH/ssh.exe vps "..."` (nackter `ssh root@...`
  scheitert mit Permission denied).

## Die Diagnose (Datenbasis für Session 2)

`journalctl -u 'ape-signal-scan@PreUS.service' --since today` vom 2026-06-16:

```
15:15:00  Scan-Start (Timer korrekt, Europe/Berlin sauber via timedatectl)
15:17:57  [scan] PreUS report sent.      → Scan selbst nur ~3 min
16:42:40  [scan] Kandidatenkür done.     → Kür allein ~85 min
```

CPU-Zeit der Unit nur „4min 25s" → die ~85 min sind fast komplett
**LLM-Wartezeit**. Die Market-Order geht damit **~1h12 nach US-Open (15:30)**
raus — Fill weit weg vom Entscheidungskurs. **Kein** Uhr-/Zeitzonen-Fehler.

## NÄCHSTER SCHRITT (Session 2): Kür-Stufen instrumentieren — DANN fixen

**Reihenfolge bewusst: erst messen, dann Timer/Logik anfassen.** Sonst behandeln
wir nur das Symptom (z. B. Scan vorziehen), während die wahre Ursache evtl.
Usage-Throttling ist.

1. **Instrumentieren:** Zeitstempel/Dauer pro Kür-Stufe loggen — Research
   (Sonnet+WebSearch), Debatte (Sonnet), Entscheidung (Opus) — in
   `src/paper/select.ts` (`runKuer`). Ziel: sehen, WO die 85 min liegen.
   Verdächtige: viele sequentielle WebSearches, `/last30days`-Skill,
   **5h-Subscription-Limit-Throttling**.
2. **Health/Alert (Finding E / D1):** den Claude-Runner-Pfad so härten, dass
   „lange keine Antwort" und „Usage-Limit" als **Telegram-Hinweis** rausgehen
   (heute degradiert `select.ts` still nach stderr). Erkennung: Laufzeit gegen
   Schwelle + HTTP-429/Limit-Header/Runner-Fehler abfangen.
3. **Timing-Fix:** auf Basis von (1) — wahrscheinlich **Limit- statt
   Market-Orders** (entkoppelt Fill vom Entscheidungszeitpunkt; deckt Finding D
   mit ab), ggf. PreUS-Scan vorziehen und/oder Kür entkoppeln. Engine kann
   Limit (siehe `src/paper/format.ts`/`engine.ts`).

### Schlüsseldateien

| Bereich | Dateien |
|---|---|
| Kür-Orchestrierung (Stufen, Degradation) | `src/paper/select.ts` |
| Kür-Hook am Scan + Runner-Konfig (sonnet/opus, allowedTools) | `src/scan/index.ts` (Z. 81–108) |
| Claude-Runner (Fehler-/Limit-Pfad) | `src/claude/invoke.ts` |
| Order-Platzierung (Limit/Market, Guardrails) | `src/paper/engine.ts`, `src/paper/format.ts`, `src/paper/types.ts` |
| Timer (PreUS 15:15, Generator) | `systemd/ape-signal-scan-preus.timer`, `src/config/genTimers.ts` |
| Telegram senden | `src/telegram/client.ts` |

## Geparkt (NICHT beauftragt — erst auf Zuruf)

- **B3 Trending-Rückbau** — Scope steht („Report weg, Daten bleiben": PreOpen
  08:45 abschalten, PreUS sendet keinen Report mehr via `sendReport`-Flag in
  `runScan`, Default `true`). Kür ist StockTwits-immun → unkritisch, jederzeit
  machbar (kann Session 2 die Kette mit verkürzen).
- **B1 Proxy** (Session 3), **B2 EMA 8** (Session 4), B4 Opportunismus,
  C1-Embed, agent-reach, C2/C4. Reihenfolge in `docs/MASTERPLAN.md`.
- **StockTwits-Weirdness** — separater Datenqualitätspunkt (On-Demand-Pfade
  `strategy.ts`/`marketData.ts`), berührt die Kür NICHT.

## Arbeitsweise (bewährt, beibehalten)

- Superpowers-Workflow strikt: brainstorming → spec → writing-plans →
  executing-plans (TDD red-green, **Commit pro Task**) →
  finishing-a-development-branch.
- Entwicklung **inline** (keine Subagents). Branch-Abschluss per lokalem
  `--no-ff`-Merge nach master + Test-Verifikation + Branch löschen. Docs direkt
  auf master.
- Commit-Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **SSH nur der Nutzer**, Stil: `! /c/Windows/System32/OpenSSH/ssh.exe vps "..."`
  (mehrere Schritte mit `;`/`&&` in EINEM Quote bündeln). Deploy des **UI**
  braucht `docker build` + Container-Neustart (ADR 0004), NICHT Host-`npm ci`.
- Bekannt & ok: vitest-stderr zeigt gewollte Degradations-Logs.
