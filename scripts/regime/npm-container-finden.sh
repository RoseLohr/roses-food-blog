#!/usr/bin/env bash
# ============================================================================
# Findet den Reverse-Proxy-Container, der WIRKLICH vor dieser Domain steht.
#
#   npm-container-finden.sh --basis <url>
#
#   Ausgabe: der Containername auf stdout.
#   Rückgabe: 0 = genau einer gefunden · 1 = keiner · 2 = mehrdeutig.
#
# WARUM POSITIV IDENTIFIZIERT WIRD, statt den ersten Treffer zu nehmen:
# Die erste Fassung nahm die erste Zeile aus `podman ps`, die auf
# `:80->`, `:443->`, „nginx-proxy-manager" oder „openresty" passte. Auf einem
# Host mit mehreren solchen Containern hätte das Deploy damit eine GLOBALE
# nginx-Konfiguration in einen fremden Container geschrieben — und den
# richtigen womöglich übersprungen. Bei geteilter Infrastruktur ist Raten die
# falsche Antwort. (Befund des Pflicht-Approvers, PR #103.)
#
# Drei Bedingungen müssen zusammen erfüllt sein:
#   1. der Container veröffentlicht 80 oder 443,
#   2. er ist wirklich ein nginx (`nginx -v` läuft darin),
#   3. unter /data/nginx/proxy_host/ steht eine Konfiguration, die GENAU
#      diesen Namen bedient.
#
# Bedingung 3 ist die eigentliche Zuordnung: Sie macht aus „irgendein Proxy"
# ein „der Proxy DIESER Domain". Passen mehrere, wird NICHT gewählt — dann
# meldet das Skript Mehrdeutigkeit, und der Aufrufer entscheidet.
# ============================================================================
set -euo pipefail

BASIS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --basis) BASIS="${2:-}"; shift 2 ;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 3 ;;
  esac
done
[ -n "$BASIS" ] || { echo "FEHLER: --basis fehlt." >&2; exit 3; }
# Zerlegung aus der gemeinsamen Quelle — nicht noch eine eigene Fassung.
# shellcheck source=scripts/regime/url-teile.sh
. "$(dirname "$0")/url-teile.sh"
if ! url_teile "$BASIS"; then
  echo "FEHLER: --basis ist keine brauchbare URL: '$BASIS'" >&2
  exit 3
fi
HOST="$URL_HOST"

PODMAN="${PODMAN:-podman}"

# Kein `| head` in der Zuweisung: SIGPIPE beendet unter `set -e -o pipefail`
# das ganze Skript (an anderer Stelle in diesem Verzeichnis nachgemessen).
LAUFENDE=$($PODMAN ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null) || LAUFENDE=""
[ -n "$LAUFENDE" ] || { echo "Kein laufender Container gefunden." >&2; exit 1; }

TREFFER=""
ANZAHL=0
while IFS= read -r zeile; do
  [ -n "$zeile" ] || continue
  name=${zeile%%|*}
  ports=${zeile#*|}
  case "$ports" in *:80-\>*|*:443-\>*) ;; *) continue ;; esac
  $PODMAN exec "$name" nginx -v >/dev/null 2>&1 || continue
  # Im Container wird nur GELESEN, mit einem FESTEN Kommando. Ausgewertet wird
  # hier draußen. Zwei Gründe, beide vom Pflicht-Approver gefunden (PR #103):
  #
  #  1. Die erste Fassung baute `$HOST` in eine `sh -c`-Zeichenkette. Ein Wert
  #     wie `x' >/dev/null; true #` hätte die Prüfung immer bestehen lassen —
  #     und dann schriebe deploy.sh eine globale Konfiguration in den
  #     erstbesten fremden nginx. Fremde Daten gehören nicht in eine
  #     Kommandozeichenkette; als Argument an grep sind sie harmlos.
  #  2. Die erste Fassung zerlegte die ganze Zeile in Wörter — samt Kommentar.
  #     `server_name fremd.de; # ziel.de` hätte „ziel.de" diesem Container
  #     zugeordnet. Eine nginx-Direktive endet am Semikolon, und alles hinter
  #     `#` ist Kommentar.
  konf=$($PODMAN exec "$name" sh -c 'cat /data/nginx/proxy_host/*.conf 2>/dev/null') || konf=""
  [ -n "$konf" ] || continue
  namen=$(printf '%s\n' "$konf" \
    | sed 's/#.*$//' \
    | grep -E '^[[:space:]]*server_name[[:space:]]' \
    | sed -e 's/;.*$//' -e 's/^[[:space:]]*server_name[[:space:]]*//' \
    | tr -s ' \t' '\n') || namen=""
  printf '%s\n' "$namen" | grep -Fxq -- "$HOST" || continue
  TREFFER="$TREFFER$name"$'\n'
  ANZAHL=$((ANZAHL + 1))
# Gespeist wird die Schleife mit einem Here-String. Ein unquotiertes Heredoc
# ist im Projekt verboten — sein Rumpf würde von der Shell ausgewertet (Regel
# aus dem Vorfall 2026-08-14, erzwungen von tests/deploy-betrieb.test.ts). Und
# eine Pipe scheidet aus: Die Schleife liefe in einer Subshell, TREFFER und
# ANZAHL kämen nie hier an.
done <<< "$LAUFENDE"

if [ "$ANZAHL" -eq 0 ]; then
  echo "Kein Proxy-Container gefunden, der '$HOST' bedient." >&2
  exit 1
fi
if [ "$ANZAHL" -gt 1 ]; then
  echo "Mehrdeutig: $ANZAHL Container bedienen '$HOST' —" >&2
  printf '%s' "$TREFFER" | sed 's/^/  /' >&2
  echo "Hier wird nicht geraten. Bitte von Hand entscheiden." >&2
  exit 2
fi
printf '%s\n' "${TREFFER%%$'\n'*}"
exit 0
