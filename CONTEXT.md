# Context — Ape Signal

Glossar der Domänenbegriffe. Keine Implementierungsdetails.

## Begriffe

### Depot (Paper-Portfolio)
Der fiktive Handelsbestand von Mr Ape: Guthaben (Balance), offene Positionen und
offene Orders. Maschinenlesbarer Zustand ist die einzige Quelle der Wahrheit für
Zahlen — Mr Ape (das LLM) trifft Entscheidungen, führt aber nie selbst Buch.

### Journal
Append-only Erzählung von Mr Ape über sein Trading: warum er eine Position
eröffnet/geschlossen hat, was er gelernt hat. Das Journal ist Begründung, nie
Buchhaltung — Zahlen im Journal sind Zitate aus dem Depot, nicht deren Quelle.

### Mr Ape
Die Trading-Persona: das LLM, das Kandidaten auswählt, Positionen eröffnet,
Stops/Limits setzt und das Journal schreibt. Entscheider, nicht Rechner.

### Monitor-Tick
Ein häufiges, rein deterministisches Kurs-Update der offenen Positionen während
der US-Session (alle 5 Minuten, Mo–Fr 15:30–22:00 Europe/Berlin). Beim
Monitor-Tick prüft die Engine Fills, Stops, Liquidationen und die
Wake-Up-Bänder. Monitor-Ticks entscheiden nichts und eröffnen nie neue
Positionen; sie können einen Manager-Tick auslösen.

### Manager-Tick
Der Moment, in dem Mr Ape (Sonnet) das Depot sieht und Stops/Limits/Bänder
anpassen darf. Wird nie nach Uhrzeit, sondern ereignisgesteuert ausgelöst:
durch ein hartes Ereignis (Fill, Stop, Liquidation) oder ein gerissenes
Wake-Up-Band — plus garantiert beim Tagesabschluss. Band-Wakes unterliegen
einem Cooldown (max. einer pro 15 Minuten); harte Ereignisse wecken immer.

### Wake-Up-Band
Ein weiches Schwellenpaar ober- und unterhalb des Kurses einer Position, das
nicht handelt, sondern nur Mr Ape weckt. Harte Schwellen (Stop, Take-Profit)
führt die Engine selbst aus; Bänder lenken Aufmerksamkeit. Mr Ape setzt sie
bei Kür und Manager-Tick; fehlen sie, leitet die Engine sie vom aktuellen Kurs
ab. Ein gerissenes Band ist verbraucht und wird neu gesetzt oder neu
abgeleitet — es weckt nie zweimal.

### Kandidatenkür
Der eine Entscheidungspunkt pro Handelstag (direkt nach dem PreUS-Lauf), an dem
Mr Ape (Opus) auf Basis des Dossiers und der Debatte bis zu 3 Trade-Kandidaten
in Orders verwandelt.

### Debatte (Advocatus Diaboli)
Der adversariale Zwischenschritt der Kür: Sonnet formuliert für jeden
Dossier-Kandidaten den stärksten Bull- UND Bear-Case, ohne zu empfehlen.
Die Debatte informiert die Entscheidung; fällt sie aus, entscheidet Mr Ape
ohne sie.

### Dossier
Die von Sonnet recherchierte Entscheidungsgrundlage für die Kandidatenkür:
Scan-Daten, Web-Research, Sentiment (opportunistisch via last30days). Das
Dossier empfiehlt nicht — es informiert; entschieden wird in der Kür.

### Tagesabschluss
Kurzbilanz nach US-Close auf Telegram: Equity, Tages-P&L, offene Positionen.
Neben Kür, Fills und Manager-Tick-Notizen das einzige proaktive Posting —
stille Monitor-Ticks posten nichts.

### Hebel (Position)
Jede Position ist CFD-artig: Einsatz (Margin) × Hebel = Nominalwert; P&L folgt
dem Nominalwert. „Balanced" sind harte, vom System erzwungene Guardrails — nicht
Mr Apes Ermessen: max. Hebel 3x, Pflicht-Stop-Loss bei Eröffnung, max. 20% der
Balance als Einsatz pro Position (Spielgeld-Depot — bewusst mutiger als ein
2%-Risikomodell). Verlust ≥ Einsatz liquidiert die Position zwangsweise.

### Trade-Kandidat
Ein Ticker, den Mr Ape an einem Handelstag für einen fiktiven Trade nominiert
(max. 3 pro Tag). Kandidaten dürfen aus den Scan-Listen kommen, müssen aber
nicht — Mr Ape darf eigenständig recherchieren, was sonst „heiß" ist.

### Depot-UI (Viewer)
Web-Schaufenster des Paper-Depots auf dem eigenen Server: Journal, Depotstand,
offene Positionen/Orders und Charts aus der Tick-Historie samt Schwellen
(Einstieg, Stop, Take-Profit, Wake-Up-Bänder). Der Viewer liest nur — er
entscheidet nichts und führt nie Buch; Zugriff nur nach Login. Die
Erst-Einrichtung (Keys, Telegram-Test) ist als Setup-Assistent eine spätere
Ausbaustufe.

### Tick-Historie
Die vom Monitor-Tick aufgezeichneten Kurs-Snapshots der beobachteten Ticker —
die eigene Kursquelle des Depots für Charts. Sie beginnt mit der ersten Order
eines Tickers und entsteht nur während der US-Session; Lücken (Nacht,
Wochenende) sind normal und werden nicht interpoliert.

### Fill (simulierte Ausführung)
Eine offene Order gilt als ausgeführt, wenn der Kurs ihr Niveau seit dem letzten
Monitor-Tick nachweislich erreicht hat: entweder hat der Kurs das Niveau zwischen
zwei Monitor-Ticks gekreuzt, oder das Tages-High/Low hat sich seitdem über das
Niveau hinaus bewegt. Konservativ: ein nicht nachweisbarer Spike füllt nicht.
Market-artige Ausführungen (Market-Entry, Stop, manueller Close, Liquidation)
slippen einen halben Spread gegen den Trade; jede Ausführung unter 500 Nominal
kostet eine Ordergebühr (Smartbroker+-Schema) — die Simulation schönt nicht.
