# Brainstorm 2026-06-18 — Intraday-Opportunismus: „nicht nur zum Open suchen"

Nutzer-Frage: Wir suchen Trade-Kandidaten heute **nur einmal täglich** (Kandidatenkür
am PreUS-Scan). Wir sollten **opportunistischer** sein — auch untertags auf Setups
(Katalysator, Ausbruch, News) reagieren können. Die offene Frage: bauen wir **feste
Zwischenscans → Kür → Ordereröffnung**, oder gibt es einen besseren Weg?

Diese Runde wurde mit einem Verifikations- + Jury-Workflow geführt (6 Code-Constraints
adversarial gegen die Quelle geprüft, 4 Architekturen unabhängig entworfen und auf einer
Rubrik bewertet, plus ein Vollständigkeits-Kritiker). Ergebnis: ein **gestaffeltes
Opportunismus-Modell** mit klarer „zuerst"-Empfehlung. Diese Datei ist der Beschluss; der
Code folgt in eigenen PRs (Workflow: brainstorming → spec → writing-plans → executing-plans).

Dies konkretisiert **Finding D / Backlog B4** (MASTERPLAN §3b) und gliedert sich an die
PR `feat/claude-health-ema-wake-transparenz` (EMA-Trend, Wake-Transparenz, Claude-Health) an.

---

## 1. Wo wir heute stehen (bzgl. „nur zum Open suchen")

Die einzige Stelle, an der **neue** Positionen/Orders entstehen, ist die **Kandidatenkür** —
einmal pro Tag, synchron hinten am PreUS-Scan (`src/scan/index.ts:90`,
`if (paperTradingEnabled && LABEL === "PreUS") runKuer(...)`). Die Kette ist lang und
seriell (Research → Debatte → Entscheidung) und landet faktisch **~16:34**, also **~1 h
nach US-Open** (Finding B, ~85 min LLM-Latenz).

Alles **danach** ist bewusst reaktiv (ADR 0003):

| Schleife | Was sie tut | Was sie NICHT tut |
|---|---|---|
| **Monitor-Tick** (jede Min., Drossel ~5 min) | Holt Kurse **inkl. EMA10/20/50/RSI**, rechnet Fills/Stops/TP/Liquidation, prüft Wake-Bänder. Rein deterministisch, kein LLM. | Eröffnet nie etwas. |
| **Manager-Tick** (Sonnet) | Ereignisgesteuert (Fill/Stop/Liquidation/Band-Riss/Close): zieht Stops nach, setzt TP/Bänder, schließt, streicht Orders. | **Darf keine neuen Positionen eröffnen** (`Adjustment`-Union kennt nur set_stop/set_take_profit/set_wake_band/close_position/cancel_order). |

**Kernbefund:** Wir haben bereits einen schnellen, billigen, deterministischen Intraday-Kern
— er **verwaltet** aber nur, er **sucht und eröffnet nichts**. Das ist die Lücke, die der
Nutzer spürt.

### Drei Bausteine liegen schon bereit — ohne Proxy (B1), ohne EMA-8 (B2)

Verifiziert gegen die Quelle:

1. **Limit-Orders funktionieren end-to-end.** `placeOrders` akzeptiert `entry:number` →
   `entryType:"limit"`; `applyTick` füllt über die konservative `touched()`-Regel (ADR 0001),
   ohne Slippage, garantiert auf dem Level (`engine.ts:147`, `:333`). **Aber:** jede
   unausgeführte Order verfällt am **Close-Tick ihres Erstelltags** (`order.day <= opts.day`,
   `engine.ts:175`) — es gibt **kein mehrtägiges TTL**.
2. **Freie, VPS-erreichbare Intraday-Kandidatenlisten.** `rsScreener.ts` liefert
   `fetchRsLongShort`/`fetchReadyToTrend`/`fetchStrongDaily`/`fetchMomentum` über den
   TradingView-Scanner — free, keine Auth, kein Proxy.
