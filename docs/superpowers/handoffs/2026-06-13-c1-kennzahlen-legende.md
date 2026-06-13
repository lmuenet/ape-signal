# Handoff — 2026-06-13: C1 Kennzahlen-Legende (Overlay-Baseline)

Session-Übergabe. Stand: Feature fertig, getestet (348/348, `tsc --noEmit`
sauber), per `--no-ff` nach `master` gemerged (`a2c1e68`), Branch gelöscht.
**Noch NICHT deployed** und **noch nicht gepusht** (origin/master ist hinterher).

## Was diese Session geliefert hat

Spec: `docs/superpowers/specs/2026-06-13-c1-kennzahlen-legende-design.md`
Plan: `docs/superpowers/plans/2026-06-13-c1-kennzahlen-legende.md`

C1 ist im Backlog in zwei Teile geschnitten; geliefert wurde **nur der sichere
Overlay-Teil**: eine **immer sichtbare Kennzahlen-Legende** über jedem
Positions-Chart im Depot-UI.

- Pro Positions-Chart eine Leiste: **Kurs · Entry · TP · Wake↑ · Wake↓ · SL**.
  Schwellen (TP/SL/Wake) zeigen zusätzlich den **vorzeichenbehafteten Abstand
  zum aktuellen Kurs in %** (1 Nachkomma), z. B. `TP 28.00 (+10.7%)`. Entry &
  Kurs sind Referenzpunkte ohne %.
- Farben nach Rolle: TP grün, SL rot, Wake↑/↓ bernstein, Kurs fett/hell.
- Edge-Cases: kein Kurs → Kurs „—", Abstände entfallen, Schwellenpreise
  bleiben; fehlende Schwelle (kein TP/Wake) → „—"; Kurs 0 → keine Division.
- Die alte statische `Entry · SL · TP · Wake`-Meta-Zeile entfällt; Thesis bleibt.
- **Reine Frontend-Arbeit** im `ape-ui`-Container, **kein `/api`-Eingriff**.

### Schlüsseldateien

| Bereich | Dateien |
|---|---|
| Reine Logik (getestet) | `src/ui/public/legend.js` (`distancePct`, `buildLegend`), `src/ui/legend.test.ts` |
| Static-Route | `src/ui/server.ts` (`STATIC`-Map: `/legend.js`), `src/ui/server.test.ts` |
| DOM-Glue + Styles | `src/ui/public/app.js` (`legendBar()`, `positionCard`), `src/ui/public/style.css` (`.legend`/`.leg-*`) |

### Test-/Build-Mechanik (wichtig fürs Verständnis)

- `legend.js` ist **browser-natives ESM** (`"type":"module"` im Repo) — wird von
  `app.js` per `import { buildLegend } from "./legend.js"` geladen **und** von
  `legend.test.ts` (vitest) importiert. Eine Quelle, kein Bundler.
- `vitest` sammelt nur `src/**/*.test.ts`; `tsc` (`include:["src"]`, ignoriert
  `.js`, excludet `**/*.test.ts`) bleibt unberührt. Deshalb stört der `.ts`-Test,
  der ein `.js`-Modul importiert, den Typecheck nicht.
- Der Browser lädt rohe Statics → `/legend.js` musste in die `STATIC`-Map.

## NÄCHSTER SCHRITT: Deploy (UI-Container, NICHT Host-`npm ci`)

C1 ist eine **UI-Container-Änderung** → `docker build` + Container-Neustart.
Ein Host-`git pull && npm ci` aktualisiert den Container **nicht** (ADR 0004).
SSH hat nur der Nutzer; Befehle als `! ssh root@159.69.202.146 "..."`.

```bash
# 1. Code auf den VPS ziehen
ssh root@159.69.202.146 "cd /opt/ape-signal && git pull"

# 2. Arbeitsbaum sauber? (vitest-4-Falle aus letztem Handoff!)
#    docker build nutzt den ARBEITSBAUM als Build-Kontext, nicht git HEAD.
#    Ein uncommitteter package.json/lock-Mismatch bricht 'npm ci' im Build.
ssh root@159.69.202.146 "cd /opt/ape-signal && git status --short"
#    Falls package.json/package-lock.json dirty sind:
#    ssh root@159.69.202.146 "cd /opt/ape-signal && git checkout -- package.json package-lock.json"

# 3. UI-Image neu bauen
ssh root@159.69.202.146 "cd /opt/ape-signal && docker build -t ape-signal-ui ."

# 4. Aktuelles UI_PASS auslesen (beim Neustart wieder mitgeben — sonst Login kaputt)
ssh root@159.69.202.146 "docker inspect ape-ui --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i ui_"

# 5. Container neu starten — IMMER mit --network my-lab-net (sonst 502 an depot.lmue.net)
ssh root@159.69.202.146 "docker rm -f ape-ui && docker run -d --name ape-ui --restart unless-stopped --network my-lab-net -p 8744:8744 -v /opt/ape-signal/data:/data:ro -e UI_USER=ape -e UI_PASS='<PASS-AUS-SCHRITT-4>' ape-signal-ui"

# 6. Verifizieren
ssh root@159.69.202.146 "docker ps --filter name=ape-ui && curl -s -u ape:'<PASS>' http://127.0.0.1:8744/legend.js | head -1"
#    Erwartet: Container 'Up', und die erste Zeile von legend.js.
#    Im Browser: depot.lmue.net öffnen, eine offene Position prüfen → Legende über dem Chart.
```

Hinweis: Ohne offene Positionen ist die Legende nicht sichtbar (sie hängt an
`portfolio.positions`). Equity/Journal/Kür sind davon unberührt.

## Danach offen (Backlog, NICHT beauftragt — erst auf Zuruf)

Reihenfolge in `docs/BACKLOG.md` aktualisiert: nach C1-Baseline wurde **B1
(Proxy)** vorgezogen (Nutzerwunsch), weil er C1-Embed, B2-Candles/EMA und
breitere Recherche erst freischaltet.

- **B1 Proxy fürs Crawling** — rotierender/residential Proxy, damit der VPS
  Quellen erreicht, die Datacenter-IPs blocken (Yahoo-Chart, StockTwits,
  TradingView-Live, Candle-Quelle für EMA). Laufende Kosten + Infra-Frage.
- **C1 Embed/Refresh** (Rest) — hängt an B1.
- **B2 EMA-Signal (EMA 8)** — Candles/EMA, „nur anzeigen vs. Scan-/Signal-
  Logik"; der „simpel/detailliert"-Umschalter aus C1 wurde bewusst hierher
  verschoben (Legende bleibt in beiden Modi, Detail-Panel kommt mit B2).
- B3 Trending-Scan überarbeiten, C2 Mr-Ape-Chat read-only, C3 Setup-Assistent,
  D1 Claude-Health-Check.

## Arbeitsweise (bewährt, beibehalten)

- Superpowers-Workflow strikt: brainstorming → spec → writing-plans →
  executing-plans (TDD red-green, **Commit pro Task**) →
  finishing-a-development-branch.
- Entwicklung **inline** (keine Subagents). Branch-Abschluss per lokalem
  `--no-ff`-Merge nach master + Test-Verifikation auf dem Merge-Ergebnis +
  Branch löschen. Docs/Handoff direkt auf master.
- Commit-Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- SSH auf den VPS hat **nur der Nutzer** — `! ssh root@159.69.202.146 "..."`,
  verschachteltes Shell-Escaping meiden.
- Brainstorming lief diesmal mit dem **Visual Companion** (Browser-Mockups);
  `.superpowers/` ist jetzt in `.gitignore`.
