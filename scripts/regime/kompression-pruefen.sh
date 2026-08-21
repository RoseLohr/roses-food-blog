#!/usr/bin/env bash
# ============================================================================
# Misst, was der Server WIRKLICH ausliefert — nicht, was die Konfiguration
# behauptet.
#
#   kompression-pruefen.sh --basis <URL> [--aufloesen <IP>] [--ebene <Ebene>]
#
#   --basis      z. B. https://example.de  (Pflicht)
#   --aufloesen  IP, auf die der Name gezwungen wird. Damit misst man den
#                URSPRUNG an einem davorliegenden CDN vorbei.
#   --ebene      `rand` (Voreinstellung) oder `ursprung`. Steuert nur, welche
#                Prüfungen gelten — siehe unten.
#
# WARUM ES DIESES SKRIPT GIBT (Erhebung 2026-08-21)
# ---------------------------------------------------------------------------
# Der Ursprung komprimierte ausschließlich HTML; CSS und JavaScript liefen
# unkomprimiert durch. Aufgefallen ist das NIEMANDEM, obwohl perf-uptime.yml
# die Kompression täglich prüft — denn diese Prüfung lief gegen die öffentliche
# Domain und damit gegen Cloudflare. Das CDN komprimierte nach, die Ampel blieb
# grün. Eine Messung, die bei kaputter eigener Konfiguration nichts merkt,
# prüft nichts.
#
# Deshalb ist dasselbe Skript auf BEIDEN Ebenen einsetzbar, und deshalb prüft
# es Größen statt Kopfzeilen.
#
# WAS AUF WELCHER EBENE GILT — und warum das kein Weichspülen ist
# ---------------------------------------------------------------------------
# `Vary: Accept-Encoding` wird nur am URSPRUNG verlangt. Cloudflare lässt den
# Kopf an zwischengespeicherten statischen Dateien bewusst weg und schlüsselt
# seinen Cache selbst (gemessen: am Rand trägt das CSS kein `vary`, am Ursprung
# muss es eines tragen). Am Rand darauf zu bestehen hieße, fremdes und
# korrektes Verhalten als Fehler zu melden. Alle übrigen Prüfungen gelten auf
# beiden Ebenen unverändert.
#
# GEGENPROBEN, ohne die die Prüfung wertlos wäre
# ---------------------------------------------------------------------------
#  1. Ein `Content-Encoding`-Kopf beweist nichts. Geprüft wird zusätzlich, dass
#     die übertragene Größe wirklich unter der unkomprimierten liegt.
#  2. Käme die Antwort auch OHNE `Accept-Encoding` komprimiert, wäre Prüfung 1
#     wertlos — dann misst man einen Server, der immer komprimiert. Also wird
#     auch das geprüft.
#  3. woff2 und WebP sind bereits komprimiert. Ein Server, der sie nochmals
#     durch gzip schickt, verbrennt Rechenzeit ohne Gegenwert. Diese Prüfung
#     ist zugleich der Beleg, dass `gzip_types` wirklich greift und nicht
#     einfach alles komprimiert wird.
# ============================================================================
set -euo pipefail

BASIS=""; AUFLOESEN=""; EBENE="rand"
while [ $# -gt 0 ]; do
  case "$1" in
    --basis)     BASIS="${2:-}"; shift 2 ;;
    --aufloesen) AUFLOESEN="${2:-}"; shift 2 ;;
    --ebene)     EBENE="${2:-}"; shift 2 ;;
    -h|--hilfe|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$BASIS" ] || { echo "FEHLER: --basis fehlt." >&2; exit 2; }
case "$EBENE" in rand|ursprung) ;; *) echo "FEHLER: --ebene muss rand oder ursprung sein." >&2; exit 2 ;; esac
BASIS="${BASIS%/}"

