# Backlog — Ape Signal

Lose Ideen, noch nicht geplant. Wenn ein Punkt konkret wird → eigener Plan
unter `docs/plans/`.

Erledigt am 2026-06-12: „Stille Degradation härten (Lebenszeichen)" und
„Kür-Ansicht im Depot-UI" — Specs und Pläne unter `docs/superpowers/`.

- **Proxy für Crawling**: Residential/rotierender Proxy, damit der VPS auch
  Quellen erreicht, die Datacenter-IPs blocken (Yahoo-Chart-API, StockTwits —
  siehe ADR 0001). Würde den designierten Nachrüstpfad für Candle-Genauigkeit
  und breitere Dossier-Recherche öffnen. Profitieren würden alle Quellen mit
  stillem Degradationspfad: StockTwits (403 von Datacenter-IPs), Yahoo-Charts,
  ApeWisdom/Tradestie/News-Fetches und der Reddit-Crawl — sie laufen heute
  bewusst „ohne" weiter, statt zu scheitern (siehe stderr-Ausgaben der Tests).
- **Depot-UI Stufe 2 — Setup-Assistent**: Erst-Einrichtung und Key-Pflege
  (Telegram, Finnhub) im UI; Secrets in geteilter Config-Datei, env als
  Bootstrap (ADR 0004, Punkt 5).
- **TradingView-Embed-Widget als Kontext-Chart**: ergänzend zum eigenen
  Positions-Chart volle Markthistorie pro Ticker im Depot-UI (ADR 0004,
  Alternativen).
- **Mr-Ape-Chat im Depot-UI anzeigen**: den /journal-Dialog (Fragen + Antworten)
  read-only im UI sichtbar machen. Voraussetzung: der Listener persistiert den
  Dialog (heute nur flüchtig in Telegram). Schreiben aus dem UI wäre Stufe 2+.
- **Language-Setting**: Sprache der Persona-Ausgaben (Journal, Telegram,
  Tagesabschluss) konfigurierbar machen statt fest Deutsch — Baustein für den
  Public-Self-Host-Pfad.
- **Handelsfenster-Setting**: Konfigurierbar, in welchem Fenster Mr Ape agiert
  (heute fest US-Session 15:30–22:00 Europe/Berlin in Timern und Glossar) —
  z.B. Xetra-Handel oder andere Sessions. Betrifft Timer, Fill-Fenster-Logik
  und den Tagesabschluss-Zeitpunkt.
