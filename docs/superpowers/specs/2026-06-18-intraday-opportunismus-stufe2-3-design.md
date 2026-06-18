# Spec — Intraday-Opportunismus Stufe 2 (Setup-Radar) + Stufe 3 (aktive Eröffnung)

Stand 2026-06-18 · Status: Entwurf · Brainstorm:
`docs/superpowers/brainstorms/2026-06-18-intraday-opportunismus.md`. Baut auf Stufe 1
(Limit-Leiter + TTL) auf.

## Stufe 2 — Setup-Radar (deterministisch, null LLM, kein Auto-Trade)

Eine kleine, einmal täglich geseedete Watchlist nicht-gehaltener Ticker bekommt
**close-basierte** deterministische Trigger; ein Trigger **meldet** nach Telegram (kein
automatischer Trade). Reuse der Tick-/Quote-Maschinerie.

### Datenmodell
- `WatchlistEntry { ticker; side?; note; addedDay; firedKinds: SetupKind[] }` —
  `firedKinds` verbraucht je Trigger-Art **einmal pro Tag** (kein Spam).
- `WatchlistState { day; entries; lastQuotes? }` — `lastQuotes` = Quotes des vorigen
  Watchlist-Ticks (für Cross-Erkennung). Wechselt der Tag, wird die Watchlist neu geseedet.
- Persistenz `src/paper/watchlist.ts`: `loadWatchlist(dir)`, `saveWatchlist(dir, state)`
  (atomar wie `savePortfolio`), Datei `data/watchlist.json` (gitignored).

### Erkennung — `src/paper/setupRadar.ts` (reine Funktionen)
- `SetupKind = "ema-cross-up" | "ema-cross-down" | "rsi-overbought" | "rsi-oversold"`.
- `detectSetups(entries, quotes, prevQuotes): SetupTrigger[]` —
  - **EMA-Cross:** `prev.ema10 <= prev.ema20 && now.ema10 > now.ema20` (up; down gespiegelt).
    Braucht ema10+ema20 in **beiden** Snapshots, sonst kein Signal (degradierte Quelle).
  - **RSI-Extrem:** `prev.rsi < 70 && now.rsi >= 70` (overbought); `< 30`-Spiegel (oversold).
  - Nur Trigger zurückgeben, deren `kind` noch nicht in `entry.firedKinds` des Tages steht.
- `SetupTrigger { ticker; kind; price; note }`.

### Seeding (Kür)
`select.ts` bekommt einen `saveWatchlist`-Dep: nach der Entscheidung werden die
**Dossier-Kandidaten ohne platzierte Order** als Watchlist-Einträge gespeichert (mit dem
Dossier-`angle` als `note`). Fehler dürfen die Kür nie brechen (try/catch wie `saveKuer`).

### Tick-Integration (`tickPipeline.ts`)
Nach dem Monitor-/Manager-Pfad, nur wenn eine Watchlist für **heute** existiert:
1. Quotes für Watchlist-Ticker holen (separater Scanner-POST; Fehler → still überspringen).
2. `detectSetups(entries, quotes, state.lastQuotes)`.
3. Neue Trigger nach Telegram posten (`⚡ Setup AAPL: EMA10×EMA20 ↑, RSI 63 …`) + ins Journal;
   `firedKinds` ergänzen.
4. `lastQuotes` aktualisieren, `saveWatchlist`.

## Stufe 3 — aktive Eröffnung (LLM, **gegated**, Default OFF)

Feuert ein Setup-Trigger UND ist `ENABLE_INTRADAY_OPPORTUNISM` aktiv, darf **ein** fokussierter
LLM-Aufruf **eine** Limit-Order auf dem getriggerten Ticker setzen — im **eigenen
Intraday-Budget-Tier**, mit harten Guardrails. Bewusst Opt-in: ohne Flag passiert nichts.

