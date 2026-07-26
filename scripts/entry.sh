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

# Bild-Varianten auf die aktuelle Encoder-Revision nachziehen (idempotent,
# je Bild ein Marker). Im HINTERGRUND: blockiert den Serverstart nicht —
# bei unveränderter Revision ist der Lauf ohnehin in <1 s fertig.
# Cache-sicher trotz Hintergrund: die Auslieferungs-Route gibt `immutable`
# erst, wenn der Marker eines Bildes die aktuelle Revision bestätigt —
# während des Nachzugs bleiben die Antworten kurzlebig (kein Stale-Pinning).
# Ein Fehlschlag wird sichtbar gemeldet (fail-open nur für die KOMPRESSION,
# nie für die Korrektheit) und beim nächsten Start automatisch erneut versucht.
echo "[entry] Prüfe Bild-Varianten (Encoder-Revision) ..."
( node scripts/regenerate-variants.mjs \
  || echo "[entry] WARNUNG: Bild-Regenerierung unvollständig (Details oben) — betroffene Bilder bleiben kurzlebig gecacht; nächster Start versucht es erneut." ) &

echo "[entry] Starte Server (Commit: ${APP_COMMIT:-dev}) ..."
exec node server.js
