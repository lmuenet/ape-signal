# CLAUDE.md — Ape Signal

Operatives Betriebswissen für Claude-Sessions. Domänenbegriffe stehen in
`CONTEXT.md`, Architekturentscheidungen unter `docs/adr/`, Backlog in
`docs/BACKLOG.md`, Session-Übergaben unter `docs/superpowers/handoffs/`.

## Deployment-Topologie (VPS `159.69.202.146`, Host `lm-gateway`)

- **Kern** (Scans, Ticks, Telegram-Listener) läuft per **systemd** direkt auf
  dem Host, `tsx` vom Host-`node_modules`. Deploy: `git pull && npm ci`
  (mit Dev-Deps — `tsx` ist devDependency!) + Dienst-Neustart. Units in
  `systemd/`, siehe `systemd/README.md`.
- **Depot-UI** läuft als **eigener Docker-Container `ape-ui`** (ADR 0004),
  Port `8744`, Image `ape-signal-ui`. Der Container baut sein **eigenes**
  `node_modules` beim `docker build` — ein Host-`git pull && npm ci`
  aktualisiert den Container **nicht**. Code-Updates am UI brauchen
  `docker build` + Container-Neustart.
- **Reverse-Proxy** ist **Nginx Proxy Manager** (Container `npm`), nicht Host-
  nginx. Es gibt also **kein** `/etc/nginx/sites-enabled` auf dem Host —
  Proxy-Hosts werden in der NPM-Weboberfläche gepflegt. `depot.lmue.net`
  zeigt auf `ape-ui:8744`.

### 502-Bad-Gateway-Falle (gelöst 2026-06-13) — WICHTIG

Symptom: `depot.lmue.net` liefert 502, obwohl der `ape-ui`-Container gesund
ist (`docker ps` zeigt „Up", `curl http://127.0.0.1:8744/` am Host gibt `401`
= erwartete Basic-Auth-Challenge).

Ursache: `npm` und `ape-ui` müssen im **selben Docker-Netz `my-lab-net`**
hängen, damit NPM den Upstream per Containername `ape-ui` auflösen kann. Wird
`ape-ui` bei einem Deploy **neu erstellt** (`docker run` ohne `--network`),
landet es im Default-Bridge-Netz, NPM kann `ape-ui` nicht mehr auflösen → 502.
`localhost`/`127.0.0.1` als Forward-Ziel funktioniert NICHT — das ist aus
NPM-Sicht der NPM-Container selbst, nicht der Host.

Fix (robust): `ape-ui` immer mit `--network my-lab-net` starten, damit das nach
künftigen Deploys nicht wiederkehrt:

```bash
docker rm -f ape-ui && docker run -d --name ape-ui --restart unless-stopped \
  --network my-lab-net -p 8744:8744 \
  -v /opt/ape-signal/data:/data:ro \
  -e UI_USER=ape -e UI_PASS='<passwort>' \
  ape-signal-ui
```

NPM-Proxy-Host für `depot.lmue.net`: Forward Hostname `ape-ui`, Port `8744`,
Scheme `http`.

Schnell-Fix ohne Neustart (falls Container schon läuft, aber im falschen Netz):
`docker network connect my-lab-net ape-ui`.

### UI-Credentials

`UI_USER`/`UI_PASS` werden als `-e`-Variablen beim `docker run` fest in den
Container gebrannt (`src/ui/main.ts` liest `process.env`, **keine** `.env`-Datei
zur Laufzeit). Wird `ape-ui` neu erstellt, gelten die Werte aus DIESEM
`docker run` — nicht die alten. Login-Probleme nach Neustart → aktuelle Werte
prüfen: `docker inspect ape-ui --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i ui_`.
Ohne gesetztes `UI_USER`/`UI_PASS` startet die UI gar nicht (`process.exit(1)`).

## Arbeitsweise (Nutzer-Präferenzen)

- Superpowers-Workflow strikt: brainstorming → spec → writing-plans →
  executing-plans (TDD red-green, Commit pro Task) →
  finishing-a-development-branch.
- Entwicklung **inline** (keine Subagents). Branch-Abschluss per lokalem
  `--no-ff`-Merge nach master + Test-Verifikation auf dem Merge-Ergebnis +
  Branch löschen. Docs gehen direkt auf master.
- Commit-Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **SSH auf den VPS hat nur der Nutzer** (Passwort/Key, interaktiv) — Befehle
  als `! ssh root@159.69.202.146 "..."` vorschlagen, der `!`-Prefix führt sie
  in der Session aus. Bei `docker inspect --format`-Templates aufpassen:
  `{{...}}`/`$`-Escaping bricht über SSH leicht; einfache Formate bevorzugen.
- Bekannt & ok: vitest-stderr zeigt gewollte Degradations-Logs (StockTwits 403
  etc.) — das sind Tests der Degradationspfade, keine Fehler.
