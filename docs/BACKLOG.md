# Backlog — Ape Signal

Priorisierter Arbeitsplan. Lose Ideen werden hier kategorisiert; sobald ein
Punkt konkret wird → eigene Spec + Plan unter `docs/superpowers/`
(Workflow: brainstorming → spec → writing-plans → executing-plans).

Erledigt am 2026-06-12: „Stille Degradation härten (Lebenszeichen)" und
„Kür-Ansicht im Depot-UI" — Specs und Pläne unter `docs/superpowers/`.

## Reihenfolge (vereinbart 2026-06-13)

1. **A1 Language-Setting** ← *aktiv, Einstieg*
2. **A2 Handelsfenster-Setting**
3. **C1 TradingView-Embed + Kennzahlen-Overlay**
4. **B2 EMA-Signal (EMA 8)**
5. **B1 Proxy fürs Crawling**
6. **C2 Mr-Ape-Chat read-only**
7. **C3 Setup-Assistent (Stufe 2)**
8. **D1 Claude-Health-Check** (quer, einschiebbar wenn Limit-Blindheit nervt)

## Kategorien

### A — Self-Host-Readiness (Config/Settings)

- **A1 Language-Setting** — Sprache der Persona-Ausgaben (Journal, Telegram,
  Tagesabschluss) konfigurierbar statt fest Deutsch. Baustein für den
  Public-Self-Host-Pfad. *Isoliert, schneller Win; legt das Config-Muster, das
  A2 und C3 wiederverwenden.*
- **A2 Handelsfenster-Setting** — Konfigurierbar, in welchem Fenster Mr Ape
  agiert (heute fest US-Session 15:30–22:00 Europe/Berlin in Timern und
  Glossar). Betrifft systemd-**Timer**, **Fill-Fenster-Logik** und den
  **Close-/Tagesabschluss-Zeitpunkt**. *Größter Hebel, aber breite Wirkung —
  braucht saubere Spec.*

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

### C — UI-Ausbau (Depot-UI)

- **C1 TradingView-Embed + Kennzahlen-Overlay** — Zwei trennbare Teile:
  - **Overlay (sicher, von uns lieferbar):** Wake-up-Wert, Entry & Co. der
    offenen Positionen sollen **immer sichtbar** neben/über dem Chart stehen,
    damit der Verlauf leichter nachvollziehbar ist.
  - **Embed + Refresh (abhängig von TradingViews Restriktionen):** Kontext-Chart
    mit voller Markthistorie pro Ticker; falls kein direktes Andocken an die
    TradingView-Live-View möglich ist, braucht es eine **Refresh-Mechanik**.
  - *In der Spec trennen, damit das sichere Overlay nicht am unsicheren Embed
    hängt.* (ADR 0004, Alternativen.)
- **C2 Mr-Ape-Chat read-only** — den /journal-Dialog (Fragen + Antworten)
  read-only im UI sichtbar machen. *Voraussetzung:* der Listener persistiert
  den Dialog (heute nur flüchtig in Telegram). Schreiben aus dem UI wäre
  Stufe 2+.
- **C3 Setup-Assistent (Stufe 2)** — Erst-Einrichtung und Key-Pflege (Telegram,
  Finnhub) im UI; Secrets in geteilter Config-Datei, env als Bootstrap
  (ADR 0004, Punkt 5). *Erst sinnvoll, wenn Public-Self-Host realer wird.*

### D — Ops & Observability

- **D1 Claude-Health-Check** — Sichtbar machen, ob Claude (Persona-Backend)
  überhaupt antwortet bzw. ob das 5h-Nutzungslimit greift, statt stiller
  Funkstille. Offene Fragen für die Brainstorming-Runde: Erkennung
  (HTTP-429/Limit-Header vs. Heartbeat-Ping), Anzeige (Telegram-Hinweis,
  UI-Badge, systemd-Status) und Abgrenzung zur bestehenden
  Degradations-/Lebenszeichen-Logik.
