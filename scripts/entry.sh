#!/bin/sh
# Container-Entrypoint: Migrationen anwenden, dann Server starten.
# Das DB-Backup vor Migrationen übernimmt deploy.sh auf dem Host.
set -e

# LOW_CPU-Image: libvips-CLI vorhanden → Bildpipeline auf vips umschalten
if [ -z "${IMAGE_BACKEND:-}" ] && command -v vipsthumbnail >/dev/null 2>&1; then
  export IMAGE_BACKEND=vips
  echo "[entry] Bild-Backend: libvips-CLI (IMAGE_BACKEND=vips)"
fi

echo "[entry] Wende Datenbank-Migrationen an ..."
node scripts/migrate.mjs

echo "[entry] Starte Server (Commit: ${APP_COMMIT:-dev}) ..."
exec node server.js
