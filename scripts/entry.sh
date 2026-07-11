#!/bin/sh
# Container-Entrypoint: Migrationen anwenden, dann Server starten.
# Das DB-Backup vor Migrationen übernimmt deploy.sh auf dem Host.
set -e

echo "[entry] Wende Datenbank-Migrationen an ..."
node scripts/migrate.mjs

echo "[entry] Starte Server (Commit: ${APP_COMMIT:-dev}) ..."
exec node server.js
