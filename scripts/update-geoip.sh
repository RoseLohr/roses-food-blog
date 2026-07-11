#!/usr/bin/env bash
# Lädt die DB-IP IP-to-Country Lite (CC BY 4.0, https://db-ip.com/db/download/ip-to-country-lite)
# in das GeoIP-Verzeichnis. Ohne diese Datei läuft die App normal weiter,
# das Land wird dann als "unbekannt" erfasst (siehe docs/ASSUMPTIONS.md B2).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$REPO_DIR/.env" ]] && { set -a; source <(grep -E '^[A-Z_]+=' "$REPO_DIR/.env"); set +a; }
DATA_DIR="${DATA_DIR:-/srv/roses-blog/data}"
GEO_DIR="$DATA_DIR/geoip"
mkdir -p "$GEO_DIR"

YM="$(date +%Y-%m)"
URL="https://download.db-ip.com/free/dbip-country-lite-$YM.mmdb.gz"

echo "Lade $URL ..."
if curl -fsSL "$URL" -o "$GEO_DIR/download.mmdb.gz"; then
  gunzip -f "$GEO_DIR/download.mmdb.gz"          # erzeugt download.mmdb
  mv -f "$GEO_DIR/download.mmdb" "$GEO_DIR/country.mmdb"
  echo "GeoIP-Datenbank aktualisiert: $GEO_DIR/country.mmdb"
else
  echo "FEHLER: Download fehlgeschlagen (Monat $YM evtl. noch nicht verfügbar)."
  exit 1
fi
