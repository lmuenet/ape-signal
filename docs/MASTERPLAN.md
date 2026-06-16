# Masterplan — Ape Signal (Stand 2026-06-16)

Konsolidierter Arbeitsplan über die nächsten Sessions. Vereint das bestehende
`docs/BACKLOG.md` mit zwei neuen Nutzer-Findings (Proxy/Datenintake,
VPS-Timing + Refokussierung). Pro Punkt gilt weiter der Workflow:
brainstorming → spec → writing-plans → executing-plans.

---

## 0. Status-Snapshot

- **Erledigt & gepusht:** A1 (Language `APE_LANGUAGE`), A2 (Handelsfenster
  `SESSION` + `/ticker`), C1-Baseline (feste Kennzahlen-Legende über dem
  Positions-Chart). `origin/master` == lokal (`073cce9`).
- **Offen im Deploy:** C1-Baseline ist eine **UI-Container-Änderung** und laut
  letztem Handoff **noch nicht auf den VPS deployed** (`docker build` +
  Container-Neustart nötig, NICHT Host-`npm ci`). → Vor allem anderen kurz
  verifizieren/deployen (Schritte im Handoff `2026-06-13-c1-kennzahlen-legende.md`).

---

## 1. Finding A — Datenintake verbessern: Proxy + agent-reach

### Ausgangslage (warum die Datenlage heute dünn ist)

Der VPS (Hetzner, **Datacenter-IP**) wird von mehreren Quellen geblockt oder
gedrosselt. Heute laufen die betroffenen Fetcher bewusst „still degradiert"
weiter statt zu scheitern (siehe ADR 0001, B1 im Backlog):

- **Yahoo Chart-/Candle-API** — auf der VPS-IP nicht erreichbar → **kein freier
  Candle-Feed** → blockiert EMA 8 (B2) und den C1-Chart-Embed.
- **StockTwits** — 403 (Sentiment fällt weg).
- **Reddit** — anonymes `old.reddit.com`-Scraping IP-geblockt; heute via
  App-only-OAuth umgangen, aber ohne Kommentar-/Off-Radar-Tiefe.
- **TradingView-Scanner** — funktioniert (free, keine Auth), trägt aktuell die
  Kurse/Trends; aber Rate-Limit-Risiko bei mehr Last.

### Zwei getrennte Hebel (wichtig, nicht vermischen)

**Hebel 1 — Residential-Proxy (= B1, das Transport-Layer).**
Ein rotierender Residential-Proxy (z. B. **webshare.io**) leitet unseren
ausgehenden Traffic über eine **Wohn-IP** statt der Datacenter-IP. Damit fallen
die IP-basierten Blocks weg — das nützt **allen** bestehenden Fetchern auf
einmal:

- Yahoo-Candles wieder erreichbar → **Voraussetzung für EMA 8 (B2)** und
  C1-Embed/Refresh.
- StockTwits 403 → 200 (Sentiment zurück).
- Reddit/ApeWisdom/Tradestie/News stabiler.

Technische Integration in Node ist klein: `HTTPS_PROXY`/`HTTP_PROXY` env bzw.
ein `undici`-`ProxyAgent` als globaler Dispatcher, sodass unsere bestehenden
`fetch`-Aufrufe transparent über den Proxy gehen. Pro Quelle nachrüstbar, falls
nur einzelne den Proxy brauchen sollen (Kosten/Bandbreite schonen).

**webshare.io konkret:** Residential-Plan, Abrechnung per GB; rotierende oder
Sticky-Sessions, Geo-Targeting (US-IP sinnvoll, da US-Markt). Unser Volumen ist
klein (wenige Scans/Ticks pro Tag) → **Kosten voraussichtlich gering**. In
agent-reach wird ein Residential-Proxy ausdrücklich als optionaler ~$1/Monat-
Baustein für Server in geblockten Regionen genannt — dieselbe Mechanik nutzen
wir, um die Datacenter-Blocks zu umgehen.

**Anbieter-Shortlist (Recherche 2026-06-16):**

