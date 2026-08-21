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

# Rollt zurück UND SIEHT NACH, ob es geklappt hat. Rückgabe 0 = der Proxy ist
# wieder in einem Zustand, den nginx annimmt; 1 = er ist es NICHT.
#
# DIE ERSTE FASSUNG SCHRIEB HIER `|| true` — ausgerechnet im Rückrollpfad.
# Scheitert dort das `mv` oder `rm`, bleibt die abgelehnte Fassung liegen, das
# Skript meldet nur den ursprünglichen Fehler, und beim nächsten Neustart des
# Proxys kommt er für ALLE Hosts nicht mehr hoch. Ein verschluckter Fehler an
# genau der Stelle, die den Schaden verhindern soll.
#
# Deshalb wird dem Exit-Code auch nicht geglaubt, sondern der ZUSTAND geprüft:
# `nginx -t` muss danach wieder durchgehen. Das ist die Frage, auf die es
# ankommt — nicht, ob ein einzelnes Kommando 0 zurückgab.
zurueckrollen() {
  if [ "$VORHANDEN" = 1 ]; then
    $PODMAN exec "$CONTAINER" mv "$SICHERUNG" "$ZIEL" || true
  else
    $PODMAN exec "$CONTAINER" rm -f "$ZIEL" || true
  fi
  if $PODMAN exec "$CONTAINER" nginx -t >/dev/null 2>&1; then
    echo "  Zurückgerollt — nginx nimmt die Konfiguration wieder an." >&2
    return 0
  fi
  echo "" >&2
  echo "!!! ACHTUNG: Das Zurückrollen hat NICHT funktioniert." >&2
  echo "!!! Im Proxy liegt eine Konfiguration, die nginx ablehnt. Der laufende" >&2
  echo "!!! Prozess arbeitet noch mit der alten Fassung im Speicher — beim" >&2
  echo "!!! nächsten Neustart käme er für ALLE Hosts nicht mehr hoch." >&2
  echo "!!!" >&2
  echo "!!! Von Hand beheben, BEVOR der Proxy neu startet:" >&2
  echo "!!!   podman exec $CONTAINER rm -f $ZIEL" >&2
  echo "!!!   podman exec $CONTAINER ls -la $(dirname "$ZIEL")   # Sicherung $SICHERUNG?" >&2
  echo "!!!   podman exec $CONTAINER nginx -t" >&2
  return 1
}

# Ruft zurueckrollen auf und beendet mit dem Code, der dem Ergebnis entspricht:
# 1 = eingespielt hat nicht geklappt, Proxy aber unversehrt.
# 3 = der Proxy ist in einem gefährlichen Zustand und braucht eine Hand.
abbrechen() {
  local meldung="$1"
  if zurueckrollen; then
    echo "FEHLER: $meldung" >&2
    exit 1
  fi
  echo "FEHLER: $meldung" >&2
  exit 3
}

if ! $PODMAN cp "$DATEI" "$CONTAINER:$ZIEL"; then
  abbrechen "Datei ließ sich nicht in den Container kopieren."
fi

if ! $PODMAN exec "$CONTAINER" nginx -t; then
  abbrechen "nginx lehnt die Konfiguration ab — nichts wurde übernommen."
fi

if ! $PODMAN exec "$CONTAINER" nginx -s reload; then
  abbrechen "Neuladen fehlgeschlagen."
fi

if [ "$VORHANDEN" = 1 ]; then $PODMAN exec "$CONTAINER" rm -f "$SICHERUNG" || true; fi
echo "  Eingespielt und neu geladen."
exit 0