# Name UND Port aus der Basis lesen. Die erste Fassung setzte `--resolve` fest
# auf 80 und 443 — bei einer Basis mit abweichendem Port (`https://host:8443`)
# griff die Angabe dann NICHT, curl löste über DNS auf, und die Prüfung „am
# Ursprung" maß in Wahrheit das CDN. Nachgemessen: eine --resolve-Angabe für
# 443 ist für Port 8791 wirkungslos, die Verbindung geht dorthin, wohin der
# Name zeigt. (Befund des Pflicht-Approvers, PR #102.)
SCHEMA="${BASIS%%://*}"
HOSTPORT="${BASIS#*://}"; HOSTPORT="${HOSTPORT%%/*}"
case "$SCHEMA" in https) PORT_VORGABE=443 ;; *) PORT_VORGABE=80 ;; esac
case "$HOSTPORT" in
  \[*\]:*) HOST="${HOSTPORT%%]*}"; HOST="${HOST#[}"; PORT="${HOSTPORT##*:}" ;;
  \[*\])   HOST="${HOSTPORT#[}"; HOST="${HOST%]}"; PORT="$PORT_VORGABE" ;;
  *:*)     HOST="${HOSTPORT%%:*}"; PORT="${HOSTPORT##*:}" ;;
  *)       HOST="$HOSTPORT"; PORT="$PORT_VORGABE" ;;
esac
CURL=(curl -sS --max-time 25 --connect-timeout 8)
if [ -n "$AUFLOESEN" ]; then
  CURL+=(--resolve "$HOST:$PORT:$AUFLOESEN")
fi
# Ein gesetztes HTTP(S)_PROXY würde die Messung auf den Proxy lenken statt auf
# den Server — man misst dann fremde Kompression. Für jedes lokale Ziel und für
# jede erzwungene Auflösung ist der direkte Weg der einzig richtige.
case "${AUFLOESEN}${HOST}" in
  *127.0.0.1*|*localhost*|*::1*) CURL+=(--noproxy '*') ;;
  *) [ -n "$AUFLOESEN" ] && CURL+=(--noproxy '*') ;;
esac

# Und weil eine still wirkungslose Auflösung genau der Fehler wäre, den diese
# Datei verhindern soll: nachsehen, ob sie wirklich gegriffen hat. Ein
# `--resolve` greift zum Beispiel auch dann nicht, wenn die Basis bereits eine
# IP-Adresse statt eines Namens trägt. Ohne diese Nachfrage könnte das
# Ursprungs-Gate grün melden, während es das CDN vermessen hat.
if [ -n "$AUFLOESEN" ]; then
  ZIEL_IP=$("${CURL[@]}" -o /dev/null -w '%{remote_ip}' "$BASIS/" 2>/dev/null) || ZIEL_IP=""
  if [ "$ZIEL_IP" != "$AUFLOESEN" ]; then
    echo "FEHLER: --aufloesen $AUFLOESEN blieb wirkungslos — verbunden wurde mit '${ZIEL_IP:-unbekannt}'" >&2
    echo "        (Name $HOST, Port $PORT). Diese Prüfung würde nicht den Ursprung messen," >&2
    echo "        sondern das, wohin der Name zeigt. Deshalb hier Abbruch statt Messung." >&2
    exit 1
  fi
fi

MAENGEL=()
LETZTE_CACHE=""
maengel() { MAENGEL+=("$1"); }

# abrufen URL ENCODING → setzt CODE, BYTES, ENCODING, VARY, CACHE
abrufen() {
  local url="$1" enc="$2" roh
  if ! roh=$("${CURL[@]}" -o /dev/null -D - -H "Accept-Encoding: $enc" \
             -w 'ZKOMPRESSIONSCODE=%{response_code} ZKOMPRESSIONSBYTES=%{size_download}' \
             "$url" 2>&1); then
    CODE=""; BYTES=""; ENCODING=""; VARY=""; CACHE=""
    FEHLERTEXT=$(printf '%s' "$roh" | head -2 | tr '\n' ' ')
    return 1
  fi
  # Auch hier keine ungeschützte Pipe in der Zuweisung: Fände grep die Marke
  # nicht, endete das Skript wortlos statt einen Mangel zu melden.
  CODE=$(printf '%s' "$roh"  | grep -o 'ZKOMPRESSIONSCODE=[0-9]*'  | tail -1 | cut -d= -f2) || CODE=""
  BYTES=$(printf '%s' "$roh" | grep -o 'ZKOMPRESSIONSBYTES=[0-9]*' | tail -1 | cut -d= -f2) || BYTES=""
  local kopfteil; kopfteil=$(printf '%s\n' "$roh" | tr -d '\r')
  # Nachgestelltes Komma abstreifen: Ein Kopf „content-encoding: gzip, br"
  # ergäbe sonst „gzip," und fiele durch die Verfahrensliste unten — ein
  # gemeldeter Mangel, wo keiner ist.
  ENCODING=$(printf '%s\n' "$kopfteil" | awk 'tolower($1)=="content-encoding:"{print tolower($2)}' | tail -1 | tr -d ' ,') || ENCODING=""
  VARY=$(printf '%s\n'     "$kopfteil" | awk 'tolower($1)=="vary:"{$1="";print tolower($0)}' | tr -d ' \t' | paste -sd, -)
  CACHE=$(printf '%s\n'    "$kopfteil" | awk 'tolower($1)=="cache-control:"{$1="";print tolower($0)}' | tail -1)
  return 0
}

