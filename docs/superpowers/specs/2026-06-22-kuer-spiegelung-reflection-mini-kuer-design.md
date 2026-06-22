# Spec — Kür-Spiegelung, Reflection-Loop & opportunistische Mini-Kür

Stand 2026-06-22 · Status: Entwurf · Ansatz A (geteilte Builder/Felder, getrennte
Orchestratoren). Baut auf der bestehenden Kandidatenkür (`src/paper/select.ts`) und dem
gegateten Intraday-Opportunismus (`src/paper/intraday.ts`, ADR-Reihe Stufe 1–3) auf.

## Motivation

Drei zusammenhängende Verbesserungen, voller Fokus Paper-Trading:

1. **Spiegelung:** Die internen Kür-Stufen (Research-Dossier + Bull/Bear-Debatte) landen
   heute nur im KuerArtifact / der Depot-UI, nicht im Telegram-Chat. Telegram zeigt nur die
   Opus-Entscheidung (`formatKuer`, `format.ts:81`). Der Chat soll ein verdichtetes,
   trading-getriebenes Briefing der Herleitung bekommen.
2. **Reflection-Loop:** Mr Ape soll aus den eigenen geschlossenen Trades lernen — der
   Qualitätshebel aus dem TradingAgents-Muster (realisiertes Ergebnis zurück in die
   Entscheidung). Hier kostenfrei als strukturierter Track-Record, den Opus inline reflektiert.
3. **Opportunistische Mini-Kür:** Der Intraday-Pfad ist heute ein einzelner Sonnet-Call
   (`tick.ts:72`). Eine erkannte Chance soll künftig eine echte Mini-Kür durchlaufen
   (Sonnet-Research → **Opus**-Entscheidung) und sich im Chat spiegeln, damit man sieht,
   wann diese Prozesse live laufen.

## Baustein 1 — Reflection / Track-Record (kostenfrei, aus `portfolio.history`)

Kein neuer Store: `Portfolio.history: ClosedTrade[]` (`types.ts:109`) ist bereits die
Quelle. Eine kleine Datenmodell-Ergänzung trägt die ursprüngliche These mit.

### Datenmodell
- `ClosedTrade` (`types.ts:86`) bekommt `thesis: string`. Beim Schließen einer Position
  wird sie aus `Position.thesis` (`types.ts:74`) übernommen. Bestehende, vor-These-Depots:
  Feld kann beim Lesen fehlen → defensiv als `""` behandeln (kein Migrationszwang).

### Builder — `src/paper/format.ts` (rein)
- `renderTrackRecord(history: ClosedTrade[], limit: number): string` → Block
  „## Bisheriger Track-Record (Lehren)". Pro (jüngstem) geschlossenem Trade eine Zeile:
  `AAPL long, These „…" → Take-Profit, P&L +6.2% (3 Tage)`.
  - P&L% = `pnl / stake * 100` (Vorzeichen wie `format.ts` `sign`).
  - Haltedauer aus `closedAt − openedAt`, gerundet auf Tage (≥1 Tag) bzw. „<1 Tag".
  - Exit-Grund aus `reason` (Mapping wie `formatEvent`: Stop-Loss / Take-Profit / LIQUIDIERT / Geschlossen).
  - Leer (`history` leer) → `"(noch keine abgeschlossenen Trades)"`.
  - `limit` begrenzt auf die letzten N (Default an der Aufrufstelle, z. B. 8).

### Einspeisung
- In `buildDecisionPrompt` (Tages-Kür, `prompts.ts:117`): neuer Eingang `trackRecordBlock`,
  als eigener Abschnitt „## Bisheriger Track-Record (Lehren)" vor dem Journal. Opus reflektiert
  beim Entscheiden selbst — **keine** zusätzlichen LLM-Calls.
- Ebenso im Opus-Prompt der Mini-Kür (siehe Baustein 3).
- Aufrufstellen (`select.ts`, `intraday.ts`) rendern den Block aus `portfolio.history`.

## Baustein 2 — Verdichtete Spiegelung (Tages-Kür → Telegram)

### Builder — `src/paper/format.ts` (rein)
- `formatDecisionMirror(dossier: Dossier | null, debate: Debate | null): string` → kompakte,
  eigenständige Nachricht. Pro Kandidat **eine** Zeile, Dossier + Debatte zusammengeführt:
  `XYZ: <angle> · Bull <…> / Bear <…>`. Fehlt zu einem Ticker die Debatte → nur `<angle>`.
  Abschluss: eine Zeile `Marktlage: <marketContext>` (falls vorhanden).
  - Header: `🦍 Mr Ape — Research & Debatte (<day>)`.
  - Beide `null` (Research fehlgeschlagen) → `""` (nichts senden).
  - Bewusst verdichtet (1 Zeile/Kandidat) → bleibt klar unter Telegrams 4096-Zeichen-Limit;
    kein Message-Splitting nötig.

### Orchestrierung — `src/paper/select.ts`
- Nach dem finalen `formatKuer`-Send (`select.ts:262`) sendet `runKuer` die Spiegelung als
  **eigene** Nachricht. **Best-effort:** in try/catch gekapselt, ein Send-Fehler wird nur
  geloggt und bricht die Kür nicht ab (Muster wie `tryDegradeAlert`/`trySaveKuer`). Leerer
  String → nicht senden.
- Dossier/Debatte werden weiterhin ins KuerArtifact gespeichert (`saveKuer`, UI unverändert).

## Baustein 3 — Opportunistische Mini-Kür (Sonnet-Research → Opus)

