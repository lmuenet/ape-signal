# Plan — Intraday-Opportunismus Stufe 1 (Limit-Leiter + TTL)

Spec: `docs/superpowers/specs/2026-06-18-intraday-opportunismus-stufe1-design.md`.
Workflow: TDD red→green, **ein Commit pro Task**, `npm test` grün vor jedem Commit.
Branch: `feat/intraday-opportunismus-staffelung` (setzt auf der EMA-PR auf).

## Task 1 — Multi-Day-TTL (`expiresOn` + `ttlDays`)

1. **types.ts:** `EntryOrder.expiresOn?: string`; `TradeDecision.ttlDays?: number`. Doc-Kommentar:
   `day` = Erstell-/Handelstag (Budget); `expiresOn` = Verfallstag (Default = `day`).
2. **engine.ts:** reine `addBerlinDays(day, n)` (UTC-Mitternacht-Arithmetik).
3. **engine.ts `placeOrders`:** `ttlDays` klemmen auf [1,5] (Round); `expiresOn` setzen, wenn > 1.
4. **engine.ts `applyTick` (Z. 175) + `expireDayOrders` (Z. 249):** Verfall `(o.expiresOn ?? o.day) <= opts.day`.
5. **decision.ts `parseDecision`:** `ttlDays: numOr(o.ttlDays)` durchreichen.
6. **Tests:** TTL-Default unverändert; `ttlDays:2` überlebt Tag D, verfällt D+1; Budget zählt
   nur an D; Klemmung 0→1/99→5/2.6→3; `addBerlinDays` Monats-/Jahresgrenze.

## Task 2 — Limit-Leiter (`rungGroup` + Mutual-Cancel)

1. **types.ts:** `EntryOrder.rungGroup?: string`.
2. **engine.ts `placeOrders`:** nach der Akzeptanz-Schleife akzeptierte **Limit**-Orders nach
   `ticker+side` gruppieren; Gruppen mit ≥ 2 Orders gemeinsame `rungGroup`-Id geben.
3. **engine.ts `applyTick`:** beim Order-Durchlauf gefüllte `rungGroup`s sammeln; eine Order,
   deren Gruppe in diesem Tick schon gefüllt hat, **nicht** füllen, sondern stornieren
   (Stake zurück, `order-expired`); überlebende Orders gefüllter Gruppen ebenso stornieren.
4. **Tests:** 2 Long-Limits @100/@98, Berührung 100 → eine Position + @98 storniert + Stake zurück;
   Same-Tick-Gap durch beide → genau eine Position; einzelnes Limit / Market bleiben ungruppiert.

## Task 3 — Prompt-Steuerung + Order-Zeile

1. **prompts.ts `buildDecisionPrompt`:** Limit-bevorzugen-Absatz, Leiter-Erklärung,
   `ttlDays`-Erklärung; Regelblock + JSON-Beispiel um `ttlDays` ergänzt.
2. **format.ts `orderLine`:** „gültig bis Handelsschluss {expiresOn ?? day}".
3. **Tests:** Prompt enthält „Limit"/„Leiter"/„ttlDays"-Hinweise; `orderLine` zeigt `expiresOn`.

## Abschluss

- `npm test` komplett grün.
- Handoff-/Doc-Notiz, MASTERPLAN B4-Zeile auf „Stufe 1 umgesetzt" nachziehen.
- Kein Push (Lars merged/pusht). Stufe 2 (Setup-Radar) bleibt eigener PR.