# textressource NAME URL — muss komprimiert werden
# textressource NAME URL [MUSS_ENTHALTEN]
textressource() {
  local name="$1" url="$2" muss_enthalten="${3:-}"
  local roh_bytes komp_bytes komp_enc komp_vary komp_cache anteil
  # Zurücksetzen, BEVOR irgendein Zweig früh aussteigt: sonst prüfte der
  # immutable-Test unten den Cache-Control-Wert der VORIGEN Ressource.
  LETZTE_CACHE=""
  if ! abrufen "$url" "identity"; then
    maengel "$name: nicht abrufbar (${FEHLERTEXT:-unbekannt})"; return 0
  fi
  if [ "$CODE" != "200" ]; then maengel "$name: HTTP $CODE statt 200"; return 0; fi
  roh_bytes="$BYTES"
  # Gegenprobe 2: ohne Accept-Encoding darf NICHTS komprimiert ankommen.
  if [ -n "$ENCODING" ]; then
    maengel "$name: kommt auch OHNE Accept-Encoding als '$ENCODING' — damit belegt die Kompressionsprüfung nichts."
  fi

  if ! abrufen "$url" "br, gzip"; then
    maengel "$name: nicht abrufbar (${FEHLERTEXT:-unbekannt})"; return 0
  fi
  komp_bytes="$BYTES"; komp_enc="$ENCODING"; komp_vary="$VARY"; komp_cache="$CACHE"
  # Auch der ZWEITE Abruf muss 200 sein. Ohne diese Zeile käme eine
  # gzip-kodierte Fehlerseite durch: klein, richtig etikettiert, und die
  # Größenrelation sähe nach hervorragender Kompression aus.
  if [ "$CODE" != "200" ]; then
    maengel "$name: liefert unter Accept-Encoding HTTP $CODE statt 200 — unkomprimiert war es 200."
    return 0
  fi

  if [ -z "$komp_enc" ]; then
    maengel "$name: wird UNKOMPRIMIERT ausgeliefert ($roh_bytes Bytes)."
  elif ! printf '%s' "$komp_enc" | grep -qE '^(gzip|br|zstd|deflate|x-gzip)$'; then
    # `identity` ist KEINE Kompression, sondern die ausdrückliche Aussage, dass
    # nicht komprimiert wurde. Ohne diese Zeile zählte jeder beliebige Wert im
    # Kopf als Erfolg, solange nur die Größe stimmte.
    maengel "$name: meldet Content-Encoding '$komp_enc' — das ist kein Kompressionsverfahren."
  else
    # Gegenprobe 1: der Kopf allein beweist nichts, die Größe muss es belegen.
    anteil=$(awk -v k="$komp_bytes" -v r="$roh_bytes" 'BEGIN{ if (r+0==0) print 999; else printf "%d", (k*100)/r }')
    if [ "$anteil" -gt 60 ]; then
      maengel "$name: meldet '$komp_enc', überträgt aber $komp_bytes von $roh_bytes Bytes (${anteil} %) — das ist keine Kompression."
    fi
    # Gegenprobe 1b — die eigentliche Frage: Kann der Browser das WIEDER
    # HERSTELLEN? Ein abgeschnittener oder falsch etikettierter Rumpf ist klein
    # und trägt den richtigen Kopf; beides oben käme durch, die Seite bliebe
    # trotzdem kaputt. curl --compressed entpackt wie ein Browser: Es muss
    # gelingen UND exakt die unkomprimierte Größe ergeben.
    # ALLE Folgeproben nageln `Accept-Encoding` auf die Kodierung fest, die
    # oben tatsächlich gemessen wurde. Vorher fragte der Messabruf „br, gzip",
    # die Entpackprobe `--compressed` (curls eigene Liste) und die
    # Strukturprüfung „gzip" — drei verschiedene Verhandlungen. Ein Server, der
    # ein DEFEKTES br und ein intaktes gzip vorhält, wurde damit auf br
    # gemessen und auf gzip für gültig erklärt. Nachgemessen: ein explizites
    # `Accept-Encoding` gewinnt gegenüber `--compressed`, curl entpackt
    # trotzdem.
    #
    # ACHTUNG, hier lag der erste Entwurf falsch: `%{size_download}` zählt die
    # Bytes AUF DER LEITUNG, auch mit --compressed. Damit maß die Prüfung
    # nochmals die komprimierte Größe und schlug bei jedem korrekten Server an.
    # Die entpackte Größe gibt es nur, indem man den Rumpf wirklich schreibt.
    local entpackt entpackt_datei
    entpackt_datei="$(mktemp)"
    if "${CURL[@]}" -H "Accept-Encoding: $komp_enc" --compressed -o "$entpackt_datei" "$url" >/dev/null 2>&1; then
      entpackt=$(wc -c < "$entpackt_datei" | tr -d ' ')
    else
      entpackt="fehler"
    fi
    # STRUKTURPRÜFUNG des Stroms selbst. Nötig, weil `curl --compressed` an
    # einem ABGESCHNITTENEN gzip-Strom NICHT scheitert: Es liefert, was es
    # entpacken konnte, und meldet Erfolg (nachgemessen). Ohne diese Prüfung
    # fiele eine unvollständige Auslieferung nur bei unveränderlichen Dateien
    # auf, wo unten Byte für Byte verglichen wird — auf der dynamischen
    # Startseite gar nicht.
    #
    # `gzip -t` erkennt genau das („unexpected end of file", exit 1). Für br
    # gibt es diese Prüfung hier nicht: Auf den beteiligten Hosts ist kein
    # brotli-Entpacker installiert (Erhebung 2026-08-21), und eine Prüfung
    # vorzutäuschen, die nicht läuft, wäre schlimmer als ihr Fehlen.
    if [ "$komp_enc" = gzip ] || [ "$komp_enc" = x-gzip ]; then
      local roh_gz
      roh_gz="$(mktemp)"
      if "${CURL[@]}" -H "Accept-Encoding: $komp_enc" -o "$roh_gz" "$url" >/dev/null 2>&1; then
        if ! gzip -t "$roh_gz" 2>/dev/null; then
          maengel "$name: der gzip-Strom ist unvollständig oder beschädigt (gzip -t schlägt fehl) — ein Browser bricht das Dekodieren ab."
        fi
      fi
      rm -f "$roh_gz"
    fi

    if [ "$entpackt" = fehler ]; then
      maengel "$name: meldet '$komp_enc', lässt sich aber nicht entpacken — ein Browser bekäme hier nichts Brauchbares."
    elif [ "$entpackt" = 0 ]; then
      maengel "$name: meldet '$komp_enc', entpackt aber zu 0 Bytes."
    else
      # Der harte Vergleich nur dort, wo der Server selbst zusichert, dass sich
      # der Inhalt nicht ändert (`immutable` auf einer Adresse mit Inhaltshash).
      # Auf der Startseite wäre er flatterig: Sie ist dynamisch, und ein
      # zwischen zwei Abrufen veröffentlichtes Rezept ließe ihn falsch
      # anschlagen. Bei unveränderlichen Dateien gibt es dieses Fenster nicht.
      #
      # UND DORT DANN BYTE FÜR BYTE, nicht nur die Länge. Die Länge allein
      # lässt gültig komprimierten, gleich langen FREMDINHALT durch — der
      # Browser bekäme dann eine intakte, aber falsche Datei, und gerade bei
      # `immutable` behielte er sie ein Jahr. Beide Rümpfe liegen ohnehin vor;
      # sie zu vergleichen kostet nichts gegenüber ihrem Abruf.
      # Bei einer DYNAMISCHEN Antwort ist Bytegleichheit nicht zu haben — zwei
      # Abrufe dürfen sich legitim unterscheiden. Prüfbar ist trotzdem, ob das
      # Entpackte die Seite überhaupt noch IST: Ein kurzer, gültig gepackter
      # Fremdrumpf käme sonst mit 200 und Vary durch, und die Seite im Browser
      # wäre leer.
      if [ -n "$muss_enthalten" ] && ! grep -qa -- "$muss_enthalten" "$entpackt_datei"; then
        maengel "$name: das Entpackte enthält '$muss_enthalten' nicht — der komprimierte Rumpf ist nicht die Seite, die unkomprimiert ausgeliefert wird."
      fi
      case "$komp_cache" in
        *immutable*)
          local roh_datei
          roh_datei="$(mktemp)"
          if "${CURL[@]}" -H 'Accept-Encoding: identity' -o "$roh_datei" "$url" >/dev/null 2>&1; then
            if ! cmp -s "$roh_datei" "$entpackt_datei"; then
              maengel "$name: entpackt ergibt ANDERE Bytes als die unkomprimierte Auslieferung ($entpackt gegenüber $roh_bytes Bytes). Bei einer unveränderlichen Adresse müssen beide identisch sein."
            fi
          else
            maengel "$name: unkomprimierte Fassung für den Bytevergleich nicht abrufbar."
          fi
          rm -f "$roh_datei" ;;
      esac
    fi
    rm -f "$entpackt_datei"
    if [ "$EBENE" = ursprung ]; then
      case "$komp_vary" in
        *accept-encoding*) ;;
        *) maengel "$name: komprimiert, aber ohne 'Vary: Accept-Encoding' (gzip_vary off) — ein Zwischenspeicher dürfte die gzip-Antwort an einen Client ohne gzip ausliefern." ;;
      esac
    fi
  fi
  printf '  %-8s %-52s %8s → %-8s %-5s %s\n' "$EBENE" "$(kuerzen "$url")" \
    "$roh_bytes" "${komp_bytes:-–}" "${komp_enc:-roh}" "${komp_cache:0:38}"
  LETZTE_CACHE="$komp_cache"
}