Aus dem einzelnen Sonnet-Call wird eine zweistufige Mini-Kür: ein fokussierter Research-Schritt,
dann die Entscheidung auf **Opus**. Die deterministischen Gates bleiben unverändert
(`intradayGateOpen`, `intraday.ts:31`): max 1 Intraday/Tag, Tages-Gesamtdeckel, keine Dopplung.

### Prompts — `src/paper/prompts.ts`
- Neu `buildIntradayDossierPrompt` (Sonnet, WebSearch): fokussiertes Mini-Dossier zum **einen**
  getriggerten Ticker — Angle/Katalysator/Sentiment. Liefert dasselbe `Dossier`-JSON-Format
  (1 Kandidat) wie die Tages-Research, damit `parseDossier` wiederverwendet wird.
- `buildIntradayPrompt` (`prompts.ts:260`) wird zum **Opus-Entscheider**-Prompt: zusätzlich
  ein „## Research zur Chance" (Mini-Dossier) und der „## Track-Record (Lehren)"-Block. Regeln
  unverändert: nur Limit, stopLoss Pflicht, höchstens 1 Trade, These muss den Trigger zitieren.

### Orchestrierung — `src/paper/intraday.ts` (`runIntradayOpportunity`)
Reihenfolge bei offenem Gate:
1. **Start-Ping** nach Telegram: `🦍 Mr Ape prüft Intraday-Chance <ticker> (<trigger.note>) …`
   (best-effort; signalisiert, dass der Prozess live läuft). Der bestehende `⚡ Setup`-Alert
   des Radars (`radar.ts:51`) bleibt davor.
2. **Research** (Sonnet, WebSearch) → Mini-Dossier. Scheitert/limitiert sie → sanfte
   Degradation: Opus entscheidet auf Trigger+Kursen, Dossier-Block = Degrade-Hinweis (Muster
   `renderDossier(null)` aus `select.ts`).
3. **Entscheidung** (Opus) mit Mini-Dossier + Track-Record + Depot + Kursen.
4. **Ergebnis — IMMER eine Telegram-Meldung:**
   - Order gesetzt → `🟢 Intraday-Limit gesetzt …` (heutiger Text, `intraday.ts:118`).
   - Opus lehnt ab / leeres trades-Array → `🦍 Mr Ape — Intraday <ticker>: kein Trade. <journal>`.
   - Order vom Risk-Check abgelehnt → Meldung mit Grund.
   - Opus-Limit/Timeout → `⚠️ Mr Ape — Intraday <ticker>: nicht entschieden (limitiert/Timeout)`.
     **Nie ein geratener Trade.**
   - Market-Vorschlag (nur Limit erlaubt) → Meldung „verworfen: nur Limit".
- Journal-Einträge wie heute zusätzlich (`appendJournal`).

### Verdrahtung — `src/paper/tick.ts`
- `runIntradayOpportunity` bekommt zwei Runner: `researchRunner`
  (`createClaudeRunner({ model: "sonnet", allowedTools: ["WebSearch", "Skill"], label: "Intraday-Research", … })`)
  und `decideRunner` (`createClaudeRunner({ model: "opus", label: "Intraday-Entscheidung", … })`),
  plus `readJournalTail` (bereits in `shared`). Der bisherige einzelne `runner` entfällt.

## Fehlerbehandlung, Kosten, Nicht-Ziele

- **Best-effort, nie blockierend:** Spiegelung (Baustein 2), Start-Ping (Baustein 3 Schritt 1)
  in try/catch — Fehler nur geloggt. Die **Ergebnis-Meldung** der Mini-Kür ist garantiert
  (sie ist Teil des Hauptpfads, nicht best-effort).
- **Kosten:** Mini-Kür = +1 Opus-Call **pro gegatetem Trigger** (vorher 1 Sonnet). Gates
  unverändert, daher gedeckelt. Reflection + Spiegelung kosten nichts (kein Extra-Call).
- **Sprache:** Alle neuen Freitexte folgen `env.language` (`prompts.ts` `jsonOnly`-Muster).
- **Nicht-Ziele (bewusst ausgelassen, YAGNI):** Alpha vs. Benchmark im Track-Record
  (Folge-PR); separater LLM-Reflexionsschritt; voller Bull/Bear-Debattenschritt in der
  Mini-Kür; Änderung der Depot-UI.

## Tests (TDD red-green)

- `renderTrackRecord`: leer; ein/mehrere Trades; P&L-Vorzeichen; Haltedauer-Rundung;
  Exit-Grund-Mapping; `limit`-Begrenzung; fehlendes `thesis`-Feld defensiv.
- `formatDecisionMirror`: voll (Dossier+Debatte); Dossier ohne passende Debatte;
  beide `null` → `""`; Marktlage-Zeile.
- `thesis`-Propagierung: Position-Close schreibt `Position.thesis` in `ClosedTrade.thesis`
  (`engine.ts`-Test).
- Mini-Kür (`intraday.test.ts`): Research ok → Opus entscheidet → Order + Ergebnis-Meldung;
  Research fehlgeschlagen → Opus entscheidet trotzdem (Degrade-Hinweis); Opus lehnt ab →
  „kein Trade"-Meldung; Opus-Limit → „nicht entschieden"-Meldung, kein Trade; Start-Ping
  gesendet; Gate geschlossen → kein LLM-Call, keine Meldung.
- `select.ts`-Test: Spiegelung wird nach `formatKuer` gesendet; Send-Fehler bricht Kür nicht.
