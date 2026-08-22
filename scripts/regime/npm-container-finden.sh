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
#   1. der Container veröffentlicht nicht IRGENDEINEN anderen Port als unseren,
#   2. er ist wirklich ein nginx (`nginx -v` läuft darin),
#   3. unter /data/nginx/proxy_host/ steht eine Konfiguration, die GENAU
#      diesen Namen bedient,
#   4. und dieselbe Konfiguration lauscht auf GENAU unserem Port.
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
PORT="$URL_PORT"

PODMAN="${PODMAN:-podman}"

# Kein `| head` in der Zuweisung: SIGPIPE beendet unter `set -e -o pipefail`
# das ganze Skript (an anderer Stelle in diesem Verzeichnis nachgemessen).
LAUFENDE=$($PODMAN ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null) || LAUFENDE=""
[ -n "$LAUFENDE" ] || { echo "Kein laufender Container gefunden." >&2; exit 1; }

TREFFER=""
ANZAHL=0
ANZAHL_MIT_PORT=0
VERWORFEN=""
verworfen() { VERWORFEN="$VERWORFEN  $1: $2"$'\n'; }

while IFS= read -r zeile; do
  [ -n "$zeile" ] || continue
  name=${zeile%%|*}
  ports=${zeile#*|}

  # DER PORT IST KEIN TOR, SONDERN EINE AUSWAHLHILFE.
  #
  # Die erste Fassung verlangte, dass der Container den Port aus der Basis
  # veröffentlicht. Auf dem echten Server schloss das ausgerechnet den
  # richtigen Proxy aus: Er läuft in einem Pod (bzw. mit Host-Netzwerk), und
  # `podman ps` weist ihm deshalb GAR KEINE Ports zu — die Portspalte ist leer,
  # während nginx darin auf 80/443 lauscht. Gemessen am 22.08.2026:
  #
  #   nginx-proxy-manager|localhost/leaf-migration-npm:…|      ← keine Ports
  #   roses-blog|localhost/roses-blog:latest|127.0.0.1:3011->3000/tcp
  #
  # Die beiden Merkmale, die den Proxy WIRKLICH ausweisen, sind die anderen
  # zwei: Er ist ein nginx, und seine Konfiguration bedient genau diesen Namen.
  # Der Port hilft nur, wenn mehrere davon in Frage kommen.
  #
  # Verworfen wird deshalb nur, wer Ports veröffentlicht und unseren NICHT
  # dabei hat — das ist eine echte Unstimmigkeit. Wer gar keine veröffentlicht,
  # wird an den anderen Merkmalen gemessen.
  hat_unseren_port=0
  case "$ports" in
    *:"$PORT"-\>*) hat_unseren_port=1 ;;
    "") ;;   # keine Veröffentlichung — sagt für sich genommen NICHTS, siehe unten
    *:*-\>*) verworfen "$name" "veröffentlicht Ports, aber nicht $PORT ($ports)"; continue ;;
  esac

  if ! $PODMAN exec "$name" nginx -v >/dev/null 2>&1; then
    verworfen "$name" "kein nginx darin"
    continue
  fi
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
  if [ -z "$konf" ]; then
    verworfen "$name" "keine Proxy-Host-Konfiguration unter /data/nginx/proxy_host/"
    continue
  fi
  namen=$(printf '%s\n' "$konf" \
    | sed 's/#.*$//' \
    | grep -E '^[[:space:]]*server_name[[:space:]]' \
    | sed -e 's/;.*$//' -e 's/^[[:space:]]*server_name[[:space:]]*//' \
    | tr -s ' \t' '\n' | tr 'A-Z' 'a-z') || namen=""
  # nginx' Namenssemantik nachbilden, nicht bloß Zeichen vergleichen. Ein
  # Literalvergleich verfehlte zwei gängige Fälle (Befund des Pflicht-
  # Approvers, PR #103):
  #   - Groß/Kleinschreibung: `server_name GourmetCompass.de` bedient dieselbe
  #     Domain. Beide Seiten werden deshalb kleingeschrieben.
  #   - Platzhalter: `*.example.de` bedient `www.example.de`, und die nginx-
  #     Kurzform `.example.de` bedient beides — den Namen selbst und jede
  #     Unterdomäne. Ohne das bliebe das Schnipsel aus und das Kompressions-
  #     Gate scheiterte anschließend, obwohl alles richtig eingerichtet ist.
  #
  # `case` mit unquotiertem Muster ist hier genau das richtige Werkzeug: Es
  # vergleicht als Muster, führt aber nichts aus.
  #
  # ABSICHTLICH NICHT ZUGEORDNET: Regex-Namen (`~^…$`) und der Auffangname `_`.
  # Ersteres wäre Raten, Letzteres würde JEDEN Proxy passen lassen — und in
  # einen beliebigen fremden Container zu schreiben ist genau der Fehler, den
  # diese Datei verhindern soll. Wer so einrichtet, bekommt „nicht zugeordnet"
  # und damit kein Schnipsel; das Kompressions-Gate meldet es dann.
  passt=0
  while IFS= read -r muster; do
    [ -n "$muster" ] || continue
    case "$muster" in '~'*|'_') continue ;; esac
    case "$muster" in
      .*) rumpf=${muster#.}
          [ "$HOST" = "$rumpf" ] && { passt=1; break; }
          case "$HOST" in *".$rumpf") passt=1; break ;; esac ;;
      *)  case "$HOST" in $muster) passt=1; break ;; esac ;;
    esac
  done <<< "$namen"
  if [ "$passt" != 1 ]; then
    verworfen "$name" "bedient '$HOST' nicht"
    continue
  fi

  # DRITTES MERKMAL: Die Konfiguration muss auf UNSEREM Port lauschen.
  #
  # Vorher galt „veröffentlicht keine Ports" als Freibrief — begründet mit dem
  # Pod bzw. Host-Netzwerk dieses Servers. Das ist aber kein Beleg, sondern nur
  # die Abwesenheit eines Gegenbeweises: Ein abgeschotteter Bridge-Container
  # veröffentlicht ebenfalls nichts, und trüge er zufällig eine passende
  # NPM-Konfiguration, wäre er der einzige Treffer gewesen.
  # (Befund des Pflicht-Approvers, PR #105.)
  #
  # `listen` ist das positive Gegenstück und steht in derselben Konfiguration,
  # die ohnehin schon gelesen wurde — auch bei Pod und Host-Netzwerk, wo die
  # Portspalte leer bleibt. Auf diesem Server: `listen 443 ssl;`.
  # Abgedeckte Schreibweisen (durchgespielt): `443`, `[::]:443`, `0.0.0.0:8443`,
  # mit Zusätzen wie `ssl http2`; Kommentare und `unix:`-Sockets fallen heraus.
  lauscht=$(printf '%s\n' "$konf" \
    | sed 's/#.*$//' \
    | grep -E '^[[:space:]]*listen[[:space:]]' \
    | sed -e 's/;.*$//' -e 's/^[[:space:]]*listen[[:space:]]*//' \
    | awk '{print $1}' \
    | sed -e 's/.*\]://' -e 's/^.*:\([0-9][0-9]*\)$/\1/' \
    | grep -E '^[0-9]+$') || lauscht=""
  if ! printf '%s\n' "$lauscht" | grep -Fxq -- "$PORT"; then
    verworfen "$name" "lauscht laut Konfiguration nicht auf $PORT (gefunden: $(printf '%s' "$lauscht" | tr '\n' ' '))"
    continue
  fi
  TREFFER="$TREFFER$name"$'\n'
  ANZAHL=$((ANZAHL + 1))
  if [ "$hat_unseren_port" = 1 ]; then
    # Nur noch für die Meldung bei Mehrdeutigkeit gezählt — entschieden wird
    # damit NICHT (siehe unten).
    ANZAHL_MIT_PORT=$((ANZAHL_MIT_PORT + 1))
  fi
