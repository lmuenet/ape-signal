# ADR 0004 — Read-only Depot-UI im Container, Charts aus eigener Tick-Historie

Datum: 2026-06-11 · Status: akzeptiert

## Kontext

Journal und Depot leben als Dateien (`journal.md`, `portfolio.json`) in
`DATA_DIR`; gelesen werden sie bisher nur via Telegram. Gewünscht ist ein
Web-UI auf dem eigenen Server: Journal lesen, Depot visuell, Charts der
offenen/georderten Positionen — und perspektivisch Key-Verwaltung sowie ein
leichter installierbarer Build für Außenstehende. Randbedingungen: Der Kern
ist systemd-nativ und hängt am eingeloggten `claude`-CLI (Subscription-Auth,
schwer containerisierbar); der VPS erreicht keine freie Candle-Quelle
(ADR 0001); die Konfiguration liegt root-eigen in `/etc/ape-signal.env`.

## Entscheidung

1. **Viewer zuerst, strikt read-only**: Stufe 1 zeigt Journal, Depot,
   Positionen/Orders und Charts. Der UI-Container mountet `DATA_DIR`
   ausschließlich lesend — kein Schreibpfad ins Depot, das UI konkurriert
   nie mit der Engine um die Wahrheit.
2. **Nur das UI wird containerisiert.** Der Kern (Scans, Ticks, Listener,
   `claude`-CLI) bleibt systemd. Docker macht das UI portabel, nicht das
   Gesamtsystem; der „leichte Build" bleibt `setup.sh` + ein Container-Start.
3. **Basic-Auth im Container selbst** (Credentials per env-Variable): auch
   read-only sind Journal und P&L privat. Self-contained — kein
   Reverse-Proxy als Installationsvoraussetzung.
4. **Charts aus selbst aufgezeichneter Tick-Historie**: Der Monitor-Tick
   (ADR 0003) persistiert seine 5-Minuten-Quotes; das UI rendert daraus
   Positions-Charts mit Einstieg, Stop, Take-Profit und Wake-Up-Bändern als
   Overlays. Keine externe Chart-API, kein Proxy nötig.
5. **Stufe 2 (Setup-Assistent)**: Key-Pflege und Erst-Einrichtung im UI.
   Secrets wandern dann in eine von Kern und UI geteilte Config-Datei; die
   env-Datei bleibt Bootstrap/Override. Oneshot-Dienste (Scans, Ticks) lesen
   Config bei jedem Start — nur der Listener braucht einen Reload. Stufe 1
   baut nichts, was dem widerspricht.

## Alternativen

- **TradingView-Embed-Widget** statt eigener Charts: volle Historie ohne
  eigene Daten — aber keine SL/TP/Band-Overlays möglich (und genau die
  Schwellen sind der Witz des Depots) plus Fremd-Branding. Als ergänzender
  Kontext-Chart später denkbar (Backlog).
- **Ganzer Stack in Docker Compose**: maximale Installierbarkeit, aber
  `claude login` im Container und der Timer-Umbau sind ungelöste Brocken
  ohne aktuellen Nutzen.
- **UI schreibt direkt in `/etc/ape-signal.env`**: am nächsten an der
  ursprünglichen Idee, aber ein Web-UI mit root-Schreibpfad ist das härteste
  Sicherheitsmodell — verworfen zugunsten der geteilten Config-Datei.

## Konsequenzen

- Der Monitor-Tick bekommt eine zweite Pflicht: Quotes in die Tick-Historie
  schreiben (Retention/Format bei der Umsetzung festzulegen).
- Positions-Charts zeigen nur den Lebenszyklus ab Order und nur
  Session-Zeiten — bewusst akzeptiert; volle Historie wäre erst mit Proxy
  oder Candle-API (Backlog) möglich.
- Telegram bleibt der Push-Kanal (SL/TP-Anpassungen, Fills, Tagesabschluss
  — ADR 0003); das UI ist Pull. Es ersetzt keine Notification.
- Equity-Kurve und Tages-P&L lassen sich aus `history` in `portfolio.json`
  ableiten — billige Kandidaten für Stufe 1.