### Guardrails (alle hart)
- **Flag:** `ENABLE_INTRADAY_OPPORTUNISM` (Default OFF). Aus → reiner Setup-Radar (Stufe 2).
- **Eigenes Budget-Tier:** `GUARDRAILS.maxIntradayTrades = 1`. Zusätzlich gilt der
  Tages-Gesamtdeckel (`maxTradesPerDay`) weiter — Intraday eröffnet nur, wenn BEIDE Budgets
  Luft haben („Kür zuerst, Intraday füllt den Rest").
- **Nur Limit:** Intraday-Orders sind immer `entryType:"limit"` (kein Market-Late-Fill).
- **Keine Dopplung:** kein Open, wenn schon eine Position/Order auf dem Ticker existiert.
- **Quelle markiert:** `EntryOrder.source` / `Position.source` `"kuer" | "intraday"`;
  `intradayTradesPlacedToday(p, day)` zählt nur die Intraday-Quelle.
- **Nie raten:** unlesbare/leere LLM-Antwort → kein Trade (wie Kür). Limit/Timeout des Runners
  → stille Degradation, deterministischer Schutz läuft weiter (Finding E).

### `src/paper/intraday.ts` — `runIntradayOpportunity(trigger, deps)`
1. Vorab-Gates (deterministisch): Flag an, Intraday-Budget frei, Tagesbudget frei, keine
   bestehende Position/Order auf dem Ticker. Sonst still return.
2. `buildIntradayPrompt(trigger, portfolioBlock, quotesBlock, journalTail, language)` — knapp:
   „Ein deterministischer Setup-Trigger ist gefeuert. Entscheide, ob du EINE Limit-Order setzt
   (oder nichts). Die These MUSS den Trigger zitieren." JSON-Vertrag = das Kür-`trades`-Format,
   aber **max. 1** Trade, `entry` muss Zahl (Limit) sein.
3. `parseDecision` → ersten Trade nehmen; `entry==="market"` → ablehnen (Telegram-Hinweis).
4. `placeOrders(..., { now, day, source:"intraday" })` mit Intraday-Budget-Vorprüfung.
5. Telegram + Journal: gesetzte Order oder „nichts" (mit Begründung).

### Tick-Integration
In `tickPipeline.ts` nach dem Posten der Trigger (Stufe 2): wenn Flag an, je neuem Trigger
(begrenzt durch `maxIntradayTrades`) `runIntradayOpportunity` aufrufen. Der LLM-Runner ist ein
neuer Dep (Sonnet) mit demselben Watchdog/Limit-Handling wie der Manager.

## Betroffene Dateien
| Datei | Änderung |
|---|---|
| `src/paper/types.ts` | `EntryOrder.source`, `Position.source`, `GUARDRAILS.maxIntradayTrades`; Watchlist-/Setup-Typen ggf. eigene Datei |
| `src/paper/watchlist.ts` (neu) | Persistenz + Seeding-Helfer |
| `src/paper/setupRadar.ts` (neu) | reine Trigger-Erkennung |
| `src/paper/intraday.ts` (neu) | `runIntradayOpportunity` (Stufe 3) |
| `src/paper/engine.ts` | `placeOrders` `source`-Opt; `intradayTradesPlacedToday` |
| `src/paper/prompts.ts` | `buildIntradayPrompt` |
| `src/paper/select.ts` | Watchlist-Seeding |
| `src/paper/tickPipeline.ts` | Radar + (gegated) Intraday-Open |
| `src/paper/tick.ts` | Watchlist-Deps + Intraday-Runner + Flag |
| `src/config/env.ts` | `intradayOpportunismEnabled` |
| jeweils `*.test.ts` | TDD |

## Sichtbarkeit / Guardrail-Checkliste
- Setup-Trigger posten (Stufe 2); Intraday-Opens posten inkl. Ablehnung (Stufe 3) — analog
  ADR-0003-Wake-Transparenz „ein Wake ist immer sichtbar".
- Stille bleibt: keine Watchlist/kein Trigger → nichts; Flag aus → keine LLM-Last.
- Close-only: alle Trigger feuern auf `q.close` (ADR 0001 `high`/`low` bleibt Fill/Stop).
