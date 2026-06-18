# Spec — Intraday-Opportunismus Stufe 1: Limit-Leiter + Multi-Day-TTL

Stand 2026-06-18 · Status: Entwurf · Brainstorm:
`docs/superpowers/brainstorms/2026-06-18-intraday-opportunismus.md` (Beschluss: gestaffelt,
Stufe 1 zuerst, **null neue LLM-Calls**).

Ziel: Die einmal-tägliche Kandidatenkür platziert ihre Einstiege als **geduldige
Limit-Geometrie** statt als Market-Order — eine **Limit-Leiter** (mehrere Niveaus pro
Conviction, „füllt eine, verfallen die anderen") und optional über **mehrere Tage** gültig.
Das löst Finding B (Late-Fill ~16:34) gleich mit: Der Einstieg geschieht zur richtigen Zeit
und zum richtigen Kurs, nicht erzwungen ~1 h nach Open. Rein deterministisch — die Engine
füllt über die bestehende `touched()`-Regel (ADR 0001), kein zusätzlicher LLM-Aufruf.

## Nicht-Ziele (bewusst außerhalb Stufe 1)

- **Aktive Intraday-Eröffnung** (Manager darf öffnen, Zwischen-Kür) — Stufe 3, gegated.
- **Setup-Radar** (Watchlist-Trigger nach Telegram) — Stufe 2.
- **Deterministischer Trailing-Stop** — eigener vertagter Beschluss (Nautilus).
- **Gruppen-als-ein-Trade-Budget** — eine Leiter belegt so viele der 3 Tages-Slots, wie sie
  Rungs hat (s. „Budget" unten). Bewusst einfach & ehrlich für v1.

## Architektur-Entscheidungen

### 1. Multi-Day-TTL über additives `expiresOn` — NICHT über `order.day`

`EntryOrder.day` ist heute **doppelt belegt**: Erstell-/Handelstag (zählt im
`tradesPlacedToday`-Budget über `o.day === day`) **und** Verfallstag (Verfall bei
`order.day <= opts.day`). Würde man für TTL einfach `order.day` in die Zukunft setzen, zählte
die Order nicht mehr gegen das Tagesbudget (`o.day !== day`) — ein Bug. Verifiziert:
`engine.ts:175/249/272`, Test `engine.test.ts:249` (Budget) und `:427` (future-dated Order
überlebt bereits).

**Lösung (additiv, abwärtskompatibel):**
- Neues optionales Feld `EntryOrder.expiresOn?: string` (Berlin-Tag `YYYY-MM-DD`).
- `day` bleibt unverändert = Erstell-/Handelstag (Budget-Zählung unangetastet).
- Verfalls-Check wird `(o.expiresOn ?? o.day) <= opts.day` an **beiden** Stellen
  (`applyTick` Z. 175, `expireDayOrders` Z. 249). Ohne `expiresOn` exakt heutiges Verhalten
  → alle Bestands-Tests bleiben grün.
- Neue reine Helfer-Funktion `addBerlinDays(day: string, n: number): string` (Datums-Arithmetik
  auf dem `YYYY-MM-DD`-String via UTC-Mitternacht; keine TZ-Drift, da reiner Datums-String).

**Decision-Vertrag:** `TradeDecision.ttlDays?: number` (Opus darf es setzen; Default 1).
`placeOrders` berechnet `expiresOn = ttlDays > 1 ? addBerlinDays(opts.day, ttlDays - 1) : undefined`.
`ttlDays` wird auf **[1, 5]** geklemmt (Round, Untergrenze 1, Obergrenze 5). Parser
`decision.ts` liest `ttlDays` (forgiving: fehlt/ungültig → undefined → Default 1).

### 2. Limit-Leiter über `rungGroup` + deterministisches Mutual-Cancel

Opus platziert eine Leiter, indem es **mehrere Limit-Trades auf denselben Ticker + dieselbe
Seite** in einer Entscheidung ausgibt (z. B. AAPL long Limit 100 / 98 / 96). Das nutzt das
bestehende `trades`-Array — **kein neues Gruppierungs-Feld im Vertrag**.

- Neues optionales Feld `EntryOrder.rungGroup?: string`.
- `placeOrders` gruppiert **akzeptierte Limit-Orders** (nicht Market) nach `ticker+side`
  innerhalb **dieses** Aufrufs; bei ≥ 2 Orders je Gruppe bekommen sie eine gemeinsame
  `rungGroup`-Id (z. B. `${ticker}-${side}-${day}-ladder`). Einzelne Orders: kein `rungGroup`.
- **Mutual-Cancel in `applyTick`:** Füllt ein Order einer Gruppe (wird Position), werden die
  übrigen offenen Orders derselben `rungGroup` **storniert** (Stake zurück, Event
  `order-expired`). Greifen in **einem** Tick mehrere Rungs (Kurs durchläuft mehrere Niveaus),
  füllt der **erste in Platzierungsreihenfolge**, der Rest storniert — kein
  Mehrfach-Einstieg/Overexposure. (Prompt weist Opus an, Rungs **vom Einstieg-nächsten zum
  -fernsten** zu listen, damit die realistische Rung füllt.)

**Stake/Reservierung:** Jede Rung reserviert ihren eigenen Stake (≤ 20 % Equity, harte
Guardrail unverändert). Eine 3-Rung-Leiter bindet temporär bis zu 3 × Stake, bis eine füllt
oder alle verfallen — für ein Spielgeld-Depot intraday akzeptabel; das freie Guthaben ist die
natürliche Obergrenze (eine Rung ohne Deckung wird wie heute mit „kein freies Guthaben"
abgelehnt). Beim Fill wird eine Rung zur Position, die Geschwister geben ihren Stake frei.

**Budget:** `tradesPlacedToday` zählt unverändert pro Order/Position/Close. Eine 3-Rung-Leiter
belegt also 3 der 3 Tages-Slots; füllt eine + 2 stornieren, zählt danach die 1 Position. Das
ist die bewusste v1-Semantik: „3 Order-Platzierungen/Tag" — eine Leiter ist eine konzentrierte
Conviction, die das Budget ausgibt. (Verfeinerung „Gruppe = 1 Trade" ist ein möglicher
Folge-Schritt, nicht v1.)

### 3. Prompt-Schärfung (Opus-Entscheider)

`buildDecisionPrompt` wird ergänzt (Freitext Deutsch, JSON-Vertrag unverändert bis auf das
optionale `ttlDays`):
- **Limit bevorzugen:** „Bevorzuge Limit-Einstiege auf konkreten Niveaus (z. B. an EMA20,
  jüngstem Pullback-Tief, RSI-Rücksetzer) gegenüber Market — so füllt die Order zum richtigen
  Kurs im Tagesverlauf, nicht erzwungen zum verzögerten Open."
- **Leiter erklären:** „Mehrere Limits auf denselben Ticker/dieselbe Seite bilden eine Leiter
  (nächstes Niveau zuerst listen); füllt eine, verfallen die anderen automatisch. So fängst du
  einen Pullback, ohne mehrfach einzusteigen."
- **TTL erklären:** „Optional `ttlDays` (1–5): wie viele Handelstage die Order gültig bleibt
  (Default 1 = nur heute). Für geduldige Setups 2–3; vermeide zu lange TTL."
- Regelblock + JSON-Beispiel um `ttlDays` ergänzt.

`format.ts` `orderLine`: zeigt den Gültigkeits-Tag aus `expiresOn ?? day` (statt fix `day`),
damit Telegram/Journal/Prompt die mehrtägige Gültigkeit korrekt ausweisen.

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/paper/types.ts` | `EntryOrder.expiresOn?`, `EntryOrder.rungGroup?`, `TradeDecision.ttlDays?` |
| `src/paper/engine.ts` | `addBerlinDays`; `placeOrders` (expiresOn, rungGroup-Auto-Gruppierung, ttlDays-Klemmung); `applyTick`/`expireDayOrders` (`expiresOn ?? day`, Mutual-Cancel) |
| `src/paper/decision.ts` | `parseDecision` liest `ttlDays` |
| `src/paper/prompts.ts` | `buildDecisionPrompt` (Limit/Leiter/TTL-Steuerung + JSON-Beispiel) |
| `src/paper/format.ts` | `orderLine` zeigt `expiresOn ?? day` |
| jeweils `*.test.ts` | TDD-Tests pro Increment |

## Edge-Cases (Tests)

- **TTL Default:** kein `ttlDays`/`expiresOn` → exakt heutiges Verhalten (alle Bestands-Tests grün).
- **TTL Mehrtag:** `ttlDays:2` an Tag D → überlebt Close von D, verfällt an D+1; `tradesPlacedToday`
  zählt sie nur an D.
- **TTL-Klemmung:** `ttlDays:0`→1, `ttlDays:99`→5, `ttlDays:2.6`→3 (Round).
- **Leiter Mutual-Cancel:** 2 Long-Limits AAPL @100/@98; Kurs berührt 100 → eine Position, die
  @98-Order storniert + Stake zurück.
- **Leiter Same-Tick-Mehrfachberührung:** Kurs gappt durch 100 und 98 → nur die erste füllt,
  die zweite storniert.
- **Keine Fehl-Gruppierung:** ein einzelnes Limit + ein Market auf AAPL long → kein `rungGroup`
  am Market; ein einzelnes Limit bleibt ungruppiert.
- **`orderLine`:** mehrtägige Order zeigt den `expiresOn`-Tag.

## Sichtbarkeit / Guardrail-Checkliste (aus dem Brainstorm)

- **Slippage:** Limit füllt exakt aufs Niveau, kein Half-Spread (ADR 0001/0002) — Stufe 1 ist der
  Slippage-Gewinn. Ehrlicher Trade-off (Limit verpasst bei 1 ¢ Vorbeilauf) → Prompt rät zu
  **leicht gestaffelten** statt exakten Niveaus.
- **Over-Trading:** keine neue Eröffnungs-Quelle (nur die Kür platziert), Budget hart bei 3.
- **Nie raten:** strikte JSON-Validierung unverändert; `ttlDays` forgiving auf Default.
- **Sichtbarkeit:** Kür-Orders posten wie heute (`formatKuer`); Rung-Stornos erscheinen als
  `order-expired`-Zeile direkt nach dem Fill. Mehrtägige Limits bleiben still bis Fill/Verfall.
- **Close-only / TTL-Semantik:** unverändert deterministisch; mehrtägige Order belegt keinen
  Manager-Slot, verfällt still.