| Anbieter | Residential-Preis | Anmerkung |
|---|---|---|
| **Webshare** | ~$1,40/GB (Promo, sonst ~$3,50–$7/GB); 10 Gratis-Proxies | Bestes Volumen/$, einfache Einrichtung, Support/Features begrenzt. Auch **Static Residential (ISP)** ab ~$0,30/IP mit fixer IP + unlimited Bandbreite. |
| **IPRoyal** | ab ~$1,75/GB, **Traffic verfällt nicht** | Top für niedriges/stoßweises Volumen — gekauftes GB bleibt nutzbar. |
| **Decodo (ex-Smartproxy)** | ~$3–$6/GB | „Sweet Spot": 65 Mio+ IPs, schnell (sub-2,5 ms), Sticky + Geo. |
| **Bright Data / Oxylabs** | ~$8,50–$12/GB | Enterprise, Overkill für uns. |

**Empfehlung für uns:** **Webshare** (Static Residential/ISP ab ~$0,30/IP mit
unlimited Bandbreite ist ideal für stabile, niedrigvolumige Server-Calls und
vermeidet GB-Abrechnungs-Überraschungen) **oder IPRoyal** (nicht verfallender
Traffic passt zu stoßweiser Scan-Last). Beides günstig genug, um in B1 ohne
großes Kostenrisiko zu testen. Geo: **US-IP** (US-Markt, US-Quellen). Final in
der B1-Brainstorming-Runde entscheiden.

**Hebel 2 — agent-reach (= Recherche-Anreicherung, separat von B1).**
`Panniantong/Agent-Reach` ist ein CLI-/Skill-Toolkit, das einem Agenten
„Augen ins Internet" gibt — **ohne kostenpflichtige APIs**:

| Quelle | Fähigkeit | Auth |
|---|---|---|
| Web | beliebige Seite lesen (Jina Reader) | keine |
| YouTube | Untertitel/Transkripte, Suche (yt-dlp) | keine |
| GitHub | Repos lesen/suchen | optional |
| Twitter/X | Tweets lesen/suchen | Cookie |
| Reddit | Suche, Posts/Kommentare | Cookie (kein Anon) |
| RSS | beliebige Feeds | keine |
| Global Search | semantische Web-Suche (Exa/MCP) | keine |

Das ist **komplementär** zum Proxy: agent-reach veredelt die **Research-/
Dossier-Stufe der Kür** (heute `researchRunner` = Sonnet mit `WebSearch` +
`Skill`/`/last30days`). Reddit-Kommentar-Tiefe, X-Sentiment und YouTube-
Transkripte könnten das Dossier deutlich anreichern.

Achtung Betriebsmodell: agent-reach setzt auf lokale **Cookie-/Login-States**
(Browser-Login + Cookie-Editor) und Shell-Ausführung. Auf einem headless-VPS
ist das aufwändiger als lokal — Cookies müssten gepflegt/erneuert werden.
**Empfehlung:** zuerst Hebel 1 (Proxy) umsetzen (breiter Nutzen, kleiner
Aufwand), agent-reach danach als optionale Recherche-Erweiterung evaluieren.

### Wie das „näher Richtung EMA 8" bringt

EMA 8 (B2) braucht **saubere Candles**. Die gibt es heute auf dem VPS nicht
(ADR 0001). Der Proxy schaltet einen freien Candle-Feed frei → EMA 8 wird
berechenbar, und der C1-Embed/Refresh-Chart bekommt echte Historie. Reihenfolge
bleibt also: **B1 (Proxy) zuerst**, dann B2 (EMA 8) und C1-Embed.

---

## 2. Finding B — VPS-Timing: Kür + Order kommen ~16:34 statt nahe Open

### Befund (aus dem Code)

Die Kandidatenkür hängt **synchron hinten am PreUS-Scan** (`src/scan/index.ts`
Zeile 81 ff.: `if (paperTradingEnabled && LABEL === "PreUS") runKuer(...)`). Der
PreUS-Timer feuert **15:15 Europe/Berlin** (`ape-signal-scan-preus.timer`), 15
Min vor US-Open (15:30). Die Design-Absicht: Order **nahe Open**.

Tatsächlich kommt die Kür ~**16:34** — also gut **eine Stunde nach Open**. Die
Kette ist lang und seriell:

1. PreUS-Scan-Pipeline (Claude-Aufrufe, TradingView, Reddit, Earnings)
2. Kür-Research-Dossier (Sonnet + WebSearch, opportunistisch `/last30days`)
3. Bull/Bear-Debatte (Sonnet)
4. Entscheidung (Opus)

