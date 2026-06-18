# Brainstorm 2026-06-18 — Nautilus-Vergleich, Grill-Beschlüsse & PR „claude-health-ema-wake-transparenz"

Tiefe Brainstorm-Runde (Repo-Review + Vergleich mit
[NautilusTrader](https://github.com/nautechsystems/nautilus_trader)) plus ein
manuell geführtes Interview im Stil von `/grill-with-docs` (Skill hier nicht
installiert). Ergebnis: eine umgesetzte PR (3 Code-Commits) **und** die hier
festgehaltenen Beschlüsse für die Folge-Arbeit. Pro vertagtem Punkt steht die
**Richtung** fest; der Code folgt in eigenen PRs (Workflow: brainstorming → spec
→ writing-plans → executing-plans).

---

## 1. Was diese PR umsetzt

Drei in sich geschlossene Commits, ein Branch (`feat/claude-health-ema-wake-transparenz`):

1. **`invoke.ts`-Härtung (Claude-Health & Timing).** Der Runner war der blinde
   Fleck: kein Timeout, keine Limit-Erkennung. Neu: typisierte
   `ClaudeLimitError`/`ClaudeTimeoutError`, `classifyClaudeOutcome` (valides JSON
   bei Exit 0 ist nie ein Limit; sonst Phrase-Match), Watchdog (hartes Timeout +
   Interim-„rechnet noch"-Ping), Stufen-Timing nach stderr. Verdrahtet in Kür
   (Research/Debatte/Entscheidung), Manager-Tick und Scan-Challenge; spezifische
   Telegram-Alerts bei Limit/Timeout. **Bedient Finding B (Timing-Diagnose) und
   Finding E (Health) aus einer Naht.**
2. **EMA/RSI-Trend aus Scanner-Spalten.** Der TradingView-Scanner liefert
   EMA10/20/50 + RSI gratis als Spalten — **kein Proxy/Candle-Feed nötig**. Neu:
   `TickQuote` um die Felder erweitert, `trend.ts` mit deterministischem
   Trend-Tag (up/down/flat/unknown), in `renderQuotes` gerendert → Mr Ape sieht
   den Trend in Kür/Debatte/Tick. **Entkoppelt B2 von B1.**
3. **Wake-Transparenz.** Ein gerissenes Band, das den Manager weckt, blieb still,
   wenn Mr Ape „hielt". Neu: Band-Riss wird deterministisch gepostet (auch bei
   Hold/Fehler/Limit), Tick-Prompt verlangt bei Band-Wake eine 1-Satz-Begründung,
   Cooldown-unterdrückte Risse bleiben still. ADR 0003 ergänzt.

---

## 2. Grill-Beschlüsse (mit Begründung)

| Frage | Beschluss | Begründung |
|---|---|---|
| **PR-Scope** | Bündel: invoke.ts + EMA + Wake-Transparenz, als 4 saubere Commits | Nutzer-Wunsch nach sichtbarem Fortschritt; Commit-pro-Thema hält den Review trotz Bündel lesbar |
| **Watchdog** | Interim-Ping (5 min) + terminale Alerts | Deckt „Antwort bleibt lange aus" UND „Limit" direkt ab (Finding E) |
| **Timeout** | Erst messen: großzügiges Netz (20 min/Stufe), env-überschreibbar | Folgt „erst messen, dann fixen"; ein striktes Timeout könnte einen legitim langen WebSearch-Research killen, bevor wir reale Dauern kennen |
| **EMA-Tiefe** | EMA-Trend jetzt (EMA10/20/50), exakt-8 vertagt | „EMA 8" ist kein Scanner-Feld; EMA10 trägt die Trend-Aussage, sofort & ohne Proxy |
| **EMA-Nutzung** | LLM sieht es + deterministisches Trend-Tag | Tag ist wiederverwendbar für Notifications/Wake-Logik; kein Auto-Trading darauf |
| **Hold-Mechanik** | Riss deterministisch + LLM-Begründung | Zuverlässig auch bei LLM-Ausfall/Limit; Begründung wenn vorhanden |
| **Trailing-Stop / Intent-Stream** | Nur Doc-Beschluss, Folge-PR | PR schon umfangreich; Richtung unten festgehalten |
| **Limit-Erkennung exakt** | best-effort Phrase-Match, roh-stderr geloggt, später schärfen | Echtes 5h-Limit-Format auf dem VPS noch nicht eingefangen → aus Evidenz nachziehen |

---

## 3. Nautilus-Vergleich — übernehmen vs. bewusst weglassen

NautilusTrader ist ein Industrie-Framework (Hexagonal, MessageBus à la
LMAX-Disruptor, drei Engines, Adapter pro Venue). Das meiste ist für einen
Ein-VPS-LLM-Bot Overkill. Relevante Muster:

| Nautilus-Muster | Für Ape Signal | Status |
|---|---|---|
| **`ts_event`/`ts_init`** (Latenz = Differenz) | Jeden Claude-Call stempeln → Stufen-Timing | ✅ in dieser PR (Commit 1) |
| **`TRAILING_STOP_MARKET`** (Engine trailt deterministisch) | `trailBy`-Feld an `Position`, in `applyTick` angewandt → senkt LLM-Abhängigkeit, schnellere Reaktion | ⏳ vertagt (s. u.) |
| **Command/Event-Split + `ExecutionClient`-Parität** | Strukturierter Intent-Event-Stream → On-Ramp zu Real-Broker + Autonomie | ⏳ vertagt (s. u.) |
| **`RiskEngine`** (Pre-Trade-Gate) | Schon vorhanden als Guardrails in `placeOrders`; ggf. als eine benannte Funktion zentralisieren | optional |
| **`FillModel` / `bar_adaptive_high_low_ordering`** | Bewusst weglassen — konservative Fill-Regel (ADR 0001) reicht & ist ehrlicher | ❌ Overkill |
| MessageBus/Redis, ParquetDataCatalog, BarAggregation, LatencyModel, TWAP, OCO/OUO | Overkill bei dieser Skala | ❌ |

**Kernlehre:** so viel wie möglich **deterministisch** machen (billig, sofort,
fehlerfrei), das LLM nur für echte Entscheidungen. Trailing-Stop und Intent-Stream
sind die nächsten zwei Schritte auf dieser Linie.

---

## 4. Vertagte Beschlüsse (Richtung steht, Code folgt)

- **Deterministischer Trailing-Stop (Nautilus `TRAILING_STOP_MARKET`).** Heute
  muss Mr Ape (Sonnet) bei jedem Tick den Stop manuell nachziehen — LLM-Kosten,
  Latenz, verschlafene Bewegungen zwischen den Wakes. Beschluss: ein optionales
  `trailBy` (absolut oder %) an `Position`, in `applyTick` deterministisch
  nachgezogen, einmal von Mr Ape gesetzt. Direkter Beitrag zum Nutzerziel
  „SL/TP-Anpassungen nachbilden". → eigene Spec.
- **Intent-Event-Stream (Real-/Autonomie-Brücke).** Heute werden Anpassungen
  in-process angewandt und als Prosa nach Telegram beschrieben. Beschluss: jede
  Aktion als typisiertes Event in einen Append-only-Stream (JSONL) schreiben
  (`PlaceOrder`/`MoveStop`/`SetTP`/`Close`); Telegram+UI rendern daraus. „Live
  gehen" = ein Broker-Adapter, der den Stream abonniert; Autonomie = ein Flag mit
  dem bestehenden Guardrail-Gate davor. → eigene Spec, nach Trailing-Stop.
- **Opt-in Heartbeat / Pre-Open-Plan + `/status`-Command.** Eine bewusste
  ein-/zweimal-tägliche „Lagebericht"-Nachricht (auch wenn nichts passierte) plus
  ein Pull-Command für Depot+Health on demand. Ergänzt die Push-Logik um einen
  Morgen-Blick, ohne Tick-Spam. → Folge-PR.
- **EMA exakt 8.** Falls wirklich die 8 statt EMA10 gebraucht wird: echte Candles
  nötig — entweder Residential-Proxy + Yahoo/TwelveData (B1) **oder** eine
  inoffizielle TradingView-History-Lib (WebSocket, z. B. `@mathieuc/tradingview`,
  zu verifizieren). Erst relevant, wenn der Trend-Read aus EMA10/20 nicht reicht.

---

## 5. Offene Folge-Entscheidungen

- **Wake-Band-Prüfung auf High/Low statt nur Close?** `checkWakeBands` prüft heute
  nur `q.close` — ein Band, das intra-Tick per High/Low gerissen, aber zum Close
  zurückgelaufen ist, weckt nicht. Bei Fills wird High/Low schon genutzt (ADR
  0001). Bewusst belassen (weiche Aufmerksamkeit) oder angleichen? → klären.
- **Trend-Tag in die Wake-Ableitung?** `deriveBands` ist heute rein
  distanzbasiert; ein Trend-bewusstes Setzen (engeres Band gegen den Trend) wäre
  denkbar, sobald EMA verlässlich da ist.
- **Reihenfolge danach:** Trailing-Stop → Intent-Stream → Heartbeat/`/status` →
  (B1 Proxy für echte Candles/Sentiment) → B4 Intraday-Opportunismus.
