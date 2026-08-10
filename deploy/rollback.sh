#!/usr/bin/env bash
# Rollback (A-06/B-11) — rollt das vorige Image (:previous) zurück und stellt
# optional das jüngste Pre-Deploy-DB-Backup wieder her, mit Healthcheck-Gate.
# Der Rollback ist damit GEÜBT und GETIMT (Skript misst die Dauer), nicht ad hoc.
#
#   ./deploy/rollback.sh            # Image zurückrollen (DB unangetastet)
#   ./deploy/rollback.sh --with-db  # zusätzlich jüngstes Pre-Deploy-DB-Backup einspielen
#   ./deploy/rollback.sh --dry-run  # nur prüfen, was getan würde (nichts ändern)
set -euo pipefail

cd "$(dirname "$0")/.."

start=$(date +%s)
log(){ echo "[rollback] $*"; }
fail(){ echo "[rollback] FEHLER: $*" >&2; exit 1; }

# DIESELBE Konfigurationsquelle wie deploy.sh. Vorher riet das Skript
# DATA_DIR=/opt/roses/data und PORT=3000 — auf der echten Anlage liegen die
# Daten woanders und der Port ist 3011. Folge: Das Health-Gate unten pollte
# einen toten Port und konnte NIE grün werden (beobachtet 2026-08-10: der
# Rollback lief durch, sein Gate hing 60 s und musste abgebrochen werden), und
# `--with-db` hätte im falschen Verzeichnis nach Backups gesucht.
if [[ -f .env ]]; then
  set -a; source <(grep -E '^[A-Z_]+=' .env); set +a
fi
DATA_DIR="${DATA_DIR:-/srv/roses-blog/data}"
PORT="${PORT:-3000}"
# 127.0.0.1 statt localhost: der Container veröffentlicht ausdrücklich auf
# 127.0.0.1; ein localhost, das zuerst auf ::1 auflöst, läuft ins Leere.
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:$PORT/health}"
# Provider-Ermittlung wie in deploy.sh — ein hart verdrahtetes podman-compose
# scheitert auf Anlagen, die nur `podman compose` haben.
COMPOSE="podman compose"
podman compose version >/dev/null 2>&1 || {
  command -v podman-compose >/dev/null && COMPOSE="podman-compose" \
    || fail "Weder 'podman compose' noch 'podman-compose' im PATH."
}
WITH_DB=0; DRY=0
for a in "$@"; do case "$a" in --with-db) WITH_DB=1;; --dry-run) DRY=1;; esac; done

# 1. Vorbedingung: es GIBT ein voriges Image.
podman image exists localhost/roses-blog:previous 2>/dev/null \
  || fail "Kein :previous-Image vorhanden — nichts zum Zurückrollen (erst nach dem zweiten Deploy verfügbar)."

# 1b. …und es ist ein ANDERES als das laufende. Sind beide Tags identisch,
# rollt der Lauf nichts zurück und dürfte sich nicht „erfolgreich" nennen
# (stiller No-op statt ehrlicher Befund).
VORIG_ID="$(podman image inspect -f '{{.Id}}' localhost/roses-blog:previous 2>/dev/null || echo previous)"
AKTUELL_ID="$(podman image inspect -f '{{.Id}}' localhost/roses-blog:latest 2>/dev/null || echo latest)"
[[ "$VORIG_ID" != "$AKTUELL_ID" ]] \
  || fail ":previous und :latest sind identisch — es gibt nichts zurückzurollen (kein stiller No-op)."

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
# deploy-state entwerten: die Datei beschreibt, welcher Stand ZULETZT ERFOLGREICH
# ausgerollt wurde, und ist die Grundlage des Schnellpfads in deploy.sh. Bleibt
# sie nach einem Rollback stehen, hält deploy.sh den zurückgerollten Server für
# aktuell und deployt nie wieder (beobachtet 2026-08-10: „Bereits aktuell
# (Commit c60bea7)", während das alte Image lief).
rm -f "$DATA_DIR/deploy-state" 2>/dev/null || true
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