3. **Deterministischer Trend-Read.** `trend.ts` (`trendTag` up/down/flat/unknown aus EMA10/20)
   und EMA/RSI-Spalten sind seit der EMA-PR im Tick verfügbar — heute nur menschenlesbar im
   Prompt, noch nicht in der deterministischen Logik genutzt.

### Verifizierte Constraints (alle gegen den Code bestätigt)

| # | Behauptung | Urteil | Konsequenz fürs Design |
|---|---|---|---|
| 1 | Manager-Tick hat **keinen** Pfad, zu eröffnen (`Adjustment`-Union = 5 Typen). | **wahr** | „Manager darf öffnen" braucht neuen Adjustment-Typ + Parser + Engine + Prompt — und durchbricht die bewusste Trennung Manager=Risiko / Opus=Entscheider. |
| 2 | Limit-Orders ok; Order verfällt **am selben Tag**; kein Multi-Day-TTL. | **größtenteils wahr** | Verfalls-Check ist `order.day <= opts.day`. Test `engine.test.ts:427` „keeps orders from a future day" beweist: **future-dated Orders überleben bereits** → ein TTL ist eine **kleine** Änderung (order.day weiter in die Zukunft setzen). |
| 3 | Das **3-Trade-Tagesbudget** wird automatisch über **beliebig viele** `placeOrders`-Aufrufe/Tag geteilt (`tradesPlacedToday` zählt jedes Mal neu). | **wahr** | Ein zweiter, intraday `placeOrders`-Aufruf respektiert das Restbudget **automatisch** — sofern das Portfolio zwischen den Aufrufen neu geladen wird. |
| 4 | Wake-Bänder feuern **nur auf `q.close`**, nur an **gehaltenen** Positionen; keine Watchlist-Infrastruktur. | **größtenteils wahr** | Die Wake-**Logik** ist wiederverwendbar; was fehlt, ist die **Persistenz- + Quote-Schicht** für nicht-gehaltene Ticker. |
| 5 | EMA/RSI + Trend-Tag + rsScreener sind **jetzt** nutzbar, kein B1/B2 nötig. | **wahr** | Eine deterministische Setup-Erkennung ist **heute** baubar. |
| 6 | ClaudeError limit/timeout ist in **Entscheidung** + **Manager** verdrahtet, aber **nicht** in Research/Debatte. | **größtenteils wahr** | Jeder neue Intraday-LLM-Call in einer Research-artigen Phase würde Limits **nicht** spezifisch melden, sondern generisch degradieren → vor aktiver Schleife nachziehen. |

---

## 2. Die vier Wege (unabhängig entworfen + bewertet)

Rubrik 1–5 (höher = besser): **Limit-Sicherheit** (5h-Subscription-Limit-Risiko),
**Reuse** (vorhandene Maschinerie / wenig neuer Code), **Roadmap-Fit**, **Jetzt-machbar**
(ohne B1/B2), **Opportunismus-Wert**, **Disziplin** (Over-Trading-Risiko). Σ /30.

| Architektur | Kurzbeschreibung | Limit | Reuse | Roadmap | Jetzt | Wert | Diszip. | Σ |
|---|---|---|---|---|---|---|---|---|
| **A — Zwischen-Kür** | Feste Checkpoints (z. B. +90 min) lassen eine **leichte** Kür (Sonnet, ohne Debatte) laufen und eröffnen im Restbudget. Die wörtliche „Zwischenscans → Kür → Order"-Idee. | 3 | 4 | 4 | 5 | 3 | 3 | **22** |
| **B — Manager darf öffnen** | Watchlist nicht-gehaltener Ticker bekommt deterministische Setup-Trigger; ein Trigger weckt den Manager, der **eine neue Order** im geteilten Budget setzen darf (neuer `open_position`-Adjustment). | 2 | 3 | 5 | 5 | 4 | **1** | **20** |
| **C — Limit-Leiter (determ.)** | Die Kür platziert statt Market eine **Limit-Leiter** (1–3 Rungs je Kandidat, Rung-Zahl trendgesteuert); die Engine füllt sie deterministisch über 1–2 h. **Null neue LLM-Calls.** | 4 | **5** | 5 | 5 | 4 | 4 | **27** |
| **D — Geduldige Limits + TTL** | Eine Entscheidung/Tag bleibt, platziert aber **mehrtägige** Limits (`ttlDays`), die opportunistisch füllen, wenn der Kurs Tage später passt. Plus Prompt-Schärfung „Limit statt Market". | **5** | **5** | 4 | 5 | 3 | **5** | **27** |