# fertigkomprimiert NAME URL — darf NICHT nochmals komprimiert werden
fertigkomprimiert() {
  local name="$1" url="$2"
  if ! abrufen "$url" "br, gzip"; then
    maengel "$name: nicht abrufbar (${FEHLERTEXT:-unbekannt})"; return 0
  fi
  if [ "$CODE" != "200" ]; then maengel "$name: HTTP $CODE statt 200"; return 0; fi
  if [ -n "$ENCODING" ]; then
    maengel "$name: wird als '$ENCODING' nochmals komprimiert — das Format ist bereits komprimiert, das ist verbrannte Rechenzeit."
  fi
  printf '  %-8s %-52s %8s → %-8s %-5s %s\n' "$EBENE" "$(kuerzen "$url")" \
    "$BYTES" "$BYTES" "${ENCODING:-roh}" "${CACHE:0:38}"
}

kuerzen() { local s="${1#*://}"; s="${s#*/}"; printf '/%s' "${s:0:51}"; }

# ---------------------------------------------------------------------------
printf 'Kompression auf Ebene "%s": %s%s\n\n' "$EBENE" "$BASIS" \
  "$( [ -n "$AUFLOESEN" ] && printf ' (aufgelöst auf %s)' "$AUFLOESEN" )"

# Die Startseite wird allein gebraucht, um die Adressen von CSS, JS und Schrift
# zu lesen. Die Aussagen über Kodierung fallen weiter unten, je Ressource.
#
# ZWEI VERSUCHE, und beide sind nötig — beim Gegenprüfen gefunden, nicht beim
# Schreiben (tests/kompression-pruefung.test.ts):
#   1. `identity`: der Normalfall. Ein Server, der die Wahrheit sagt, liefert
#      hier unkomprimiert.
#   2. `--compressed`: ein Server, der AUCH OHNE Anfrage komprimiert, liefert
#      bei (1) Binärbytes; ohne diesen zweiten Versuch meldete das Skript „das
#      ist nicht die Startseite" — die falsche Ursache.
# Umgekehrt scheitert (2) allein an einem Server, der Kompression nur behauptet:
# curl versucht zu entpacken, was gar nicht gepackt ist, und bricht ab. Nur
# beide Versuche zusammen benennen jeden der drei Fälle richtig.
#
# In eine DATEI statt in eine Variable: gzip-Bytes enthalten Null-Bytes, und
# die verschluckt jede Kommandosubstitution mit einer Warnung.
SEITE_TMP="$(mktemp)"
trap 'rm -f "$SEITE_TMP"' EXIT
"${CURL[@]}" -H 'Accept-Encoding: identity' -o "$SEITE_TMP" "$BASIS/" 2>/dev/null || true
if ! grep -qa 'featured-slider' "$SEITE_TMP" 2>/dev/null; then
  "${CURL[@]}" --compressed -o "$SEITE_TMP" "$BASIS/" 2>/dev/null || true
