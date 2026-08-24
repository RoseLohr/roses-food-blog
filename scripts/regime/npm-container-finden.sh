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
#      diesen Namen bedient.
#
# Der Port wird IMMER auf der HOST-Seite verglichen, aber je nach Netzlage aus
# einer anderen Quelle: aus der eigenen Portspalte, aus der des Pods, oder —
# nur im Host-Netzwerk, wo es keine Abbildung gibt und beide Seiten dieselbe
# Zahl sind — aus den `listen`-Zeilen. Die `listen`-Zahl gegen die URL zu
# halten, WÄHREND eine Abbildung besteht, wäre falsch: bei 8443->443 sind das
# verschiedene Zahlen.
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
  # Verglichen wird HOST-SEITE mit HOST-SEITE. In `0.0.0.0:8443->443/tcp` ist
  # 8443 die Host-Seite und 443 die Container-Seite; die URL nennt die
  # Host-Seite. Eine frühere Fassung prüfte zusätzlich die `listen`-Zeilen der
  # Konfiguration — das ist die CONTAINER-Seite und bei einem Mapping 8443->443
  # eine andere Zahl. Sie hätte den richtigen Container verworfen. Dieselbe
  # Fassung las server_name und listen außerdem über ALLE *.conf hinweg, ohne
  # sie einander zuzuordnen: `listen 8080` aus der einen Datei und
  # `server_name ziel` aus der anderen hätten zusammen bestanden.
  # (Alles drei: Befund des Pflicht-Approvers, PR #105.)
  # EINE REGEL, drei Wege zur selben Zahl.
  #
  # Gesucht ist der CONTAINER-seitige Port, auf dem eine Anfrage an
  # HOST:PORT ankommt. Erst mit ihm lässt sich fragen, ob DORT auch unser Name
  # bedient wird. Vier Anläufe an dieser Stelle sind schiefgegangen, weil sie
  # Teilfragen getrennt beantwortet und die Antworten dann zusammengeworfen
  # haben (alle vier: Befunde des Pflicht-Approvers, PR #103 und #105):
  #
  #   1. Der Port als Tor: Wer ihn nicht veröffentlicht, fliegt raus. Schloss
  #      ausgerechnet den richtigen Proxy aus, der in einem Pod liegt.
  #   2. Stichentscheid per Port unter mehreren Treffern. Auf diesem Server
  #      genau verkehrt herum.
  #   3. `listen` gegen den Port aus der URL. Das ist Container-Seite gegen
  #      Host-Seite; bei 8443->443 verschiedene Zahlen.
  #   4. Port und Name unkorreliert: irgendwo 443, irgendwo unser Name —
  #      zusammen bestanden, obwohl auf 443 ein fremder Host sitzt.
  #
  # Deshalb jetzt in EINER Reihenfolge, ohne Sonderwege:
  #   a) Container-Seite bestimmen (aus der eigenen Portspalte, aus der des
  #      Pods, oder — im Host-Netzwerk, wo es keine Abbildung gibt — direkt).
  #   b) `nginx -T` BLOCKWEISE lesen und nur die Namen nehmen, die auf genau
  #      dieser Container-Seite bedient werden.
  hat_unseren_port=0
  ZIEL_PORT=""
  namen=""

  # Aus "0.0.0.0:8443->443/tcp, [::]:8080->80/tcp" die rechte Seite zu unserem
  # Port holen. Mehrere Abbildungen je Container sind der Normalfall.
  ziel_aus_abbildung() {
    # `printf '%s\n'`, nicht '%s': Ohne abschließenden Zeilenumbruch verwirft
    # `read` die letzte Zeile — und damit ausgerechnet den einzigen Eintrag bei
    # nur einer Abbildung. Beim Testen aufgefallen, nicht beim Schreiben.
    printf '%s\n' "$1" | tr ',' '\n' | while IFS= read -r teil; do
      case "$teil" in
        *:"$PORT"-\>*)
          rest=${teil#*:"$PORT"->}
          printf '%s\n' "${rest%%/*}"
          return 0 ;;
      esac
    done
  }

  case "$ports" in
    *:"$PORT"-\>*)
      ZIEL_PORT=$(ziel_aus_abbildung "$ports")
      hat_unseren_port=1 ;;
    *:*-\>*)
      verworfen "$name" "veröffentlicht Ports, aber nicht $PORT ($ports)"; continue ;;
    *)
      # GAR KEINE Veröffentlichung in DIESER Zeile. Das sagt weder ja noch
      # nein — nur, dass die Host-Seite woanders steht.
      netz=$($PODMAN inspect "$name" --format '{{.HostConfig.NetworkMode}}|{{.Pod}}' 2>/dev/null) || netz=""
      modus=${netz%%|*}
      pod=${netz#*|}
      if [ -n "$pod" ]; then
        # POD: Veröffentlicht wird vom Infra-Container, nicht vom Mitglied.
        pod_ports=$($PODMAN ps -a --filter "pod=$pod" --format '{{.Ports}}' 2>/dev/null | tr '\n' ' ') || pod_ports=""
        case "$pod_ports" in
          *:"$PORT"-\>*)
            ZIEL_PORT=$(ziel_aus_abbildung "$pod_ports")
            hat_unseren_port=1 ;;
          *:*-\>*)
            verworfen "$name" "liegt im Pod $pod, und der Pod veröffentlicht nicht $PORT ($pod_ports)"; continue ;;
          *)
            # Pod ohne Veröffentlichung — dann trägt nur Host-Netzwerk.
            # GEFRAGT WIRD DER POD, NICHT DAS MITGLIED: Ein Mitglied meldet als
            # NetworkMode "container:<infra>", auch wenn der Pod im
            # Host-Netzwerk läuft. Die vorige Fassung prüfte das Mitglied und
            # hätte genau diesen Pod verworfen — auf diesem Server kein
            # Gedankenspiel, der Proxy liegt in einem Pod ohne Portspalte.
            pod_hostnetz=$($PODMAN pod inspect "$pod" --format '{{.InfraConfig.HostNetwork}}' 2>/dev/null) || pod_hostnetz=""
            if [ "$pod_hostnetz" != true ] && [ "$modus" != host ]; then
              verworfen "$name" "liegt im Pod $pod, der weder einen Port veröffentlicht noch im Host-Netzwerk läuft — vom Host aus nicht erreichbar"
              continue
            fi
            ZIEL_PORT="$PORT" ;;
        esac
      elif [ "$modus" = host ]; then
        # Host-Netzwerk: keine Abbildung, beide Seiten sind dieselbe Zahl.
        ZIEL_PORT="$PORT"
      else
        verworfen "$name" "veröffentlicht keinen Port und ist weder im Host-Netzwerk noch in einem Pod (Netzmodus: ${modus:-unbekannt}) — vom Host aus nicht erreichbar"
        continue
      fi ;;
  esac

  if [ -z "$ZIEL_PORT" ]; then
    # Sollte nach obiger Fallunterscheidung nicht vorkommen. Wenn doch, ist die
    # Abbildung unlesbar — und dann ist Nichtstun die richtige Antwort, nicht
    # eine Zuordnung auf Verdacht.
    verworfen "$name" "Portabbildung für $PORT nicht lesbar ($ports)"
    continue
  fi

  if ! $PODMAN exec "$name" nginx -v >/dev/null 2>&1; then
    verworfen "$name" "kein nginx darin"
    continue
  fi

  # Die Namen kommen IMMER aus `nginx -T`, der wirksamen Gesamtkonfiguration,
  # und IMMER blockweise: gesucht sind die Namen, die auf ZIEL_PORT bedient
  # werden. Die frühere Quelle /data/nginx/proxy_host/*.conf war nicht falsch,
  # aber sie kennt den Zusammenhang zum Port nicht — und genau der ist die
  # Frage. `nginx -T` enthält dieselben Dateien, nur eingeordnet.
  paare=$($PODMAN exec "$name" nginx -T 2>/dev/null | awk '
    # Je server-Block JEDES Paar aus Lauschport und bedientem Namen, als
    # "PORT<TAB>NAME". Die Klammertiefe grenzt die Blöcke ab; ohne sie würde
    # ein location-Block das Ende des server-Blocks vortäuschen.
    {
      zeile=$0
      sub(/#.*$/, "", zeile)   # Kommentar ab # — sonst zählte er als Name
      n=split(zeile, w, /[ \t]+/)
      auf=gsub(/\{/, "{", zeile); zu=gsub(/\}/, "}", zeile)
      wort=""; for (i=1;i<=n;i++) if (w[i]!="") { wort=w[i]; break }
      if (inserver==0 && wort=="server" && auf>0) { inserver=1; tiefe=0; np=0; nn=0 }
      if (inserver) {
        if (wort=="listen") {
          for (i=1;i<=n;i++) if (w[i]=="listen") { p=w[i+1]; break }
          sub(/;.*$/, "", p)
          if (p !~ /^unix:/) {
            sub(/.*\]:/, "", p)                              # [::]:443 -> 443
            if (p ~ /^[0-9.]+:[0-9]+$/) sub(/^.*:/, "", p)    # 0.0.0.0:8443 -> 8443
            if (p ~ /^[0-9]+$/) { np++; ports[np]=p }
          }
        }
        if (wort=="server_name") {
          gefunden=0
          for (i=1;i<=n;i++) {
            if (w[i]=="") continue
            if (gefunden) {
              t=w[i]; fertig=(t ~ /;/); sub(/;.*$/, "", t)
              if (t!="") { nn++; namen[nn]=tolower(t) }
              if (fertig) break
            }
            if (w[i]=="server_name") gefunden=1
          }
        }
        tiefe += auf; tiefe -= zu
        if (tiefe<=0) {
          for (a=1;a<=np;a++) for (b=1;b<=nn;b++) print ports[a] "\t" namen[b]
          inserver=0
        }
      }
    }') || paare=""
  if [ -z "$paare" ]; then
    verworfen "$name" "nginx -T liefert keine server-Blöcke mit Namen — nicht zuzuordnen"
    continue
  fi
  lauscht=$(printf '%s\n' "$paare" | cut -f1 | sort -un | tr '\n' ' ')
  namen=$(printf '%s\n' "$paare" | awk -F'\t' -v p="$ZIEL_PORT" '$1==p{print $2}')
  if [ -z "$namen" ]; then
    verworfen "$name" "bedient auf Container-Port $ZIEL_PORT nichts (lauscht auf: ${lauscht:-nichts})"
    continue
  fi

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
    verworfen "$name" "bedient '$HOST' nicht auf Container-Port $ZIEL_PORT (dort: $(printf '%s' "$namen" | tr '\n' ' '))"
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
