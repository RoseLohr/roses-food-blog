# Roses Food Blog

Deutschsprachiger Food- & Reiseblog mit CMS, CRM und Newsletter (Double-Opt-in).
Eine Anwendung, eine SQLite-Datenbank, ein Container — betrieben mit Podman
hinter nginx auf einem eigenen Ubuntu-Server.

- Planung & Stack-Entscheidung: [`docs/PLAN.md`](docs/PLAN.md)
- Dokumentierte Annahmen: [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md)

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
5. richtet auf Wunsch direkt nginx + Let's-Encrypt-TLS für die Domain ein.

Alle Werte lassen sich auch nicht-interaktiv vorgeben, z. B.:

```bash
BASE_URL=https://www.example.de ADMIN_EMAIL=ich@example.de ADMIN_PASSWORD=… \
SMTP_HOST=… SMTP_USER=… SMTP_PASS=… SETUP_NGINX=j ./bootstrap.sh
```

Danach gilt für jedes Update dauerhaft: `./deploy.sh`.

## Manuelle Ersteinrichtung (Alternative zu bootstrap.sh)

Voraussetzungen: Ubuntu LTS, [Podman](https://podman.io) (rootless empfohlen),
nginx, certbot, git, curl. Die Domain zeigt bereits auf den Server.

```bash
sudo apt install -y podman podman-compose nginx certbot python3-certbot-nginx git curl
```

### 1. Repository klonen (Deploy-Key oder HTTPS-Token, Annahme A10)

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
Autostart ein. Danach antwortet `curl http://127.0.0.1:3000/health`.

### 4. nginx + TLS

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/roses-blog
sudo nano /etc/nginx/sites-available/roses-blog   # server_name anpassen
sudo ln -s /etc/nginx/sites-available/roses-blog /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d www.example.de -d example.de
```

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
(wenige Sekunden) ist akzeptabel (A6).

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
curl -fsS http://127.0.0.1:3000/health
```

## Fehlerbehebung

**Build bricht mit `SIGILL` ab („Next.js build worker exited … signal: SIGILL")**
Die CPU des Servers unterstützt kein SSE4.2/x86-64-v2 — die vorkompilierte
native Bibliothek von sharp stürzt dann ab. Typisch für VMs mit CPU-Typ
`qemu64`/`kvm64`. `deploy.sh` erkennt das automatisch (Check auf `sse4_2` in
`/proc/cpuinfo`) und baut mit der WebAssembly-Variante von sharp
(etwas langsamere Bildverarbeitung, sonst identisch). Erzwingen:
`FORCE_SHARP_WASM=1 ./deploy.sh`. Die schnellere Lösung ist, in der
Virtualisierung den CPU-Typ auf „host“ zu stellen (z. B. Proxmox:
VM → Hardware → Prozessoren → Typ „host“) und neu zu deployen.

## Betrieb — Spickzettel

| Aufgabe            | Befehl                                        |
|--------------------|-----------------------------------------------|
| Update deployen    | `./deploy.sh`                                 |
| Logs ansehen       | `podman logs -f roses-blog`                   |
| Status             | `podman ps` / `curl 127.0.0.1:3000/health`    |
| Backup manuell     | `deploy/backup.sh`                            |
| App stoppen        | `podman compose down`                         |
| App starten        | `podman compose up -d app`                    |

## Verzeichnisstruktur

```
src/            Anwendung (Next.js App Router, TypeScript)
drizzle/        SQL-Migrationen (generiert via npm run db:generate)
scripts/        Migrator, Seed, Entrypoint, GeoIP-Update
deploy/         nginx-Beispiel, systemd-Unit, backup.sh
docs/           PLAN.md, ASSUMPTIONS.md
```
