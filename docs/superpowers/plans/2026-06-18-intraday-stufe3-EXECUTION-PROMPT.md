# Intraday — Stufe 3 Feinschliff — Execution Prompt (in eine frische Claude-Code-Session geben)

Kopiere den gesamten eingerahmten Block unten in eine neue Session im `ape-signal`-Projekt.
Er setzt den **strukturellen** Feinschliff von Stufe 3 (+ direkt zugehörigen Rest) um und
endet mit einem fertigen PR — die **datenabhängigen** Werte werden bewusst NICHT festgelegt,
nur zentralisiert + dokumentiert, damit Lars sie nach genug Live-Daten in einem kleinen Edit
nachzieht.

```
Setze den strukturellen Feinschliff von Intraday-Opportunismus Stufe 3 um. Lies ZUERST in voller
Länge: docs/superpowers/handoffs/2026-06-18-intraday-stufe3-feinschliff.md und die Specs
docs/superpowers/specs/2026-06-18-intraday-opportunismus-stufe2-3-design.md (+ ...-stufe1-design.md).
Arbeite inline, TDD (red→green), ein Commit pro Task.

## Projektkontext (nicht neu herleiten)
- `ape-signal`: VPS-Begleiter zum `ape-intel`-Submodul (vendor/ape-intel; geteilte lib über die
  Barrel src/core/ape-intel.ts importieren, nie mit tiefen vendor-Pfaden).
- Stack: Node 20+, TypeScript ESM, `tsx` (KEIN Build-Step), `vitest`. Tests: `npx vitest run`.
  Typecheck: `npx tsc --noEmit`. Beides MUSS vor jedem Commit grün sein.
- Der gesamte Intraday-Opportunismus (Stufe 1+2+3) ist bereits auf master (PR #2 gemergt) und
  läuft live im Test — NICHT regressieren. Stufe 3 ist hinter ENABLE_INTRADAY_OPPORTUNISM (OFF).
- portfolio.json/watchlist.json liegen in DATA_DIR (gitignored); neue Felder sind optional →
  keine Migration. `gh` ist als lm-obs angemeldet.

## Branch
Es existiert bereits der Branch `feat/intraday-stufe3-feinschliff` (off master) mit dem Handoff +
diesem Prompt. Arbeite auf DIESEM Branch weiter (`git checkout feat/intraday-stufe3-feinschliff`).
Falls er fehlt: `git checkout -b feat/intraday-stufe3-feinschliff master`.

## Tasks (TDD, Commit pro Task)
1. **Research/Debatte limit-aware (Constraint #6).** In src/paper/select.ts fangen die
   researchRunner-/debateRunner-Aufrufe (~Z. 82 u. 106) Fehler heute generisch ab. Angleichen an
   den Entscheider-/Manager-Pfad: bei `err instanceof ClaudeError && (err.kind==="limit"||"timeout")`
   einen spezifischen Telegram-Hinweis senden (z. B. "⚠️ Mr Ape: Recherche limitiert/Timeout —
   Kür läuft mit reduzierter Datenbasis weiter") statt nur stderr. Die Kür degradiert weiterhin
   graceful (kein Abbruch). Tests: limit/timeout in Research bzw. Debatte → Alert + Kür entscheidet
   trotzdem.
2. **Kür-Journal-Parität (TTL/Leiter).** Der inline-Journaltext in select.ts (~Z. 189) soll
   `expiresOn` (statt fix `day`) und einen Leiter-Marker zeigen, analog orderLine in format.ts.
   Test: ein Multi-Day-/Leiter-Order erscheint im Journaltext mit Gültigkeit/Leiter.
3. **Opportunismus-Konstanten zentralisieren.** Lege in src/paper/types.ts ein `OPPORTUNISM`-Objekt
   (neben GUARDRAILS) an und ziehe die heute verstreuten datenabhängigen Werte dorthin, jeweils mit
   Kommentar "// tune from live data":
   - RSI-Schwellen 70/30 (heute hartkodiert in setupRadar.ts `rsiExtreme`).
   - optionaler EMA-Cross-Mindest-Gap (heute exakter Vorzeichenwechsel) — als Konstante mit Default 0
     (= heutiges Verhalten), in setupRadar.ts `emaCross` angewandt.
   - maxIntradayTrades / maxTtlDays bleiben in GUARDRAILS, aber im OPPORTUNISM-Kommentar als
     "datenabhängig" referenzieren.
   setupRadar.ts/radar.ts auf die Konstanten umstellen. WICHTIG: Defaults so wählen, dass das
   Verhalten BIT-IDENTISCH bleibt (reines Refactor + Sichtbarmachung) — alle bestehenden Tests
   bleiben grün, plus ein Test, dass die Konstanten greifen.
4. **(Optional, nur wenn zeitlich/umfänglich sinnvoll) Deterministischer Trailing-Stop.** `trailBy?`
   (absolut oder %) an Position; in applyTick nach einer günstigen Bewegung den Stop deterministisch
   nachziehen (nie lockern). Eigene kleine Spec zuerst (docs/superpowers/specs/). Wenn unklar oder
   der PR sonst groß genug ist: AUSLASSEN und im Handoff als eigener Folge-PR vermerken.

## Datenabhängig — NICHT festlegen
Tasks setzen Struktur + Defaults (= heutiges Verhalten). Die FINALEN Werte (RSI-Schwellen,
EMA-Gap, maxIntradayTrades, ttl-Default, Cooldown, Flag) zieht Lars nach Live-Daten in einem Edit
der OPPORTUNISM-Konstanten nach. Im PR-Text klar als "nach Daten zu kalibrieren" markieren.

## Abschluss
- Voller `npx vitest run` + `npx tsc --noEmit` grün.
- Finaler adversarialer Review über master...HEAD (eigener Subagent), Important-Findings fixen.
- Handoff aktualisieren (Status: Feinschliff umgesetzt; Trailing-Stop ggf. offen).
- Cross-Fork-PR: `git push fork feat/intraday-stufe3-feinschliff`. Es existiert evtl. schon ein
  DRAFT-PR für diesen Branch (Scaffold mit Handoff+Prompt) — dann aktualisiert ihn der Push;
  setze ihn am Ende auf ready: `gh pr ready <nr> --repo lmuenet/ape-signal`. Falls kein PR offen:
  `gh pr create --repo lmuenet/ape-signal --head lm-obs:feat/intraday-stufe3-feinschliff`.
  NICHT mergen/pushen auf master — Merge & Squash macht Lars.
- Commit-Trailer: Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

Berichte am Ende: umgesetzte Tasks, Test/Typecheck-Ergebnis, ob Trailing-Stop drin ist, PR-Link,
und die Liste der datenabhängigen Konstanten (Stelle + aktueller Default).
```

## Nach der Ausführung (für Lars)
- Den entstehenden PR **bereit** liegen lassen.
- Sobald genug Live-Daten da sind: die zentralisierten `OPPORTUNISM`-Konstanten kalibrieren,
  ggf. `ENABLE_INTRADAY_OPPORTUNISM=1` setzen, PR aktualisieren → Merge & Squash.
- Trailing-Stop / Intent-Event-Stream / `/status` bleiben eigene Folge-PRs (MASTERPLAN).
