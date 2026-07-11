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

cd "$(dirname "$0")"

BRANCH="${DEPLOY_BRANCH:-main}"
COMPOSE="podman compose"
command -v podman >/dev/null || { echo "FEHLER: podman ist nicht installiert."; exit 1; }
podman compose version >/dev/null 2>&1 || {
  command -v podman-compose >/dev/null && COMPOSE="podman-compose" || {
    echo "FEHLER: Weder 'podman compose' noch 'podman-compose' verfügbar."
    echo "        Installation: sudo apt install podman-compose"
    exit 1
  }
}

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mFEHLER: %s\033[0m\n' "$*"; exit 1; }

# --- 0. Erstlauf: .env prüfen ----------------------------------------------
if [[ ! -f .env ]]; then
  echo "Keine .env gefunden. Ersteinrichtung:"
  echo "  cp .env.example .env   # und alle Werte befüllen (siehe README.md)"
  exit 1
fi
# .env laden (für DATA_DIR/PORT); nur einfache KEY=VALUE-Zeilen
set -a; source <(grep -E '^[A-Z_]+=' .env); set +a
DATA_DIR="${DATA_DIR:-/srv/roses-blog/data}"
PORT="${PORT:-3000}"

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

# --- 2. Erstlauf: Datenverzeichnisse ----------------------------------------
if [[ ! -d "$DATA_DIR" ]]; then
  log "Erstlauf: lege Datenverzeichnis $DATA_DIR an"
  mkdir -p "$DATA_DIR"/{uploads,geoip,backups} \
    || fail "Konnte $DATA_DIR nicht anlegen (ggf. einmalig: sudo mkdir -p $DATA_DIR && sudo chown \$USER $DATA_DIR)"
fi
mkdir -p "$DATA_DIR"/{uploads,geoip,backups}

# --- 3. Image bauen ----------------------------------------------------------
# CPU-Check: sharps native Binärdatei braucht SSE4.2 (x86-64-v2). Fehlt das
# Flag (z. B. VM mit qemu64/kvm64-CPU-Typ), stürzt Build/Start mit SIGILL ab —
# dann automatisch die WebAssembly-Variante von sharp verwenden.
SHARP_WASM="${FORCE_SHARP_WASM:-0}"
if [[ "$SHARP_WASM" != "1" ]] && ! grep -qm1 sse4_2 /proc/cpuinfo; then
  SHARP_WASM=1
  echo "HINWEIS: CPU ohne SSE4.2 erkannt — baue mit sharp-WASM-Fallback."
  echo "         (Schneller wäre nativer Betrieb: in der VM den CPU-Typ auf"
  echo "         'host' stellen, z. B. Proxmox → Hardware → Prozessoren → Typ.)"
fi

log "Baue Container-Image (Commit $COMMIT)"
podman build --build-arg "APP_COMMIT=$COMMIT" --build-arg "SHARP_WASM=$SHARP_WASM" \
  -t localhost/roses-blog:latest -f Containerfile .

# --- 4. DB-Backup vor Migration/Neustart -------------------------------------
if [[ -f "$DATA_DIR/app.db" ]]; then
  log "Sichere Datenbank vor dem Update"
  BACKUP_FILE="$DATA_DIR/backups/pre-deploy-$(date +%Y%m%d-%H%M%S).db"
  podman run --rm -v "$DATA_DIR:/data" localhost/roses-blog:latest \
    node -e "const db=require('better-sqlite3')('/data/app.db',{readonly:true});db.backup('/data/backups/'+process.argv[1]).then(()=>{db.close();console.log('Backup ok')}).catch(e=>{console.error(e);process.exit(1)})" \
    "$(basename "$BACKUP_FILE")" || fail "DB-Backup fehlgeschlagen — Deployment abgebrochen."
  # Nur die letzten 10 Pre-Deploy-Backups behalten
  ls -1t "$DATA_DIR"/backups/pre-deploy-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

# --- 5. Container (neu) starten — Migrationen laufen im Entrypoint ----------
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

# --- 7. Erstlauf: Autostart nach Reboot --------------------------------------
if systemctl --user is-enabled podman-restart.service >/dev/null 2>&1; then
  : # Autostart bereits eingerichtet
else
  log "Richte Autostart nach Reboot ein (podman-restart.service)"
  if systemctl --user enable --now podman-restart.service >/dev/null 2>&1; then
    loginctl enable-linger "$USER" >/dev/null 2>&1 || true
    echo "Autostart aktiv (rootless, restart-policy 'always' + Linger)."
  else
    echo "HINWEIS: Autostart konnte nicht automatisch aktiviert werden."
    echo "         Siehe README.md Abschnitt 'Autostart' bzw. deploy/roses-blog.service"
  fi
fi

# --- 8. Status ----------------------------------------------------------------
log "Deployment erfolgreich"
echo "Commit:   $COMMIT"
curl -fsS "http://127.0.0.1:$PORT/health" && echo
podman ps --filter name=roses-blog --format "Container: {{.Names}} ({{.Status}})"