fi

if [ ! -s "$SEITE_TMP" ]; then
  echo "FEHLER: Startseite unter $BASIS/ nicht abrufbar — hier wird nichts gemessen." >&2
  exit 1
fi
# Dieselbe Marke, an der auch perf-uptime.yml die Startseite erkennt: eine
# Fehlerseite mit Status 200 trägt weiterhin /_next/static/*.js, und daraus
# ließen sich fröhlich grüne Kennzahlen ziehen.
if ! grep -qa 'featured-slider' "$SEITE_TMP"; then
  echo "FEHLER: Unter $BASIS/ steht nicht die Startseite (keine section.featured-slider)." >&2
  exit 1
fi

# KEIN `grep … | head -1` in einer Zuweisung. Unter `set -e -o pipefail` ist
# das zweifach tödlich, und beides ist nachgemessen:
#   - findet grep nichts, scheitert die Zuweisung und das Skript endet SOFORT.
#     Der Zweig „keine CSS-Datei gefunden" weiter unten war damit unerreichbar.
#   - findet grep viel, schließt `head -1` die Pipe früh; grep stirbt an
#     SIGPIPE (exit 141), pipefail reicht das durch. In 5 von 5 Läufen gegen
#     eine Datei mit vielen Treffern endete das Skript hier — die Startseite
#     dieser Anwendung trägt 84 Unterressourcen.
# Ohne Pipe kann keines von beidem passieren; die erste Zeile holt die
# Parametererweiterung.
erste_zeile() { printf '%s' "${1%%$'\n'*}"; }
TREFFER=$(grep -oaE '/_next/static/[^"]+\.css' "$SEITE_TMP") || TREFFER=""
CSS=$(erste_zeile "$TREFFER")
TREFFER=$(grep -oaE '/_next/static/[^"]+\.js' "$SEITE_TMP") || TREFFER=""
JS=$(erste_zeile "$TREFFER")
TREFFER=$(grep -oaE '/fonts/[^"]+\.woff2[^"]*' "$SEITE_TMP") || TREFFER=""
FONT=$(erste_zeile "$TREFFER")

