# Roses Food Blog

[![AI Audit Mandate: Level 2, Governed](https://raw.githubusercontent.com/mglaeser/ai-audit-mandate/main/assets/badges/level-2-governed.svg)](https://github.com/mglaeser/ai-audit-mandate)

Deutschsprachiger Food- & Reiseblog mit CMS, CRM und Newsletter (Double-Opt-in).
Eine Anwendung, eine SQLite-Datenbank, ein Container — betrieben mit Podman
auf einem eigenen Ubuntu-Server.

**Die Auslieferungskette:** Cloudflare am Rand (liefert brotli) → Nginx Proxy
Manager / OpenResty in einem **Container** → Next.js standalone auf
`127.0.0.1:<PORT aus der .env>`. Ein nginx ist auf dem Host zwar installiert,
sein Dienst ist aber `enabled` **und** `failed` und gehört nicht zur Kette
(`audit/11-infrastruktur-befund.md`).

- Planung & Stack-Entscheidung: [`docs/PLAN.md`](docs/PLAN.md)
- Dokumentierte Annahmen: [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md)

> Verweise auf „Annahme A1–A11" stammen aus dem Projektauftrag und sind im
> Repository nirgends niedergeschrieben (`governance/mandate.md` kennt sie
> nicht). Sie sind deshalb hier entfernt statt durch eine andere Nummer
> ersetzt.

## Entwicklung (lokal)

```bash
npm install
cp .env.example .env        # Werte befüllen (lokal reichen Dummy-Werte)
npm run db:migrate          # legt data/app.db an und wendet Migrationen an
npm run db:seed             # Beispieldaten (Rezepte, Reise, Zutaten)
npm run dev                 # http://localhost:3000
npm test                    # Unit- & Integrationstests
```

## Schnellstart: Ersteinrichtung mit einem Befehl

Auf einem frischen Ubuntu-Server (LTS) genügt:

```bash
git clone https://github.com/RoseLohr/roses-food-blog.git && cd roses-food-blog && ./bootstrap.sh
```

Bei privatem Repository die Clone-URL mit Token bzw. Deploy-Key verwenden
(siehe unten, Abschnitt 1). `bootstrap.sh` übernimmt den Rest:

1. installiert fehlende Pakete (podman, podman-compose, curl, openssl),
2. fragt die Konfiguration ab und schreibt die `.env`
   (`SESSION_SECRET` wird automatisch erzeugt),
3. legt das Datenverzeichnis an,
4. baut und startet den Container über `./deploy.sh`
   (Migrationen, Admin-Konto, Healthcheck, Autostart inklusive),
5. richtet auf Wunsch einen **Host-nginx** mit Let's-Encrypt-TLS ein.

> **Schritt 5 nur auf einem Server OHNE vorhandenen Reverse Proxy.** Er belegt
> 80/443 — auf diesem Server hält die ein Container. Und die Reihenfolge stimmt
> heute nicht: Schritt 4 ruft `./deploy.sh`, das ohne komprimierenden Proxy in
> Abschnitt 9c abbricht; Schritt 5 wird dann nie erreicht. Der Proxy-Host gehört
> **vor** `./deploy.sh` eingerichtet. Wie genau, ist offen — siehe §4.

Alle Werte lassen sich auch nicht-interaktiv vorgeben, z. B.:

```bash
BASE_URL=https://www.example.de ADMIN_EMAIL=ich@example.de ADMIN_PASSWORD=… \
SMTP_HOST=… SMTP_USER=… SMTP_PASS=… ./bootstrap.sh
```

Danach gilt für jedes Update dauerhaft: `./deploy.sh`.

## Manuelle Ersteinrichtung (Alternative zu bootstrap.sh)

Voraussetzungen: Ubuntu LTS, [Podman](https://podman.io) — **rootless**
betreiben (der Container läuft als root, was unter rootless dem
unprivilegierten Host-User entspricht; siehe docs/ASSUMPTIONS.md B21),
git, curl, openssl. Die Domain zeigt bereits auf Cloudflare, und Cloudflare auf
diesen Server.

```bash
sudo apt install -y podman podman-compose git curl openssl
```

> `nginx` und `certbot` stehen hier bewusst **nicht** mehr: Der Proxy läuft in
> einem Container, und die Zertifikate liegen dort — `/etc/letsencrypt/live`
> existiert auf dem Host nicht. `openssl` dagegen fehlte in dieser Liste,
> obwohl §2 unten es braucht.

### 1. Repository klonen (Deploy-Key oder HTTPS-Token)

Variante Deploy-Key (empfohlen, nur Lesezugriff):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/roses-blog-deploy -N "" -C "deploy@server"
# Öffentlichen Schlüssel (~/.ssh/roses-blog-deploy.pub) auf GitHub im Repo
# unter Settings → Deploy keys eintragen (ohne Schreibzugriff).
cat >> ~/.ssh/config <<'EOF'
Host github.com-roses-blog
    HostName github.com
    IdentityFile ~/.ssh/roses-blog-deploy
EOF
git clone git@github.com-roses-blog:RoseLohr/roses-food-blog.git
cd roses-food-blog
```

Variante HTTPS-Token: Fine-grained Personal Access Token (nur „Contents: read“)
erstellen und klonen mit
`git clone https://<TOKEN>@github.com/RoseLohr/roses-food-blog.git`.

### 2. Konfiguration

```bash
cp .env.example .env
nano .env        # alle Werte befüllen; SESSION_SECRET: openssl rand -hex 32
```

**`BASE_URL` ist in Produktion `https://gourmetcompass.de`** (ohne
abschließenden Schrägstrich). Der Wert versorgt alles, was **ohne laufende
Anfrage** entsteht: die Fußzeile der Druckansicht und die Links in
Newsletter-Mails.

Die ausgelieferten SEO-Artefakte hängen **nicht mehr** daran. `robots.txt`,
`sitemap.xml`, `llms.txt`, Canonicals, OpenGraph und die strukturierten Daten
nehmen den Ursprung der laufenden Anfrage (`Host` / `X-Forwarded-Proto` vom
nginx). Läuft die Seite unter einer anderen Domain als hier eingetragen,
gewinnt die ausgelieferte Domain; `www.`- und `http`-Varianten werden auf die
kanonische Form normalisiert. Fehlt `BASE_URL` ganz, gilt `SITE_ORIGIN` aus
`src/lib/base-url.ts` — **nie localhost**. Ein Domainwechsel ist damit eine
Zeile in `src/lib/base-url.ts`.

> **Befund 08/2026 (behoben).** Hier lag ein monatelang unsichtbarer
> Totalausfall: die Robots-Route (heute `src/app/robots.txt/route.ts`) wurde
> beim Build vorgerendert, im Image-Build
> gibt es keine `.env` — also lieferte die Seite dauerhaft
> `Sitemap: http://localhost:3000/sitemap.xml` aus. Google konnte die Sitemap
> über `robots.txt` nicht finden. Parallel zeigten Sitemap, Canonicals und
> strukturierte Daten auf eine längst abgelegte Domain, und in der Sitemap
> fehlten Kategorie- und Reisefilterseiten ganz. Alle Artefakte sind jetzt
> laufzeit-dynamisch und durch `scripts/regime/seo-gate.mjs`,
> `tests/seo.test.ts`, `tests/seo.integration.test.ts` und
> `tests/e2e/seo.spec.ts` abgesichert.

**Cloudflare steht davor** — es ist der Rand dieser Auslieferung, nicht eine
Möglichkeit. Die Managed-`robots.txt` von Cloudflare wird der
Antwort der App **vorangestellt** und sperrt in ihrer Standardform sämtliche
KI-Crawler (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`,
`meta-externalagent`, …) samt `ai-train=no`. Wer in KI-Antworten vorkommen
will, muss das im Cloudflare-Dashboard abschalten — die App kann es nicht
überschreiben.

Das Datenverzeichnis (Standard `/srv/roses-blog/data`) einmalig anlegen und dem
Deploy-Benutzer geben:

```bash
sudo mkdir -p /srv/roses-blog/data
sudo chown "$USER" /srv/roses-blog/data
```

### 3. Erstes Deployment

```bash
./deploy.sh
```

Der Erstlauf legt Datenverzeichnisse an, baut das Image, wendet Migrationen an,
legt das Admin-Konto aus `ADMIN_EMAIL`/`ADMIN_PASSWORD` an und richtet den
Autostart ein. Danach antwortet die App unter dem Port aus der `.env`:

```bash
curl -fsS "http://127.0.0.1:$(grep -E '^PORT=' .env | cut -d= -f2-)/health"
```

> **Nicht `3000` fest eintippen.** Der Container veröffentlicht den Port aus
> `PORT` (`compose.yml`), und auf dem Server ist das nicht 3000. Auf `*:3000`
> lauscht dort ein FREMDER node-Dienst — eine Antwort von dort sagt über diese
> Anwendung gar nichts aus. Genau diese Verwechslung hat schon eine ganze
> Erhebung ungültig gemacht (`audit/11-infrastruktur-befund.md` §0).

### 4. Reverse Proxy (Pflicht)

**Der Reverse Proxy ist nicht optional.** Die App komprimiert seit 08/2026
nicht mehr selbst (`compress: false` in `next.config.ts`) — sonst käme jede
Antwort schon als gzip an und der Proxy könnte sie überhaupt nicht mehr
komprimieren. Ohne einen komprimierenden Proxy davor gehen alle Antworten
unkomprimiert raus.

#### So läuft es auf diesem Server

Cloudflare am Rand, dahinter ein **Nginx Proxy Manager (OpenResty) in einem
Container**, dahinter die App auf `127.0.0.1:<PORT>`. Zwei Dinge folgen daraus:

1. **TLS und `server_name` werden in der NPM-Oberfläche gepflegt**, nicht in
   einer Datei auf dem Host. Die Zertifikate liegen im Container;
   `/etc/letsencrypt/live` gibt es auf dem Host nicht.
2. **Die Kompression am Ursprung kommt aus `deploy/npm/http_top.conf`.**
   `deploy.sh` spielt sie in Abschnitt 9c bei jedem vollen Lauf selbst in den
   Proxy-Container ein und misst danach nach. Von Hand geht es mit
   `scripts/regime/npm-snippet-einspielen.sh` und
   `scripts/regime/kompression-pruefen.sh`.

> **Offen (Messfrage M1, `audit/12-infrastruktur-fahrplan.md`):** über welche
> Upstream-Adresse der Proxy-Host die App erreicht. Im Container ist
> `127.0.0.1` die *eigene* Loopback-Adresse, nicht die des Hosts — „Proxy-Host
> auf `127.0.0.1:$PORT`" wäre hier also eine Behauptung, keine Anleitung. Wer
> neu einrichtet, liest den bestehenden Proxy-Host aus und übernimmt den Wert.

**Brotli wird am Ursprung nicht nachgerüstet.** OpenResty hat kein
brotli-Modul, und brotli liefert Cloudflare. Am Ursprung komprimiert gzip; das
ist der Unterschied zwischen 67,8 KB und rund 13 KB CSS je Cache-Miss.

**`www.` funktioniert derzeit nicht** — Cloudflare antwortet mit 525, weil
Proxy-Host und Zertifikat nur den nackten Namen kennen (Befund C4, offen).

#### Historisch: Host-nginx-Betrieb — gilt NICHT für diesen Server

Der folgende Weg richtet einen nginx auf dem **Host** ein. Er ist hier
gegenstandslos: Der Proxy läuft in einem Container, `apt` auf dem Host erreicht
ihn nicht, und 80/443 sind belegt. Er steht hier, weil
`deploy/nginx.conf.example` als einzige Stelle im Repository die Werte für
`client_max_body_size` und `proxy_read_timeout` niederschreibt.

```bash
sudo apt install -y libnginx-mod-http-brotli-filter   # ohne das Modul: brotli-Zeilen streichen
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/roses-blog
sudo nano /etc/nginx/sites-available/roses-blog   # server_name anpassen
sudo ln -s /etc/nginx/sites-available/roses-blog /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d www.example.de -d example.de
```

Das Paket heißt `libnginx-mod-http-brotli-filter` (Ubuntu/Debian; das
Schwesterpaket `…-static` liefert vorkomprimierte `.br`-Dateien aus und wird
hier nicht gebraucht). Es hängt an der nginx-ABI — auf einem Stand, für den es
kein passendes Paket gibt, ist es schlicht nicht installierbar.

Fehlt das Modul, kennt nginx die `brotli`-Direktiven nicht und `nginx -t`
schlägt fehl. Dann den Block zwischen `# BROTLI-ANFANG` und `# BROTLI-ENDE`
aus der Config entfernen — gzip allein funktioniert, kostet in diesem
Host-Betrieb gemessen rund 4 % mehr Bytes bei JS und 7 % bei CSS. (Diese beiden
Zahlen gehören zu diesem historischen Weg. Am Ursprung ging es um eine ganz
andere Größenordnung: dort lief CSS zeitweise völlig unkomprimiert.)

`bootstrap.sh` nimmt das beim **ersten** Einrichten ab: Es installiert das
Modul, fragt nginx mit einer Wegwerf-Konfiguration, ob es `brotli on;`
akzeptiert, und schreibt die Config entsprechend mit oder ohne den Block. Ob
apt Erfolg meldet, spielt dabei keine Rolle — gefragt wird das Ergebnis, nicht
der Weg dorthin.

**Eine bereits vorhandene Config ändert `bootstrap.sh` nie.** Weicht sie ab —
brotli-Direktiven ohne nutzbares Modul oder umgekehrt —, sagt das Skript das
beim Lauf und nennt den nötigen Handgriff. Das ist Absicht: Automatisch in eine
laufende, womöglich von certbot erweiterte Konfiguration hineinzuschneiden ist
ein Schadensrisiko, das zu den 4 % nicht im Verhältnis steht.

Für den Container-Proxy gilt das **Gegenteil**: `deploy.sh` spielt das
Schnipsel bei jedem Lauf ein — mit Rückrollpfad, falls `nginx -t` es ablehnt.

### 5. Autostart nach Reboot

`deploy.sh` aktiviert automatisch `podman-restart.service` (User-Scope) und
Linger; Container mit `restart: always` starten damit nach jedem Reboot.
Prüfen bzw. manuell:

```bash
systemctl --user enable --now podman-restart.service
loginctl enable-linger $USER
```

Alternative als klassische Unit: `deploy/roses-blog.service` (Anleitung im
Dateikopf).

### 6. Backup-Cron

```bash
crontab -e
# täglich 03:30 Uhr:
30 3 * * * /home/DEPLOY_USER/roses-food-blog/deploy/backup.sh >> $HOME/backup.log 2>&1
```

### 7. GeoIP-Datenbank (optional, für Länder-Statistik)

Lädt die frei nutzbare DB-IP-Country-Lite-Datenbank (CC BY 4.0) nach
`$DATA_DIR/geoip/`; ohne sie wird das Land als „unbekannt“ erfasst:

```bash
./scripts/update-geoip.sh
# monatlich aktualisieren:
0 4 3 * * /home/DEPLOY_USER/roses-food-blog/scripts/update-geoip.sh
```

## Updates deployen

Auf dem Entwicklungsrechner pushen, dann auf dem Server:

```bash
./deploy.sh
```

Das ist der gesamte Update-Vorgang: git pull → Image-Build → DB-Backup →
Migrationen → Neustart → Healthcheck → Statusausgabe. Kurze Downtime
(wenige Sekunden) ist akzeptabel.

Das Deployment ist auf Geschwindigkeit optimiert:

- **Schnellpfad:** Gibt es keine neuen Commits und läuft der Container
  gesund, endet `./deploy.sh` nach wenigen Sekunden ohne Rebuild und ohne
  Neustart. `FORCE_DEPLOY=1 ./deploy.sh` erzwingt den vollen Lauf.
- **Layer-Cache:** Die Build-Zwischenstufen bleiben als
  `roses-blog:cache-deps`/`cache-build` getaggt erhalten — `npm ci` läuft
  nur noch, wenn sich `package-lock.json` ändert.
- **Persistente Build-Caches** unter `$DATA_DIR/build-cache/` (npm-Downloads
  und Turbopack-Compilercache): Folge-Builds kompilieren nur Geändertes.
  Bei Verdacht auf einen defekten Cache: `NO_CACHE=1 ./deploy.sh` baut
  einmalig komplett frisch (und `rm -rf $DATA_DIR/build-cache` leert die
  Caches dauerhaft).

## Backup & Restore

`deploy/backup.sh` erzeugt in `$DATA_DIR/backups/`:

- `app-<Zeitstempel>.db.gz` — konsistentes SQLite-Backup (Online-Backup-API)
- `uploads-<Zeitstempel>.tar.gz` — Medien
- Rotation nach 14 Tagen (`BACKUP_KEEP_DAYS` in `.env` übersteuert das)

**Restore** (App kurz stoppen):

```bash
cd ~/roses-food-blog
podman compose down
gunzip -c /srv/roses-blog/data/backups/app-JJJJMMTT-HHMMSS.db.gz \
  > /srv/roses-blog/data/app.db
rm -f /srv/roses-blog/data/app.db-wal /srv/roses-blog/data/app.db-shm
tar -xzf /srv/roses-blog/data/backups/uploads-JJJJMMTT-HHMMSS.tar.gz \
  -C /srv/roses-blog/data
podman compose up -d app
curl -fsS "http://127.0.0.1:$(grep -E '^PORT=' .env | cut -d= -f2-)/health"
```

> Auch hier der Port aus der `.env` — ein `curl` auf 3000 träfe auf dem Server
> einen fremden Dienst und meldete Erfolg, während die Wiederherstellung in
> Wahrheit noch gar nicht steht.

## Fehlerbehebung

**Build bricht mit `SIGILL` ab („Next.js build worker exited … signal: SIGILL")**
Die CPU des Servers unterstützt kein SSE4.2/x86-64-v2 — die vorkompilierte
native Bibliothek von sharp stürzt dann ab. Betrifft alte physische CPUs
(z. B. Intel Atom N2xxx/Bonnell) und VMs mit CPU-Typ `qemu64`/`kvm64`.

Bis 08/2026 baute `deploy.sh` in diesem Fall automatisch ein „LOW_CPU-Image",
in dem die Bildverarbeitung über Debians libvips-Kommandozeilen-Tools lief.
Dieser Zweig ist entfernt: Der Server läuft auf einer AMD EPYC 7352
(x86-64-v4), der Fall trat seit dem Umzug nicht mehr ein, und ein zweiter
Encoder, der nie ausgeführt wird, ist kein Netz — nur unbelegter Code.

Tritt der Fehler auf einer anderen Maschine doch auf, ist die Abhilfe der
CPU-Typ der VM: auf „host" stellen (z. B. Proxmox: VM → Hardware →
Prozessoren) und normal deployen. Prüfen lässt sich das vorab mit
`grep -c sse4_2 /proc/cpuinfo` (0 = betroffen). Wer den libvips-Weg wieder
braucht, holt ihn aus der Historie zurück (Commit vor 08/2026) — als
bewusste Entscheidung mit eigenem Test, nicht als schlafenden Zweig.

Hinweis: Die WASM-Variante von sharp ist bewusst KEINE Option — sie
alloziert beim Laden bis zu 2 GB geteilten Speicher und scheitert auf
RAM-armen Geräten.

## Betrieb — Spickzettel

| Aufgabe            | Befehl                                        |
|--------------------|-----------------------------------------------|
| Update deployen    | `./deploy.sh`                                 |
| Logs ansehen       | `podman logs -f roses-blog`                   |
| Status             | `podman ps` / `curl 127.0.0.1:$PORT/health`   |
| Backup manuell     | `deploy/backup.sh`                            |
| App stoppen        | `podman compose down`                         |
| App starten        | `podman compose up -d app`                    |
| Zurückrollen       | `deploy/rollback.sh`                          |
| Proxy zuordnen     | `scripts/regime/npm-container-finden.sh --basis "$BASE_URL"` |
| Auslieferung messen| `scripts/regime/kompression-pruefen.sh --basis "$BASE_URL" --ebene ursprung` |

## Verzeichnisstruktur

```
src/            Anwendung (Next.js App Router, TypeScript)
drizzle/        SQL-Migrationen (generiert via npm run db:generate)
scripts/        Migrator, Seed, Entrypoint, GeoIP-Update
scripts/regime/ Gates und Betriebsprüfungen — darunter die drei Proxy-Skripte
                (npm-container-finden.sh, npm-snippet-einspielen.sh,
                kompression-pruefen.sh)
deploy/npm/     http_top.conf — die WIRKSAME Kompression am Ursprung
deploy/         rollback.sh, systemd-Unit, backup.sh, nginx.conf.example
                (letztere historisch, siehe ihren Kopf)
docs/           PLAN.md, ASSUMPTIONS.md, ABNAHME.md
governance/     Verfassung, ADRs, Ownership
audit/          Befunde, Fahrplan, Ausnahmen-Ledger
tests/          vitest + Playwright (tests/e2e/)
.github/        CI, DAST, Perf/Uptime, unabhängige Verifikation
```
