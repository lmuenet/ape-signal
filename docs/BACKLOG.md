# Backlog — Ape Signal

Priorisierter Arbeitsplan. Lose Ideen werden hier kategorisiert; sobald ein
Punkt konkret wird → eigene Spec + Plan unter `docs/superpowers/`
(Workflow: brainstorming → spec → writing-plans → executing-plans).

Erledigt am 2026-06-12: „Stille Degradation härten (Lebenszeichen)" und
„Kür-Ansicht im Depot-UI" — Specs und Pläne unter `docs/superpowers/`.

## Reihenfolge (vereinbart 2026-06-13)

1. ~~**A1 Language-Setting**~~ — **erledigt 2026-06-13** (`APE_LANGUAGE`, Default DE)
2. ~~**A2 Handelsfenster-Setting**~~ — **erledigt 2026-06-13** (`SESSION` us/xetra + `/ticker`)
3. ~~**C1 Kennzahlen-Legende (Overlay-Baseline)**~~ — **erledigt 2026-06-13.**
   Embed/Refresh-Teil von C1 bleibt offen (hängt an B1, s. u.)
4. **B1 Proxy fürs Crawling** — vorgezogen: schaltet C1-Embed, B2-Candles/EMA
   und breitere Recherche frei
5. **B2 EMA-Signal (EMA 8)**
6. **C2 Mr-Ape-Chat read-only**
7. **C3 Setup-Assistent (Stufe 2)**
8. **D1 Claude-Health-Check** (quer, einschiebbar wenn Limit-Blindheit nervt)

## Kategorien

### A — Self-Host-Readiness (Config/Settings)

- ~~**A1 Language-Setting**~~ — **erledigt 2026-06-13.** Sprache aller
  LLM-Freitexte (Persona-Journal/Kür/Tick, Scan-/Strategie-Freitexte) via
  `APE_LANGUAGE` (`de`|`en`, Default `de`), Direktiven-Overlay. Spec/Plan unter
  `docs/superpowers/`. Legt das Config-Muster, das A2 und C3 wiederverwenden.
- ~~**A2 Handelsfenster-Setting**~~ — **erledigt 2026-06-13.** Konfigurierbares
  Handelsfenster via `SESSION` (Presets `us`/`xetra`) + Overrides; systemd-Timer
  per `npm run gen-timers` generiert; Tick-Intervall als Laufzeit-Drossel (live
  per Telegram `/ticker N`). Spec/Plan unter `docs/superpowers/`.

### B — Datenqualität & Signale (Crawling/Analyse)

- **B1 Proxy fürs Crawling** — Residential/rotierender Proxy, damit der VPS
  auch Quellen erreicht, die Datacenter-IPs blocken (Yahoo-Chart-API,
  StockTwits 403, ApeWisdom/Tradestie/News, Reddit — siehe ADR 0001). Öffnet
  den Nachrüstpfad für Candle-Genauigkeit und breitere Dossier-Recherche. Diese
  Quellen laufen heute bewusst „ohne" weiter statt zu scheitern (stille
  Degradation, siehe stderr der Tests). *Laufende Kosten + Infra-Frage.*
- **B2 EMA-Signal (EMA 8)** — Zenbotscanner anzapfen, Fokus **EMA 8** als
  Trend-Indikator (Nutzer-Input aus Reddit: EMA 8 hat einem Trader gut zur
  Trend-Einschätzung gedient). Offene Designfragen für die Brainstorming-Runde:
  *woher die Candles* (Zenbotscanner direkt vs. eigene Quelle) und ob EMA 8 nur
  **angezeigt** oder auch in **Scan-/Signal-Logik** einfließt. Profitiert von
  B1 (saubere Candles), Berechnung selbst aber eigenständig/teilbar.
- **B3 Trending-Scan überarbeiten** — der Trending-Report liefert aktuell
  faktisch immer dieselben Ticker und damit wenig Mehrwert; Kür + Paper-Trading
  sind effizienter. Klären: behalten/umbauen/abschalten, und ob der Morgen-
  PreOpen-Scan dabei mitwandert (heute fix 08:45, in A2 bewusst nicht angefasst).

### C — UI-Ausbau (Depot-UI)

- **C1 TradingView-Embed + Kennzahlen-Overlay** — Zwei trennbare Teile:
  - ~~**Overlay (sicher, von uns lieferbar):**~~ **erledigt 2026-06-13** —
    feste Kennzahlen-Legende über jedem Positions-Chart (Kurs · Entry · TP ·
    Wake↑ · Wake↓ · SL, je mit %-Abstand zum Kurs), reine Frontend-Arbeit im
    `ape-ui`-Container. Spec/Plan unter `docs/superpowers/`
    (`2026-06-13-c1-kennzahlen-legende-*`). Schalter „simpel/detailliert"
    bewusst weggelassen (kommt mit B2).
  - **Embed + Refresh (abhängig von TradingViews Restriktionen) — OFFEN:**
    Kontext-Chart mit voller Markthistorie pro Ticker; falls kein direktes
    Andocken an die TradingView-Live-View möglich ist, braucht es eine
    **Refresh-Mechanik**. Hängt an B1 (Proxy) — der VPS erreicht heute keine
    freie Chart-/Candle-Quelle (ADR 0001). Diese Daten sind nicht nur UI-Deko,
    sondern wichtig für Mr Apes Entscheidungen.
- **C2 Mr-Ape-Chat read-only** — den /journal-Dialog (Fragen + Antworten)
  read-only im UI sichtbar machen. *Voraussetzung:* der Listener persistiert
  den Dialog (heute nur flüchtig in Telegram). Schreiben aus dem UI wäre
  Stufe 2+.
- **C3 Setup-Assistent (Stufe 2)** — Erst-Einrichtung und Key-Pflege (Telegram,
  Finnhub) im UI; Secrets in geteilter Config-Datei, env als Bootstrap
  (ADR 0004, Punkt 5). *Erst sinnvoll, wenn Public-Self-Host realer wird.*
- **C4 Session/Tick-Verwaltung im UI** (Nutzerwunsch 2026-06-13) — `SESSION`,
  Overrides und Tick-Intervall (heute `/etc/ape-signal.env` + `npm run
  gen-timers`/`/ticker`) bequem aus dem Depot-UI-Container pflegen. Knackpunkt:
  das UI ist read-only und im **eigenen Container** (ADR 0004) — Timer-Regen +
  `systemctl daemon-reload` laufen auf dem **Host**, nicht im Container. Braucht
  also einen privilegierten Pfad (Host-Helfer/Socket/Sudoers) oder eine
  Entkopplung wie beim Tick-Intervall (State-Datei statt Timer). Enger Nachbar
  von C3.

### D — Ops & Observability

- **D1 Claude-Health-Check** — Sichtbar machen, ob Claude (Persona-Backend)
  überhaupt antwortet bzw. ob das 5h-Nutzungslimit greift, statt stiller
  Funkstille. Offene Fragen für die Brainstorming-Runde: Erkennung
  (HTTP-429/Limit-Header vs. Heartbeat-Ping), Anzeige (Telegram-Hinweis,
  UI-Badge, systemd-Status) und Abgrenzung zur bestehenden
  Degradations-/Lebenszeichen-Logik.
