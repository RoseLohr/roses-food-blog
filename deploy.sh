#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Roses Food Blog — One-Liner-Deployment
#
#   ./deploy.sh
#
# Führt idempotent aus: git pull, Image-Build, DB-Backup, Container-Neustart
# (Migrationen laufen im Container-Entrypoint), Healthcheck, Statusausgabe.
# Erkennt den Erstlauf selbst (fehlende .env, fehlende Volumes, Autostart).
# ---------------------------------------------------------------------------
set -euo pipefail

# Das komplette Skript läuft in einer Funktion: bash liest so die ganze Datei
# ein, BEVOR etwas ausgeführt wird — wichtig, weil der git pull unten dieses
# Skript selbst aktualisieren kann.
main() {

cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"
SECONDS=0   # Gesamtdauer fürs Abschluss-Log

# Live-Rückmeldung fürs Admin-Panel (Bereich „Aktualisierung“): deploy.sh
# schreibt fortlaufend eine Statusdatei (aktuelle Phase, läuft ja/nein, Ergebnis)
# und ein Log. Das Panel pollt beides und zeigt so, dass wirklich etwas passiert.
DEPLOY_STATUS_RESULT=""        # während des Laufs unbekannt
DEPLOY_PHASE="gestartet"
DEPLOY_RUNNING=1
_status_ready() { [[ -n "${DATA_DIR:-}" && -d "${DATA_DIR:-/nonexistent}" ]]; }
# Zeitstempel in MILLISEKUNDEN (wie Date.now() im Panel). Früher wurde auf
# Sekunden gerundet (…000) — dann konnte status.at knapp KLEINER als der
# Auslöse-Zeitpunkt (ms) sein und das Panel den frischen Status als „alt“
# verwerfen (Dauer-„startet gleich …“). Millisekunden vermeiden das.
_now_ms() { local ms; ms=$(date +%s%3N 2>/dev/null); [[ "$ms" =~ ^[0-9]+$ ]] && printf '%s' "$ms" || printf '%s000' "$(date +%s)"; }
status_write() {
  _status_ready || return 0
  local running=false; [[ "$DEPLOY_RUNNING" == "1" ]] && running=true
  local phase=${DEPLOY_PHASE//\\/\\\\}; phase=${phase//\"/\\\"}
  printf '{"at":%s,"running":%s,"phase":"%s","result":"%s","commit":"%s"}\n' \
    "$(_now_ms)" "$running" "$phase" "$DEPLOY_STATUS_RESULT" "${COMMIT:-}" \
    > "$DATA_DIR/deploy-status.json" 2>/dev/null || true
}
deploy_log() {
  _status_ready && printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" \
    >> "$DATA_DIR/deploy.log" 2>/dev/null || true
}
# EXIT-Trap: Ergebnis festhalten (leer = wir haben das Ende nie erreicht).
write_deploy_status() {
  DEPLOY_RUNNING=0
  [[ -z "$DEPLOY_STATUS_RESULT" ]] && DEPLOY_STATUS_RESULT="fehlgeschlagen"
  [[ "$DEPLOY_STATUS_RESULT" == "erfolgreich" ]] \
    && DEPLOY_PHASE="abgeschlossen" || DEPLOY_PHASE="fehlgeschlagen"
  deploy_log "Deployment $DEPLOY_STATUS_RESULT."
  status_write
}
trap write_deploy_status EXIT

# log()/fail() ZUERST definieren — damit auch frühe Fehler (fehlende Tools,
# fehlende .env) über die Statusdatei im Panel landen. Wird deploy.sh vom
# Panel-Watcher (systemd) angestoßen, sieht man so den ECHTEN Grund statt nur
# „Server reagiert nicht“.
log()  {
  printf '\n\033[1;32m==> %s\033[0m\n' "$*"
  DEPLOY_PHASE="$*"
  deploy_log "$*"
  status_write
}
fail() {
  printf '\n\033[1;31mFEHLER: %s\033[0m\n' "$*"
  DEPLOY_PHASE="Fehler: $*"
  deploy_log "FEHLER: $*"
  status_write
  exit 1
}

# DATA_DIR so FRÜH wie möglich auflösen, damit ab hier jeder Fehler sichtbar
# wird. .env liefert DATA_DIR/PORT; fehlt sie, greift der Standardpfad (wie in
# compose.yml). Die verpflichtende .env-Prüfung folgt gleich darunter.
if [[ -f .env ]]; then
  # nur einfache KEY=VALUE-Zeilen laden
  set -a; source <(grep -E '^[A-Z_]+=' .env); set +a
fi
DATA_DIR="${DATA_DIR:-/srv/roses-blog/data}"
PORT="${PORT:-3000}"
mkdir -p "$DATA_DIR" 2>/dev/null || true

# Sofortiger Herzschlag ans Panel: „angenommen, läuft an“. Ohne diesen Status
# würde ein Abbruch VOR Abschnitt 0 (z. B. podman nicht im PATH des systemd-
# Dienstes) gar keinen Status schreiben — das Panel meldete dann fälschlich
# „Watcher läuft nicht“, obwohl er sehr wohl lief. MUSS vor dem Lock-Gate stehen:
# schlägt die Lock-Etablierung fehl (fail-closed) oder läuft der Lock in den
# Timeout, ist so bereits ein frischer „running"-Status geschrieben, den der
# EXIT-Trap dann auf „fehlgeschlagen" dreht — das Panel behält keinen stale Erfolg.
: > "$DATA_DIR/deploy.log" 2>/dev/null || true
DEPLOY_RUNNING=1; DEPLOY_STATUS_RESULT=""
log "Deployment angenommen — Umgebung wird geprüft"

# Nebenläufigkeit verhindern: der manuelle `./deploy.sh` und der Panel-Watcher-
# Dienst (roses-blog-deploy.service) dürfen NICHT gleichzeitig `compose down/up`
# fahren — sonst reißt der eine dem anderen den gerade gestarteten Container unter
# dem Healthcheck weg (Symptom: „erfolgreich" gefolgt von curl (7) refused).
# WICHTIG (mehrere Punkte vom Fremd-Vendor-Panel als Schwäche nachgewiesen):
#  - Lock liegt in $HOME, NICHT in $DATA_DIR: DATA_DIR ist ins Container gemountet
#    und app-/container-schreibbar — ein dort platzierter Symlink würde beim Öffnen
#    gefolgt und sein Ziel getrunkt. $HOME ist für den Container unerreichbar.
#  - Öffnen NUR-LESEND (`exec 9<`): flock braucht nur einen Deskriptor, kein `>`
#    → selbst bei einem Symlink wird nichts getrunkt/geschrieben.
#  - WARTEN statt Überspringen: ein zweiter Lauf (z. B. neuer Commit-Trigger
#    während eines laufenden Deploys) wartet auf den Lock und fährt DANN einen
#    vollen Lauf — inkl. eigenem `git pull` (Abschnitt 1), holt also den NEUESTEN
#    Stand. So geht kein Trigger/Commit verloren, und kein übersprungener Lauf
#    meldet fälschlich Erfolg. Timeout → ehrlicher fail (kein Silent-Erfolg).
# FAIL-CLOSED (Verfassung: Kontrollen fallen geschlossen aus): kann der Lock NICHT
# etabliert werden (flock/HOME fehlt, Pfad unbeschreibbar/Verzeichnis), wird der
# Deploy ABGEBROCHEN — NICHT ungeschützt fortgesetzt. Sonst liefe er fail-open in
# genau das compose down/up-Race, das der Lock verhindern soll. Ein bewusster
# Operator-Override ist ausschließlich explizit möglich: DEPLOY_NO_LOCK=1.
if [[ "${DEPLOY_NO_LOCK:-0}" == "1" ]]; then
  echo "HINWEIS: DEPLOY_NO_LOCK=1 — Nebenläufigkeits-Sperre bewusst deaktiviert (Operator-Override)."
elif [[ -z "${HOME:-}" ]] || ! command -v flock >/dev/null 2>&1; then
  fail "Deploy-Lock nicht etablierbar (flock oder \$HOME fehlt) — fail-closed abgebrochen, um ein ungeschütztes compose down/up-Race zu verhindern. Abhilfe: flock installieren (util-linux) bzw. HOME setzen, oder bewusst DEPLOY_NO_LOCK=1 setzen."
else
  LOCK_FILE="$HOME/.roses-blog-deploy.lock"
  ( umask 077; : >> "$LOCK_FILE" ) 2>/dev/null || true    # anlegen (0600), ohne Truncate
  { exec 9<"$LOCK_FILE"; } 2>/dev/null \
    || fail "Deploy-Lock ($LOCK_FILE) nicht öffenbar (Pfad unbeschreibbar/Verzeichnis?) — fail-closed abgebrochen. Ursache prüfen oder bewusst DEPLOY_NO_LOCK=1 setzen."
  LOCK_WAIT="${DEPLOY_LOCK_WAIT:-2400}"
  if ! flock -n 9; then                                   # sofort frei? sonst warten
    log "Anderer Deploy läuft — warte auf exklusiven Lock (max ${LOCK_WAIT}s)"
    flock -w "$LOCK_WAIT" 9 \
      || fail "Anderer Deploy hält den Lock länger als ${LOCK_WAIT}s — abgebrochen (kein Silent-Erfolg; ein neuer Commit-Trigger wird NICHT als Erfolg quittiert)."
  fi
fi

# Deployt standardmäßig den aktuell ausgecheckten Branch (Override: DEPLOY_BRANCH)
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
[[ "$CURRENT_BRANCH" == "HEAD" ]] && CURRENT_BRANCH="main"
BRANCH="${DEPLOY_BRANCH:-$CURRENT_BRANCH}"
COMPOSE="podman compose"
command -v podman >/dev/null \
  || fail "podman nicht gefunden. PATH des Dienstes: ${PATH}"
podman compose version >/dev/null 2>&1 || {
  command -v podman-compose >/dev/null && COMPOSE="podman-compose" \
    || fail "Weder 'podman compose' noch 'podman-compose' im PATH (${PATH}). Installation: sudo apt install podman-compose"
}

# --- 0. .env verpflichtend --------------------------------------------------
if [[ ! -f .env ]]; then
  fail "Keine .env gefunden. Ersteinrichtung: cp .env.example .env und Werte befüllen (siehe README.md)."
fi

for var in BASE_URL SESSION_SECRET ADMIN_EMAIL ADMIN_PASSWORD; do
  [[ -n "${!var:-}" ]] || fail ".env unvollständig: $var ist nicht gesetzt."
done

# --- 1. Git pull ------------------------------------------------------------
if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  log "Hole aktuellen Stand (Branch: $BRANCH)"
  git fetch origin "$BRANCH"
  git checkout -q "$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi
COMMIT="$(git rev-parse --short HEAD)"

# --- 1b. Schnellpfad: nichts zu tun? ------------------------------------------
# Läuft der Container bereits gesund mit exakt diesem Commit und derselben
# .env, ist ein kompletter Rebuild + Neustart Verschwendung (und unnötige
# Downtime). Der Zustand des letzten erfolgreichen Deployments steht in
# $DATA_DIR/deploy-state. Übersprungen wird nur, wenn ALLES passt; FORCE_DEPLOY=1
# erzwingt den vollen Lauf, SKIP_PULL=1 (lokale Änderungen) deaktiviert ihn.
ENV_HASH="$(sha256sum .env | cut -d' ' -f1)"
STATE_FILE="$DATA_DIR/deploy-state"
if [[ "${FORCE_DEPLOY:-0}" != "1" && "${SKIP_PULL:-0}" != "1" \
      && -z "$(git status --porcelain 2>/dev/null)" \
      && -f "$STATE_FILE" \
      && "$(cat "$STATE_FILE" 2>/dev/null)" == "$COMMIT $ENV_HASH" ]] \
   && podman image exists localhost/roses-blog:latest 2>/dev/null \
   && [[ "$(podman inspect -f '{{.State.Running}}' roses-blog 2>/dev/null)" == "true" ]] \
   && curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  rm -f "$DATA_DIR/deploy-request" 2>/dev/null || true
  DEPLOY_STATUS_RESULT="erfolgreich"
  log "Bereits aktuell (Commit $COMMIT) — Container läuft, kein Neustart nötig (${SECONDS}s)"
  echo "Branch:   $BRANCH"
  echo "Commit:   $COMMIT"
  podman ps --filter name=roses-blog --format "Container: {{.Names}} ({{.Status}})"
  echo "Hinweis:  FORCE_DEPLOY=1 ./deploy.sh erzwingt Rebuild + Neustart."
  return 0
fi

# --- 2. Erstlauf: Datenverzeichnisse ----------------------------------------
if [[ ! -d "$DATA_DIR" ]]; then
  log "Erstlauf: lege Datenverzeichnis $DATA_DIR an"
  mkdir -p "$DATA_DIR"/{uploads,geoip,backups} \
    || fail "Konnte $DATA_DIR nicht anlegen (ggf. einmalig: sudo mkdir -p $DATA_DIR && sudo chown \$USER $DATA_DIR)"
fi
mkdir -p "$DATA_DIR"/{uploads,geoip,backups}

# Etwaige Deploy-Anfrage aus dem Admin-Panel als "verbraucht" markieren
# (der Watcher-Dienst entfernt sie ebenfalls; hier für manuelle Läufe).
rm -f "$DATA_DIR/deploy-request" 2>/dev/null || true

# Live-Log/Status fürs Panel zurücksetzen und Start markieren.
: > "$DATA_DIR/deploy.log" 2>/dev/null || true
DEPLOY_RUNNING=1; DEPLOY_STATUS_RESULT=""
log "Deployment gestartet (Commit $(git rev-parse --short HEAD 2>/dev/null || echo '?'))"

# --- 3. Image bauen ----------------------------------------------------------
# CPU-Check: sharps native Binärdatei braucht SSE4.2 (x86-64-v2). Fehlt das
# Flag (alte CPUs wie Intel Atom/Bonnell, VMs mit qemu64/kvm64-CPU-Typ),
# nutzt die Bildpipeline stattdessen die Debian-libvips-CLI (LOW_CPU-Image).
LOW_CPU="${FORCE_LOW_CPU:-0}"
if [[ "$LOW_CPU" != "1" ]] && ! grep -qm1 sse4_2 /proc/cpuinfo; then
  LOW_CPU=1
  echo "HINWEIS: CPU ohne SSE4.2 erkannt — baue LOW_CPU-Image"
  echo "         (Bildverarbeitung über Debians libvips-CLI statt sharp)."
fi

# Persistente Build-Caches auf dem Host (NO_CACHE=1 schaltet beides ab):
#  - npm-Cache: npm ci lädt Pakete nur noch einmal herunter
#  - Turbopack-Cache (.next/cache): next build kompiliert nur Geändertes neu
#    (next.config.ts: experimental.turbopackFileSystemCacheForBuild)
# `podman build -v` blendet die Host-Verzeichnisse nur während der RUN-Schritte
# ein — sie landen NICHT im Image.
BUILD_OPTS=(--build-arg "APP_COMMIT=$COMMIT" --build-arg "LOW_CPU=$LOW_CPU" -f Containerfile)
if [[ "${NO_CACHE:-0}" != "1" ]]; then
  mkdir -p "$DATA_DIR/build-cache/npm" "$DATA_DIR/build-cache/next"
  BUILD_OPTS+=(-v "$DATA_DIR/build-cache/npm:/root/.npm" \
               -v "$DATA_DIR/build-cache/next:/app/.next/cache")
else
  BUILD_OPTS+=(--no-cache)
fi

# Die Zwischen-Stages (deps, build) zusätzlich taggen: ungetaggt wären sie
# "dangling" und `podman image prune` (Abschnitt 8) würde sie samt Layer-Cache
# entfernen — dann liefe npm ci bei JEDEM Deployment komplett neu. Mit Tag
# bleibt der Cache erhalten; npm ci läuft nur noch, wenn sich
# package-lock.json ändert. Die Extra-Builds kosten nichts: alle drei
# Aufrufe teilen sich denselben Layer-Cache.
log "Baue Container-Image (Commit $COMMIT)"
podman build "${BUILD_OPTS[@]}" --target deps -t localhost/roses-blog:cache-deps . \
  || fail "Image-Build fehlgeschlagen (Stufe: Abhängigkeiten/npm ci)."
podman build "${BUILD_OPTS[@]}" --target build -t localhost/roses-blog:cache-build . \
  || fail "Image-Build fehlgeschlagen (Stufe: App-Build/next build)."
# Rollback-Vorbereitung (A-06/B-11): das aktuell laufende :latest als :previous
# sichern, BEVOR es überschrieben wird — so kann deploy/rollback.sh es in
# Sekunden zurückrollen (samt DB-Backup aus Abschnitt 4).
if podman image exists localhost/roses-blog:latest 2>/dev/null; then
  podman tag localhost/roses-blog:latest localhost/roses-blog:previous || true
fi
podman build "${BUILD_OPTS[@]}" -t localhost/roses-blog:latest . \
  || fail "Image-Build fehlgeschlagen (Stufe: Laufzeit-Image)."

# --- 4. DB-Backup vor Migration/Neustart -------------------------------------
if [[ -f "$DATA_DIR/app.db" ]]; then
  log "Sichere Datenbank vor dem Update"
  BACKUP_FILE="$DATA_DIR/backups/pre-deploy-$(date +%Y%m%d-%H%M%S).db"
  # --entrypoint node: das Image-Entrypoint (entry.sh) startet sonst den Server
  # und ignoriert diese Argumente.
  podman run --rm --entrypoint node -v "$DATA_DIR:/data" localhost/roses-blog:latest \
    -e "const db=require('better-sqlite3')('/data/app.db',{readonly:true});db.backup('/data/backups/'+process.argv[1]).then(()=>{db.close();console.log('Backup ok')}).catch(e=>{console.error(e);process.exit(1)})" \
    "$(basename "$BACKUP_FILE")" || fail "DB-Backup fehlgeschlagen — Deployment abgebrochen."
  # Nur die letzten 10 Pre-Deploy-Backups behalten (Best-Effort — ein leerer
  # Glob würde sonst wegen pipefail das ganze Deployment abbrechen)
  ls -1t "$DATA_DIR"/backups/pre-deploy-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f || true
fi

# --- 5. Container (neu) starten — Migrationen laufen im Entrypoint ----------
log "Stoppe alten Container (falls vorhanden) und gebe Port $PORT frei"
# Erst über Compose herunterfahren; anschließend den Container zusätzlich
# direkt per Namen entfernen. Nötig, weil ein früherer Lauf ihn mit einem
# anderen Compose-Provider (podman-compose vs. docker-compose) angelegt
# haben kann — dann kennt der aktuelle Provider ihn nicht und der Port
# bliebe belegt ("address already in use").
$COMPOSE down --remove-orphans >/dev/null 2>&1 || true
podman rm -f roses-blog >/dev/null 2>&1 || true

# Falls trotzdem noch etwas auf dem Port lauscht: klar melden statt kryptisch
# zu scheitern. (Rootless-Leftover, oder ein fremder Dienst auf Port $PORT.)
if command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :$PORT )" 2>/dev/null | grep -q ":$PORT"; then
  echo
  echo "WARNUNG: Port $PORT ist noch belegt."
  # Verbliebene Container suchen, die den Port veröffentlichen (podman kennt den
  # 'publish'-Filter nicht — daher über die Portspalte statt --filter).
  podman ps -a --format '{{.ID}} {{.Names}} {{.Ports}}' 2>/dev/null \
    | grep ":$PORT->" | awk '{print $1}' | xargs -r podman rm -f >/dev/null 2>&1 || true
  sleep 2
  if ss -ltn "( sport = :$PORT )" 2>/dev/null | grep -q ":$PORT"; then
    fail "Port $PORT ist weiterhin belegt (evtl. anderer Dienst). Prüfen: sudo ss -ltnp 'sport = :$PORT'"
  fi
fi

# Preflight: kann der Container das Datenverzeichnis UND die Datenbankdatei
# beschreiben? Erst testen, nur bei Fehlschlag reparieren: die rekursive
# Besitz-Normalisierung (unshare chown über ALLE Uploads/Backups) kann bei
# großen Datenbeständen Minuten dauern und ist nur nötig, wenn ein früherer
# Container Dateien unter fremder Uid hinterlassen hat ("attempt to write a
# readonly database"). 'podman unshare chown 0:0' setzt sie im User-Namespace
# auf den Host-User zurück.
data_write_test() {
  podman run --rm --entrypoint sh -v "$DATA_DIR:/data" localhost/roses-blog:latest \
    -c 'touch /data/.write-test && rm -f /data/.write-test \
        && { [ ! -f /data/app.db ] \
             || dd if=/dev/null of=/data/app.db oflag=append conv=notrunc status=none; }' \
    >/dev/null 2>&1
}
if ! data_write_test; then
  log "Datenverzeichnis nicht (voll) beschreibbar — normalisiere Besitz"
  podman unshare chown -R 0:0 "$DATA_DIR" >/dev/null 2>&1 || true
  data_write_test || fail "Container kann $DATA_DIR nicht beschreiben. Rootless betreiben \
(podman als Nicht-root-User), oder einmalig: podman unshare chown -R 0:0 \"$DATA_DIR\"."
fi

log "Starte Container neu"
$COMPOSE up -d --force-recreate app

# --- 6. Healthcheck -----------------------------------------------------------
log "Warte auf Healthcheck (http://127.0.0.1:$PORT/health)"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    HEALTH_OK=1; break
  fi
  sleep 2
done
if [[ "${HEALTH_OK:-0}" != "1" ]]; then
  echo
  echo "Letzte Container-Logs:"
  podman logs --tail 40 roses-blog || true
  fail "Healthcheck fehlgeschlagen. Vollständige Logs: podman logs roses-blog"
fi

# --- 7. Autostart nach Reboot -------------------------------------------------
# Zwei unabhängige Voraussetzungen — beide bei JEDEM Lauf sicherstellen, sonst
# startet der Container nach einem Reboot nicht (Autostart still kaputt).
# (a) User-Service podman-restart.service (startet Container mit restart:always)
if ! systemctl --user is-enabled podman-restart.service >/dev/null 2>&1; then
  log "Aktiviere Autostart-Service (podman-restart.service)"
  systemctl --user enable --now podman-restart.service >/dev/null 2>&1 \
    || echo "HINWEIS: podman-restart.service nicht aktivierbar — siehe deploy/roses-blog.service"
fi
# (b) Linger — ohne das startet der User-systemd-Manager beim Boot nicht,
# der Service liefe nie. Bei jedem Lauf explizit prüfen (nicht still schlucken).
# $USER ist nicht in jeder Umgebung gesetzt (cron, minimale systemd-Units) —
# unter `set -u` bräche das Skript sonst hier ab.
DEPLOY_USER="${USER:-$(id -un)}"
if [[ "$(loginctl show-user "$DEPLOY_USER" --property=Linger --value 2>/dev/null)" != "yes" ]]; then
  if loginctl enable-linger "$DEPLOY_USER" >/dev/null 2>&1; then
    echo "Autostart: Linger für $DEPLOY_USER aktiviert."
  else
    echo "WARNUNG: Linger konnte nicht aktiviert werden — Autostart nach Reboot INAKTIV."
    echo "         Einmalig ausführen: sudo loginctl enable-linger $DEPLOY_USER"
  fi
fi

# --- 7c. Deploy-Watcher: Aktualisierung aus dem Admin-Panel ------------------
# Ein Klick im Panel schreibt $DATA_DIR/deploy-request. Dieser systemd-User-
# Path-Unit erkennt die Datei und startet EINMALIG das feste Kommando
# ./deploy.sh (keine Parameter aus dem Container — die Isolation bleibt
# gewahrt). So lässt sich ohne Terminal-Zugriff neu deployen.
if command -v systemctl >/dev/null 2>&1; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/roses-blog-deploy.service" <<EOF
[Unit]
Description=Roses Food Blog – Pull & Deploy (aus dem Admin-Panel angestoßen)
After=network-online.target

[Service]
Type=oneshot
# Ein voller Build (~20 min) plus evtl. Warten auf den Deploy-Lock darf NICHT vom
# systemd-Default (TimeoutStartSec=90s) gekillt werden — sonst bliebe ein halb
# aktualisierter Stand zurück. Grosszuegig, aber endlich (kein echtes Haengen).
TimeoutStartSec=7200
WorkingDirectory=$SCRIPT_DIR
# WICHTIG: Ein systemd-User-Dienst startet mit MINIMALEM PATH — ohne
# ~/.local/bin (dort liegt z. B. ein per pip installiertes podman-compose)
# und ggf. ohne /usr/local/bin. deploy.sh bräche dann schon an der
# podman/podman-compose-Prüfung ab (Symptom: Panel meldet „Server reagiert
# nicht“, während der manuelle Aufruf im Terminal problemlos läuft). Wir
# setzen daher einen vollständigen PATH — die Standardorte plus den PATH,
# den der installierende Aufruf hatte.
Environment=HOME=$HOME
Environment=PATH=$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH
# Anfrage vor dem Lauf entfernen, damit der Path-Unit erneut auslösen kann.
ExecStartPre=-/usr/bin/rm -f $DATA_DIR/deploy-request
ExecStart=/usr/bin/env bash $SCRIPT_DIR/deploy.sh
EOF
  cat > "$UNIT_DIR/roses-blog-deploy.path" <<EOF
[Unit]
Description=Beobachtet Deploy-Anfragen aus dem Admin-Panel (Roses Food Blog)

[Path]
PathExists=$DATA_DIR/deploy-request
Unit=roses-blog-deploy.service

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  if systemctl --user enable --now roses-blog-deploy.path >/dev/null 2>&1; then
    echo "Panel-Deploy: Watcher aktiv (roses-blog-deploy.path)."
  else
    echo "HINWEIS: Deploy-Watcher nicht aktivierbar — Panel-Aktualisierung inaktiv."
  fi
fi

# --- 8. Aufräumen: alte, nun unbenutzte Images entfernen ---------------------
# Jeder Build hinterlässt das vorige Image als dangling <none>; ohne Prune
# läuft die Platte voll. Nur dangling entfernen — das laufende Image bleibt.
podman image prune -f >/dev/null 2>&1 || true

# --- 9. Status ----------------------------------------------------------------
# Zustand für den Schnellpfad (Abschnitt 1b) festhalten: Commit + .env-Hash
# des erfolgreich deployten Stands.
# Finaler Health-Gate (echtes Gate, NICHT nur kosmetisch): der autoritative Poll
# (Abschnitt 6) war grün; hier erneut bestätigen, dass die App nach Neustart+Prune
# WIRKLICH noch antwortet. Mehrere Versuche absorbieren einen transienten Port-
# Reinit (compose-Recreate/Port-Forwarder). Bleibt sie danach unerreichbar, ist die
# App nicht bloß transient weg → EHRLICH als Fehlschlag melden (kein Silent-Erfolg,
# der einen Post-Restart-Crash als „erfolgreich" quittiert). „erfolgreich" wird
# daher erst NACH bestandenem Gate gesetzt.
echo "Branch:   $BRANCH"
echo "Commit:   $COMMIT"
FINAL_HEALTH_OK=0
for _ in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then FINAL_HEALTH_OK=1; break; fi
  sleep 1
done
if [[ "$FINAL_HEALTH_OK" != "1" ]]; then
  echo "Letzte Container-Logs:"
  podman logs --tail 30 roses-blog 2>&1 | sed 's/^/  /' || true
  fail "App nach Neustart auf Port $PORT nicht erreichbar (finaler Health-Gate gescheitert) — Deployment NICHT als erfolgreich quittiert."
fi
# Zustand für den Schnellpfad (Abschnitt 1b) erst nach bestandenem Health-Gate.
printf '%s %s\n' "$COMMIT" "$ENV_HASH" > "$STATE_FILE" 2>/dev/null || true
DEPLOY_STATUS_RESULT="erfolgreich"   # EXIT-Trap schreibt deploy-status.json
log "Deployment erfolgreich (Dauer: ${SECONDS}s)"
echo "Health:   OK (http://127.0.0.1:$PORT/health)"
podman ps --filter name=roses-blog --format "Container: {{.Names}} ({{.Status}})"

}

main "$@"