Kumulierte LLM-Latenz schiebt die **Market-Order ~1 h hinter den Open** → Fill
zu einem ganz anderen Kurs als zum Entscheidungszeitpunkt. Das untergräbt die
„Einstieg nahe Open"-Logik.

Zwei zu trennende Ursachen:
- **(a) Echte Latenz** (wahrscheinlich Hauptursache): die serielle Scan+Kür-
  Kette.
- **(b) Mögliche Zeitzonen-/Uhr-Drift** auf dem Host: Die Timer tragen explizit
  `Europe/Berlin`, scheduling sollte also korrekt sein — aber Logs/Wall-Clock
  können verwirren, wenn `timedatectl` nicht auf Berlin steht (README empfiehlt
  es). Muss per SSH verifiziert werden.

### Diagnose (Nutzer per SSH — ich kann nicht)

```bash
! ssh root@159.69.202.146 "timedatectl"                       # TZ + clock sync
! ssh root@159.69.202.146 "systemctl list-timers 'ape-signal-*'"   # NEXT fire times
! ssh root@159.69.202.146 "journalctl -u 'ape-signal-scan@PreUS*' --since today --no-pager"
#   → Startzeit des Scans vs. Zeitstempel 'Kandidatenkür done' = echte Kettenlatenz
```

### Lösungsoptionen (in der Brainstorming-Runde wägen)

1. **PreUS-Scan vorziehen** (z. B. 14:30), damit die Kette **vor** 15:30 Open
   fertig ist. Kleinste Änderung (Timer/`gen-timers`).
2. **Limit- statt Market-Orders** für Kür-Einstiege → kein Late-Fill-Slippage,
   Order wartet auf den gewünschten Kurs (Engine kann Limit, siehe `format.ts`).
3. **Kette verkürzen:** Trending-Anteil aus dem Scan rausnehmen (deckt sich mit
   Finding C / B3) → spart Scan-Zeit vor der Kür.
4. **Kür entkoppeln:** eigener Timer/Pipeline statt Anhängsel am Scan (größerer
   Umbau, mehr Kontrolle über Einstiegsfenster).

Synergie: Option 3 (Trending raus) hilft gleichzeitig der Refokussierung unten.

---

## 3. Finding C — Refokussierung: Trending raus, Fokus aufs Handeln

Nutzer-Entscheidung: Die **Trending-Liste** liefert faktisch immer dieselben
Ticker und wenig Mehrwert (= B3 im Backlog, jetzt geschärft). Hauptfokus soll
auf den **handlungsnahen** Schleifen liegen:

> **Trading · Auswahl (Kür) · Wake-Up · Analyse · Chancen/Opportunismus**

Konkret:
- **B3 wird zu „Trending abschalten"** (statt „überarbeiten"). Klären: nur den
  Trending-**Report** killen, oder auch Teile der Scan-Pipeline, die nur für
  Trending da sind? Der **PreOpen-Scan (08:45)** und der PreUS-Scan liefern auch
  die Datenbasis der Kür — also nicht blind alles entfernen, sondern den reinen
  Trending-Output von der Kür-Datenversorgung trennen.
- Freiwerdende Energie/Latenz fließt in: schnellere/pünktlichere Kür (Finding B),
  bessere Daten (Finding A), EMA-8-gestützte Analyse (B2), und das
  Wake-Up-Band-Management (ADR 0003) als Kern der laufenden Betreuung.
- „Chancen/Opportunismus" als expliziter Fokus → bei B2/Analyse mitdenken
  (Setups erkennen, nicht nur Bestände verwalten).

---

## 3b. Finding D — Raum für „Zwischendurch"-Opportunismus (Nutzer-Idee 2026-06-16)

Nicht jeder sinnvolle Move passt in die einmal-tägliche Kür zum US-Open. Es
braucht **Raum für opportunistische Intraday-Analysen** — wenn sich untertags
ein Setup ergibt (Katalysator, Ausbruch, News), soll das System darauf reagieren
können, statt bis zur nächsten Kür zu warten.

