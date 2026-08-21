#!/usr/bin/env bash
# ============================================================================
# Spielt ein Konfigurationsschnipsel in den Nginx-Proxy-Manager-Container ein —
# idempotent, und mit Rückrollen, falls nginx die neue Fassung ablehnt.
#
#   npm-snippet-einspielen.sh --container NAME --datei PFAD [--ziel PFAD]
#
# WARUM DAS DEPLOY DAS SELBST TUT: Die Anwendung liefert bewusst unkomprimiert
# aus (next.config.ts: compress:false) und setzt einen komprimierenden Proxy
# voraus. Diese Voraussetzung als „bitte einmal von Hand einspielen" zu
# hinterlassen, hieße, sie dem Vergessen zu überlassen — und ein Deploy, der
# eine unerfüllte Voraussetzung nur beklagt, hat nichts sichergestellt. Genau
# so hält deploy.sh es beim Autostart schon: bei JEDEM Lauf prüfen, nicht
# einmalig einrichten.
#
# DIE GEFÄHRLICHE STELLE, und deshalb gibt es diese Datei überhaupt getrennt:
# Das Schnipsel gilt für den GESAMTEN Proxy, also auch für andere Hosts darauf.
# Eine abgelehnte Konfiguration darf dort niemals liegen bleiben — beim
# nächsten Neustart des Containers käme nginx sonst gar nicht mehr hoch, und
# zwar für alle Seiten. Der Rückrollpfad ist damit wichtiger als der Erfolgs-
# pfad, und er ist in tests/npm-snippet.test.ts nachgestellt.
#
# PODMAN ist über $PODMAN austauschbar — genau dafür.
# ============================================================================
set -euo pipefail

CONTAINER=""; DATEI=""; ZIEL="/data/nginx/custom/http_top.conf"
while [ $# -gt 0 ]; do
  case "$1" in
    --container) CONTAINER="${2:-}"; shift 2 ;;
    --datei)     DATEI="${2:-}"; shift 2 ;;
    --ziel)      ZIEL="${2:-}"; shift 2 ;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$CONTAINER" ] || { echo "FEHLER: --container fehlt." >&2; exit 2; }
[ -s "$DATEI" ] || { echo "FEHLER: --datei fehlt oder ist leer: $DATEI" >&2; exit 2; }

PODMAN="${PODMAN:-podman}"
SICHERUNG="$ZIEL.vor-roses"

# Schon aktuell? Dann NICHT anfassen — und vor allem nicht neu laden. Ein
# Reload trifft alle Hosts des Proxys; ihn bei jedem Deploy grundlos
# auszulösen wäre eine Zumutung für fremde Seiten.
if $PODMAN exec "$CONTAINER" cat "$ZIEL" 2>/dev/null | diff -q - "$DATEI" >/dev/null 2>&1; then
  echo "  Schnipsel ist bereits aktuell ($ZIEL) — nichts zu tun."
  exit 0
fi

echo "  Spiele $DATEI nach $CONTAINER:$ZIEL ein"
$PODMAN exec "$CONTAINER" mkdir -p "$(dirname "$ZIEL")"

# Vorhandene Fassung sichern, damit es etwas zum Zurückrollen GIBT.
VORHANDEN=0
if $PODMAN exec "$CONTAINER" test -f "$ZIEL" 2>/dev/null; then
  VORHANDEN=1
  $PODMAN exec "$CONTAINER" cp "$ZIEL" "$SICHERUNG"
fi

zurueckrollen() {
  if [ "$VORHANDEN" = 1 ]; then
    $PODMAN exec "$CONTAINER" mv "$SICHERUNG" "$ZIEL" || true
    echo "  Vorherige Fassung wiederhergestellt." >&2
  else
    $PODMAN exec "$CONTAINER" rm -f "$ZIEL" || true
    echo "  Neu angelegte Datei wieder entfernt." >&2
  fi
}

if ! $PODMAN cp "$DATEI" "$CONTAINER:$ZIEL"; then
  zurueckrollen
  echo "FEHLER: Datei ließ sich nicht in den Container kopieren." >&2
  exit 1
fi

if ! $PODMAN exec "$CONTAINER" nginx -t; then
  zurueckrollen
  echo "FEHLER: nginx lehnt die Konfiguration ab — nichts wurde übernommen." >&2
  echo "        Der Proxy läuft mit der bisherigen Fassung weiter." >&2
  exit 1
fi

if ! $PODMAN exec "$CONTAINER" nginx -s reload; then
  zurueckrollen
  echo "FEHLER: Neuladen fehlgeschlagen — Konfiguration zurückgerollt." >&2
  exit 1
fi

[ "$VORHANDEN" = 1 ] && $PODMAN exec "$CONTAINER" rm -f "$SICHERUNG"
echo "  Eingespielt und neu geladen."
exit 0