# Gespeist wird die Schleife mit einem Here-String. Ein unquotiertes Heredoc
# ist im Projekt verboten — sein Rumpf würde von der Shell ausgewertet (Regel
# aus dem Vorfall 2026-08-14, erzwungen von tests/deploy-betrieb.test.ts). Und
# eine Pipe scheidet aus: Die Schleife liefe in einer Subshell, TREFFER und
# ANZAHL kämen nie hier an.
done <<< "$LAUFENDE"

if [ "$ANZAHL" -eq 0 ]; then
  # Sagen, WAS geprüft und warum verworfen wurde. Die erste Fassung meldete nur
  # „nicht gefunden" — und dass der richtige Container am Portfilter scheiterte,
  # war daran nicht zu erkennen.
  echo "Kein Proxy-Container gefunden, der '$HOST' bedient." >&2
  if [ -n "$VERWORFEN" ]; then
    echo "Geprüft und verworfen:" >&2
    printf '%s' "$VERWORFEN" >&2
  fi
  exit 1
fi

if [ "$ANZAHL" -gt 1 ]; then
  # KEIN STICHENTSCHEID PER PORT. Eine frühere Fassung wählte unter mehreren
  # Treffern den, der unseren Port veröffentlicht — das sah nach einer Regel
  # aus, war aber geraten: Auf DIESEM Server veröffentlicht der richtige Proxy
  # gar keine Ports (Pod bzw. Host-Netzwerk), während ein fremder nginx auf 443
  # welche hätte. Der Stichentscheid hätte also ausgerechnet den falschen
  # gewählt und ihn global umkonfiguriert. (Befund des Pflicht-Approvers,
  # PR #105.)
  #
  # Bedienen wirklich mehrere denselben Namen, gibt es keine verlässliche
  # Unterscheidung mehr — dann ist Nichtstun die richtige Antwort.
  echo "Mehrdeutig: $ANZAHL Container bedienen '$HOST' —" >&2
  printf '%s' "$TREFFER" | sed 's/^/  /' >&2
  if [ "$ANZAHL_MIT_PORT" -gt 0 ]; then
    echo "Davon veröffentlichen $ANZAHL_MIT_PORT den Port $PORT. Das entscheidet NICHT:" >&2
    echo "Ein Proxy im Pod oder mit Host-Netzwerk veröffentlicht gar keine Ports und" >&2
    echo "kann trotzdem der richtige sein." >&2
  fi
  echo "Hier wird nicht geraten. Bitte von Hand entscheiden." >&2
  exit 2
fi

printf '%s\n' "${TREFFER%%$'\n'*}"
exit 0
