# ADR 0003 — Ereignisgesteuerter Manager-Tick mit Wake-Up-Bändern statt Sonnet-Heartbeat

Datum: 2026-06-11 · Status: akzeptiert

## Kontext

Bisher lief alle 30 Minuten ein Tick, der bei offenen Positionen/Orders **immer**
Sonnet aufrief — auch wenn es nichts zu entscheiden gab (das Glossar versprach
„nur wenn es etwas zu entscheiden gibt", der Code hielt sich nicht daran).
Folgen: unnötige LLM-Kosten im Halbstundentakt, und gleichzeitig träger
deterministischer Schutz — Stops und Fills wurden nur alle 30 Minuten geprüft,
obwohl der Kursabruf (ein Scanner-POST) und die Fill-Engine praktisch gratis
sind. Der teure Teil eines Ticks ist der Sonnet-Call, nicht der Kurs.

## Entscheidung

1. **Monitor-Tick alle 5 Minuten** (Mo–Fr 15:30–22:00 Europe/Berlin): ein
   Scanner-POST, dann die volle deterministische Engine — Fills, Stops,
   Take-Profits, Liquidationen. Kein LLM-Aufruf. Die konservative Fill-Regel
   aus ADR 0001 bleibt unverändert, ihre Fenster schrumpfen von 30 auf 5
   Minuten (genauere Fills, schnellerer Schutz).
2. **Manager-Tick (Sonnet) nur ereignisgesteuert**: geweckt durch ein hartes
   Ereignis (Fill, Stop, Liquidation) oder ein gerissenes Wake-Up-Band — plus
   garantiert beim Tagesabschluss. Kein zeitgesteuerter Heartbeat mehr.
3. **Wake-Up-Bänder** sind weiche Schwellenpaare pro Position (`wakeAbove`/
   `wakeBelow`): Sie handeln nicht, sie wecken nur. Mr Ape setzt sie bei Kür
   und Manager-Tick (neue Adjustment-Art); fehlen sie, leitet die Engine sie
   deterministisch vom aktuellen Kurs ab (Fallback: halbe Distanz zum Stop
   bzw. Take-Profit; fehlt der TP, gespiegelte Stop-Distanz).
4. **Re-Arming**: Ein gerissenes Band ist verbraucht und weckt nie zweimal.
   Mr Ape soll beim Manager-Tick neue Bänder setzen; tut er es nicht, leitet
   die Engine beim nächsten Monitor-Tick neue vom dann aktuellen Kurs ab.
   Band-Wakes haben einen globalen Cooldown (max. einer pro 15 Minuten);
   harte Ereignisse wecken immer, ohne Cooldown.
5. **Telegram sieht Manager-Entscheidungen**: Pro Manager-Tick geht eine
   gebündelte Nachricht raus — Mr Apes Journal-Notiz (das Warum), alle
   angewandten Anpassungen (Stop/TP/Cancel/Bänder) und abgelehnte mit Grund.
   Stille Monitor-Ticks posten weiterhin nichts.

## Alternativen

- **Reiner Band-Wächter** (5-Min-Cron prüft nur Bänder, Engine bleibt im
  30-Min-Raster): einfacher, aber verschenkt die ohnehin geholten Kurse —
  Stops blieben träge, obwohl die Daten da sind.
- **Heartbeat behalten** (30-minütig oder einmal mittags): fängt
  kursneutrale Thesen-Brüche (News ohne Kursbewegung) ab — verworfen, weil
  für Swing-Trades selten entscheidend und die Kür morgens bereits
  recherchiert hat; der Tagesabschluss bleibt als garantierter Blick.
- **Rein abgeleitete Bänder ohne LLM-Input**: einfachster Vertrag, aber
  Mr Ape könnte seine Aufmerksamkeit nicht selbst steuern — der Kern der
  Idee.

## Konsequenzen

- Sonnet-Kosten sinken von ~13 Calls/Tag (jede halbe Stunde bei offenem
  Depot) auf typischerweise 1–4 (Ereignisse + Close); die Scanner-Last
  steigt auf ~78 POSTs/Tag — unkritisch für den unauthentifizierten Scanner.
- Eine Position, deren These ohne Kursbewegung kippt, sieht Sonnet erst beim
  Band-Riss oder Tagesabschluss. Bewusst akzeptiert.
- `Position` bekommt Band-Felder, der Tick-Timer wird auf 5 Minuten
  umgestellt, und `tickPipeline.ts` trennt Monitor- von Manager-Pfad.
- Das Glossar (CONTEXT.md) unterscheidet jetzt Monitor-Tick, Manager-Tick
  und Wake-Up-Band.
