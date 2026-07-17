#!/usr/bin/env bash
# Rollback (A-06/B-11) — rollt das vorige Image (:previous) zurück und stellt
# optional das jüngste Pre-Deploy-DB-Backup wieder her, mit Healthcheck-Gate.
# Der Rollback ist damit GEÜBT und GETIMT (Skript misst die Dauer), nicht ad hoc.
#
#   ./deploy/rollback.sh            # Image zurückrollen (DB unangetastet)
#   ./deploy/rollback.sh --with-db  # zusätzlich jüngstes Pre-Deploy-DB-Backup einspielen
#   ./deploy/rollback.sh --dry-run  # nur prüfen, was getan würde (nichts ändern)
set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/roses/data}"
PORT="${PORT:-3000}"
HEALTH_URL="${HEALTH_URL:-http://localhost:$PORT/health}"
COMPOSE="${COMPOSE:-podman-compose}"
WITH_DB=0; DRY=0
for a in "$@"; do case "$a" in --with-db) WITH_DB=1;; --dry-run) DRY=1;; esac; done

start=$(date +%s)
log(){ echo "[rollback] $*"; }
fail(){ echo "[rollback] FEHLER: $*" >&2; exit 1; }

# 1. Vorbedingung: es GIBT ein voriges Image.
podman image exists localhost/roses-blog:previous 2>/dev/null \
  || fail "Kein :previous-Image vorhanden — nichts zum Zurückrollen (erst nach dem zweiten Deploy verfügbar)."

if [[ $DRY -eq 1 ]]; then
  log "DRY-RUN: würde :previous → :latest taggen, Container neu starten$( [[ $WITH_DB -eq 1 ]] && echo ', DB-Backup einspielen' )."
  ls -1t "$DATA_DIR"/backups/pre-deploy-*.db 2>/dev/null | head -1 | sed 's/^/[rollback] jüngstes Backup: /' || true
  exit 0
fi

# 2. Optional DB zurückspielen (jüngstes Pre-Deploy-Backup).
if [[ $WITH_DB -eq 1 ]]; then
  BACKUP=$(ls -1t "$DATA_DIR"/backups/pre-deploy-*.db 2>/dev/null | head -1 || true)
  [[ -n "$BACKUP" ]] || fail "--with-db verlangt, aber kein Pre-Deploy-Backup gefunden."
  log "Sichere aktuelle DB und spiele Backup ein: $BACKUP"
  cp "$DATA_DIR/app.db" "$DATA_DIR/backups/pre-rollback-$(date +%Y%m%d-%H%M%S).db" 2>/dev/null || true
  cp "$BACKUP" "$DATA_DIR/app.db"
fi

# 3. Image zurückrollen + Container neu starten.
log "Rolle Image zurück: :previous → :latest"
podman tag localhost/roses-blog:previous localhost/roses-blog:latest
$COMPOSE down --remove-orphans >/dev/null 2>&1 || true
podman rm -f roses-blog >/dev/null 2>&1 || true
$COMPOSE up -d || fail "Container-Neustart fehlgeschlagen."

# 4. Healthcheck-Gate: erst grün, dann gilt der Rollback als erfolgreich.
for i in $(seq 1 30); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    dur=$(( $(date +%s) - start ))
    log "Rollback erfolgreich in ${dur}s (Health grün)."
    exit 0
  fi
  sleep 2
done
fail "Health nach Rollback nicht grün — manuell prüfen (podman logs roses-blog)."