Wichtige Einordnung des Nutzers: „Nicht jeder Move macht zum Marktbeginn Sinn,
aber dafür sorgen wir ja eigentlich mit **angepassten Orders**." → Ein großer
Teil davon ist bereits **mit Limit-Orders abbildbar**: Die Kür kann einen
Einstieg mit Limit (statt Market) zum gewünschten Kurs platzieren, der dann
**untertags** füllt, wenn der Kurs passt — der „Move" geschieht also zur
richtigen Zeit, nicht zwangsweise zum Open. Das deckt sich mit Finding B,
Option 2 (Limit-Orders gegen Late-Fill-Slippage).

Darüber hinaus offene Designfrage für ein eigenes Brainstorming: Soll es **aktiv
gesuchte** Intraday-Chancen geben (eine leichte Opportunismus-Schleife im Tick /
über die Wake-Up-Bänder hinaus, ADR 0003), oder reicht **passiv platzierte
Limit-Logik** aus der Kür? Knackpunkte: Tagesbudget/Guardrails (`GUARDRAILS`),
LLM-Kosten/-Limit (D1), und Abgrenzung zum deterministischen Monitor-Tick.

**Verortung:** Teilweise sofort über Limit-Orders (mit Finding B). Die aktive
Opportunismus-Schleife ist ein eigener Backlog-Punkt (**B4**, s. u.), sinnvoll
**nach** B1 (Daten) + B2 (EMA-8-Analyse als Signalgeber).

## 4. Konsolidierte Backlog-Reihenfolge (neu)

| # | Punkt | Status / Abhängigkeit |
|---|---|---|
| 0 | **C1-Baseline deployen** | erledigt im Code, Deploy auf VPS verifizieren |
| 1 | **B1 Residential-Proxy (webshare.io)** | Transport-Layer, schaltet B2 + C1-Embed + breitere Recherche frei |
| 2 | **Timing-Fix (Finding B)** | klein & wirkungsvoll; ggf. mit B3 koppeln |
| 3 | **B3 Trending abschalten + Refokus (Finding C)** | verkürzt Kette, schärft Fokus |
| 4 | **B2 EMA-8-Signal** | braucht B1 (Candles); „nur anzeigen vs. Signal-Logik" |
| 5 | **B4 Intraday-Opportunismus (Finding D)** | Limit-Orders sofort (mit Timing-Fix); aktive Schleife nach B1+B2 |
| 6 | **C1 Embed/Refresh** | braucht B1 |
| 7 | **agent-reach Recherche-Anreicherung** | optional, nach B1; Cookie-/VPS-Betrieb klären |
| 8 | **C2 Mr-Ape-Chat read-only** | Listener muss Dialog persistieren |
| 9 | **C4 Session/Tick-Verwaltung im UI** | privilegierter Host-Pfad nötig |
| 10 | **C3 Setup-Assistent** | erst bei realem Public-Self-Host |
| 11 | **D1 Claude-Health-Check** | quer, einschiebbar bei Limit-Blindheit |

### Vorgeschlagene Session-Sequenz

- **Session 1:** C1 deployen (kurz) → dann **B1 Proxy** brainstormen + umsetzen
  (webshare-Account, `undici`-ProxyAgent, Quellen reaktivieren, Doctor-Check).
- **Session 2:** **Timing-Fix + B3** zusammen (Trending raus verkürzt die Kette;
  Scan vorziehen und/oder Limit-Orders) — schneller spürbarer Effekt.
- **Session 3:** **B2 EMA 8** auf den jetzt sauberen Candles.
- **Danach:** C1-Embed, agent-reach-Anreicherung, C2/C4, D1 nach Bedarf.

---

## Offene Entscheidungen für die nächsten Brainstormings

- B1: webshare vs. Alternative; alle Quellen über Proxy oder selektiv?
  Geo (US-IP)? Sticky vs. rotierend?
- Timing: Scan vorziehen **und/oder** Limit-Orders **und/oder** Kür entkoppeln?
- B3: Trending nur als Report killen, oder Pipeline-Teile mit ausbauen?
- B2: EMA 8 nur anzeigen oder in Scan-/Signal-Logik?
- agent-reach: auf dem VPS überhaupt praktikabel (Cookie-Pflege headless), oder
  nur lokal/als Recherche-Beiboot?