### Warum A und B *nicht* zuerst kommen

- **A (Zwischen-Kür)** ist der teuerste Weg gegen das genau diagnostizierte Problem: er
  **wiederholt die langsame, LLM-schwere Kette** 2–4×/Tag und addiert direkt auf das
  5h-Limit (Finding B/E). Killer-Einwand des Reviewers: „Das ist nur eine teurere
  Tagesschleife — echte Intraday ist News-/Pattern-Trigger, nicht ‚um 14:45 nochmal suchen'."
- **B (Manager darf öffnen)** hat das **kritische Disziplin-Risiko** (Score 1): Der Manager
  sieht nur den Trigger + Trend-Tag, **nicht** die 85-min-Research der Kür → dünnhäutige
  Trades. Schlimmer: **Budget-Kannibalismus** — verbrennt der Manager die 3 Trades vor 15:15,
  sitzt die eigentliche Kür auf der Bank. Durchbricht zudem die bewusste Rollentrennung
  (Manager=Risiko, Opus=Entscheider). Nur mit eigenem Budget-Tier + harten Guardrails vertretbar.

### Die stärkste Gegen-Rahmung des Kritikers (übernommen)

> Intraday-Opportunismus ist **teilweise ein Wahrnehmungsproblem** („der Bot fühlt sich zu
> statisch an"), nicht nur ein Trading-Alpha-Problem. Die sicherste, billigste, am besten zur
> Kernlehre („deterministisch zuerst, LLM nur für echte Entscheidungen") passende Antwort:
> **der Bot erkennt + meldet deterministisch, der Mensch bestätigt bei Bedarf, der Bot führt
> aus** — über vorab platzierte Limits oder einen künftigen manuellen Befehl. Das löst die
> „statisch"-Wahrnehmung **ohne** LLM-Budget und **ohne** Over-Trading-Risiko.

---

## 3. Beschluss: Gestaffeltes Opportunismus-Modell

Von billig/sicher/hoher-Reuse zu teuer/riskant. **Antwort auf die Nutzer-Frage:** *Keine*
schwere parallele „Zwischenscans → Kür → Order"-Pipeline zuerst — sie multipliziert genau
das Kosten-/Limit-Problem. Stattdessen die **bereits vorhandene deterministische Maschinerie
generalisieren** und das LLM nur dort einsetzen, wo es eine echte Entscheidung gibt.

### Stufe 1 (zuerst, S-Effort, **null neue LLM-Calls**) — „geduldige Order-Geometrie" (C + D)

Der Kern, und zugleich die wörtliche Nutzer-Intuition: *„dafür sorgen wir ja eigentlich mit
angepassten Orders."*

- **Limit-Leiter aus der Kür (C):** Statt eines Market-Entry platziert Opus pro Kandidat
  1–3 **Limit-Rungs** auf gestaffelten Niveaus (z. B. Market/eng · Pullback · tieferer
  Pullback). Die Engine füllt deterministisch über 1–2 h — **eine** Rung füllt = **ein**
  Trade (Budget bleibt sauber). Rung-Zahl trendgesteuert aus `trend.ts` (starker Trend →
  mehr Rungs; flat → 1). Löst **Finding B** (der Move passiert zur richtigen Zeit statt
  erzwungen zum Open, ~16:34) und den **aktiven-genug** Teil von Finding D.
- **Mehrtägiges TTL (D):** Optionales `ttlDays` an `EntryOrder`/`TradeDecision`; `order.day`
  wird weiter in die Zukunft gesetzt. Geduldige Limits füllen über **Tage**, wenn der Kurs
  passt. Winzige Änderung — die Engine trägt future-dated Orders bereits (Test `engine.test.ts:427`).
- **Prompt-Schärfung:** `buildDecisionPrompt` ermutigt **Limit statt Market** und nennt
  konkrete Anker (EMA20, RSI, %-Abstände), damit die Limits nicht wild gesetzt werden.

Erfasst **~75–85 %** des Ziels bei **0 %** zusätzlicher LLM-Last. Höchster Reuse
(`applyTick`/`touched`/`placeOrders` praktisch unverändert), höchste Disziplin.

### Stufe 2 (low effort, **null LLM**) — „Setup-Radar" (deterministische Erkennung + Sichtbarkeit)

Adressiert die „fühlt sich statisch an"-Wahrnehmung, ohne automatisch zu handeln:

- Eine **kleine Watchlist** (einmal täglich geseedet: Kür-„fast"-Kandidaten + rsScreener-
  Momentum-Tail, in `portfolio.json` persistiert, am Close geleert).
- Der Monitor-Tick prüft auf der Watchlist **close-basierte** deterministische Trigger
  (EMA10×EMA20-Cross, RSI-Extrem, Level-Break am Close) — dieselbe Mechanik wie
  `checkWakeBands`, nur für nicht-gehaltene Ticker.
- Ein Trigger **postet nach Telegram** und ins Journal („⚡ Setup AAPL: EMA-Cross @ 15:47,
  RSI 63, ↑") — **er handelt nicht automatisch**. Der Nutzer kann per `/strategie TICKER`
  (oder künftig `/trade`) reagieren (human-in-loop).

Reuse der Wake-Logik auf der Persistenz-/Quote-Ebene; null Over-Trading-Risiko, null LLM-Kosten.

### Stufe 3 (später, opt-in, **gegated**) — aktive Eröffnung (B bzw. A)

Erst wenn Stufe 1+2 erprobt + instrumentiert sind. Voraussetzungen, ohne die wir es **nicht**
bauen:

- **Separates Intraday-Budget-Tier** (z. B. Kür 2, Intraday 1) — kein Budget-Kannibalismus.
- **Harte Guardrails:** kein Open, wenn die Kür heute schon ≥ 2 Orders hat; die Setup-These
  muss den Trigger zitieren; **Limit-Default** gegen Late-Fill.
- **Research/Debatte limit-aware** machen (Constraint #6) — bevor irgendein Intraday-LLM-Call
  scharf geschaltet wird.

---

## 4. Was das Dokument/der Code zwingend adressieren muss (Kritiker-Checkliste)

Diese Punkte sind **bindend** für jede Spec, die aus diesem Brainstorm folgt:

1. **Budget-Split.** `GUARDRAILS.maxTradesPerDay = 3` ist ein **harter Berlin-Tages**-Deckel.
   Default-Philosophie: **Kür zuerst, Intraday füllt den Rest.** Aktive Eröffnung (Stufe 3)
   nur mit eigenem Tier.
2. **Slippage/Fill-Timing.** Market-Entries kosten halben Spread; ein 16:34-Market liegt ~1 h
   vom Entscheidungskurs weg. → Stufe 1 setzt **Limit als Default** (kein Slippage, garantiertes
   Level). Den Trade-off (Limit verpasst bei 1 ¢ Vorbeilauf) ehrlich benennen → bewusst
   **leicht gestaffelte** Limits statt eines exakten Niveaus.
3. **Over-Trading/Chasing.** Regeln in der Engine/Prompt: **keine neue Order auf einen Ticker,
   auf dem schon ein unausgeführtes Kür-Limit hängt**; absoluter Intraday-Cap; keine
   Revenge-Re-Entries auf frisch geschlossene Ticker.
4. **Sichtbarkeit (ADR-0003-Präzedenz „ein Wake ist immer sichtbar").** Kür-Orders sind
   sichtbar (same-day); Fills posten immer; Setup-Radar-Trigger posten; Intraday-Opens (Stufe 3)
   posten inkl. Ablehnungen. Stille mehrtägige Limits dürfen still bleiben **bis** zum Fill.
5. **Nie einen Trade raten.** Die strikte JSON-Validierung (`decision.ts`, „malformed → null,
   nie geraten") gilt für jede neue Eröffnungs-Quelle. LLM-Mehrdeutigkeit → **kein Trade +
   Alert**, nie Stille.
6. **Close-only-Semantik.** Deterministische Trigger (Wake-Bänder, Setup-Radar) feuern **nur
   auf `q.close`**. `high`/`low` bleiben der Fill-/Stop-Evidenz vorbehalten (ADR 0001). Keine
   Intraday-High/Low-Breakout-Trigger ohne expliziten Architektur-Beschluss.
7. **TTL-Semantik.** Mehrtägige Orders zählen **nur am Erstelltag** gegen das Budget; eine
   offene Multi-Day-Order belegt **keinen** Manager-Slot; verfällt sie ungenutzt, **still**.
8. **Watchlist-Scope.** Watchlist = Kür-Dossier + rsScreener-Tail, **einmal täglich** zur Kür
   geseedet, für das Intraday-Fenster persistiert, am Close geleert (nicht über Tage stale).
9. **No-LLM-Fallback (Finding E).** Limit während der Kür → Tag fällt aus (bestehende Logik).
   Limit/Timeout während Intraday-LLM → **stille Degradation**, deterministisches
   Stop-/Band-Management läuft weiter, **kein** Trade auf einem limitierten Call.

---

## 5. Einordnung in die Roadmap + allgemeine Verbesserungen

Stufe 1 ist die natürliche Fortsetzung der **bereits beschlossenen** nächsten Schritte und
löst Finding B gleich mit:

- **Limit-statt-Market für Kür-Entries** (Finding B, Option 2) — Fundament von Stufe 1, zugleich
  der höchste Einzel-Hebel gegen Late-Fill.
- **Deterministischer Trailing-Stop** (`trailBy`, vertagter Nautilus-Beschluss) — senkt
  LLM-Abhängigkeit, schnellere Reaktion; bildet die **Exit-Seite** der Order-Geometrie. Paart
  natürlich mit Stufe 1.
- **Intent-Event-Stream** (vertagter Beschluss) — sauberes Substrat: jede Eröffnung/jedes Limit
  ist ein typisiertes Intent-Event, aus dem Telegram/UI/künftiger Broker-Adapter rendern. Der
  richtige Unterbau, **bevor** Stufe 3 aktiv eröffnet.
- **`/status` + opt-in Heartbeat** (vertagt) — Sichtbarkeit; zugleich der Kanal für die
  Setup-Radar-Meldungen (Stufe 2).
- **Research/Debatte limit-aware** (Constraint #6) — Härtung, Voraussetzung für Stufe 3.
- **Trend-Tag in die deterministische Logik** — heute nur menschenlesbar; speist Rung-Zahl
  (Stufe 1) und Setup-Radar (Stufe 2).

**Empfohlene Reihenfolge:** Stufe 1 (C+D) → Trailing-Stop → Setup-Radar (Stufe 2) →
Intent-Stream → (B1 Proxy für echte Candles/Sentiment) → Stufe 3 (aktive Eröffnung, gegated).

---

## 6. Offene Entscheidungen für die Spec

- **Stufe-1-Scope:** Nur die Limit-Leiter (C), nur das TTL (D), oder beides gebündelt? (Empf.:
  beides — sie sind komplementär und teilen sich die Prompt-/`EntryOrder`-Änderung.)
- **Rung-Zahl-Heuristik:** fix pro Trend-Zustand (flat→1, up→2, stark→3) oder von Opus
  vorgeschlagen + deterministisch gedeckelt?
- **`ttlDays`-Default + Obergrenze** (Vorschlag: Default 1, max 3–5; Prompt warnt vor zu langen TTL).
- **Setup-Radar jetzt mitnehmen** oder als eigener kleiner Folge-PR nach Stufe 1?
- **Telegram-Lautstärke** des Setup-Radars (jeder Trigger vs. gedrosselt, analog 15-min-Band-Cooldown).