printf '  %-8s %-52s %8s   %-8s %-5s %s\n' "Ebene" "Ressource" "roh" "kompr." "Kod." "Cache-Control"
printf '  %s\n' "$(printf '%.0s-' $(seq 1 110))"

# Beim HTML wird zusätzlich verlangt, dass das Entpackte die Bühne der
# Startseite noch trägt — dieselbe Marke, an der die Seite oben erkannt wurde.
textressource "HTML" "$BASIS/" "featured-slider"
if [ -n "$CSS" ]; then textressource "CSS" "$BASIS$CSS"
  case "$LETZTE_CACHE" in *immutable*) ;; *) maengel "CSS: kein 'immutable' im Cache-Control ($LETZTE_CACHE)" ;; esac
else maengel "Keine CSS-Datei in der Startseite gefunden — die Prüfung wäre unvollständig."; fi
if [ -n "$JS" ]; then textressource "JS" "$BASIS$JS"
  case "$LETZTE_CACHE" in *immutable*) ;; *) maengel "JS: kein 'immutable' im Cache-Control ($LETZTE_CACHE)" ;; esac
else maengel "Keine JS-Datei in der Startseite gefunden — die Prüfung wäre unvollständig."; fi
if [ -n "$FONT" ]; then fertigkomprimiert "Font" "$BASIS$FONT"
else maengel "Keine woff2-Schrift in der Startseite gefunden — die Gegenprobe fehlt."; fi

echo
if [ "${#MAENGEL[@]}" -eq 0 ]; then
  echo "Kompression auf Ebene \"$EBENE\": in Ordnung."
  exit 0
fi
echo "MÄNGEL auf Ebene \"$EBENE\":"
for m in "${MAENGEL[@]}"; do printf '  - %s\n' "$m"; done
echo
echo "Vorlage und Einspielweg: deploy/npm/http_top.conf"
exit 1
