#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Konsistentes Backup: SQLite (.backup über die Online-Backup-API) + Uploads.
# Rotation: 14 Tage. Aufruf manuell oder per Cron, z. B. täglich um 03:30:
#
#   30 3 * * * /home/deploy/roses-food-blog/deploy/backup.sh >> /home/deploy/backup.log 2>&1
#
# Restore: siehe README.md Abschnitt "Backup & Restore".
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"
[[ -f .env ]] && { set -a; source <(grep -E '^[A-Z_]+=' .env); set +a; }

DATA_DIR="${DATA_DIR:-/srv/roses-blog/data}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

# 1. SQLite konsistent sichern (Online-Backup-API, funktioniert bei laufender App)
# DB-Fehler darf das Uploads-Backup NICHT verhindern — daher gekapselt (kein
# Abbruch durch set -e), Uploads werden anschließend trotzdem gesichert.
if [[ -f "$DATA_DIR/app.db" ]]; then
  if podman run --rm --entrypoint node -v "$DATA_DIR:/data" localhost/roses-blog:latest \
       -e "const db=require('better-sqlite3')('/data/app.db',{readonly:true});db.backup('/data/backups/'+process.argv[1]).then(()=>{db.close()}).catch(e=>{console.error(e);process.exit(1)})" \
       "app-$STAMP.db" \
     && gzip "$BACKUP_DIR/app-$STAMP.db"; then
    echo "DB-Backup:      $BACKUP_DIR/app-$STAMP.db.gz"
  else
    echo "WARNUNG: DB-Backup fehlgeschlagen — fahre mit Uploads-Backup fort."
    rm -f "$BACKUP_DIR/app-$STAMP.db"   # evtl. Teil-Datei entfernen
  fi
else
  echo "WARNUNG: $DATA_DIR/app.db nicht gefunden — kein DB-Backup."
fi

# 2. Uploads archivieren
if [[ -d "$DATA_DIR/uploads" ]]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$DATA_DIR" uploads
  echo "Uploads-Backup: $BACKUP_DIR/uploads-$STAMP.tar.gz"
fi

# 3. Rotation (auch etwaige unkomprimierte Reste fehlgeschlagener Läufe)
find "$BACKUP_DIR" -maxdepth 1 -name 'app-*.db.gz' -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'app-*.db' -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "Backup abgeschlossen: $STAMP"
