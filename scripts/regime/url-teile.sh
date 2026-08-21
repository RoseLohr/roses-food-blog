# Zerlegt eine URL — an EINER Stelle, damit die Zerlegung nicht auseinanderläuft.
#
# Zum Einbinden gedacht, nicht zum Ausführen:
#   . "$(dirname "$0")/url-teile.sh"
#   url_teile "https://example.de:8443/x" || exit 2
#   → URL_SCHEMA=https  URL_HOST=example.de  URL_PORT=8443
#
# WARUM ES DIESE DATEI GIBT: Zwei Skripte zerlegten dieselbe URL auf eigene
# Weise, und deploy.sh tat es ein drittes Mal — mit dem Ergebnis, dass ein
# `https:/…` mit nur einem Schrägstrich dort als Host „https" herauskam und der
# erste Produktionslauf abbrach. Eine Zerlegung, drei Fassungen: Das läuft
# auseinander, und die schlechteste gewinnt.
#
# Rückgabe 1 = keine brauchbare URL. Der Aufrufer meldet das mit dem WERT —
# wer nur das abgeleitete Ergebnis liest, sucht an der falschen Stelle.
url_teile() {
  local url="${1:-}"
  case "$url" in
    [a-z]*://?*) ;;
    *) return 1 ;;
  esac
  URL_SCHEMA="${url%%://*}"
  local hostport="${url#*://}"; hostport="${hostport%%/*}"
  case "$URL_SCHEMA" in https) URL_PORT=443 ;; *) URL_PORT=80 ;; esac
  case "$hostport" in
    \[*\]:*) URL_HOST="${hostport%%]*}"; URL_HOST="${URL_HOST#[}"; URL_PORT="${hostport##*:}" ;;
    \[*\])   URL_HOST="${hostport#[}"; URL_HOST="${URL_HOST%]}" ;;
    *:*)     URL_HOST="${hostport%%:*}"; URL_PORT="${hostport##*:}" ;;
    *)       URL_HOST="$hostport" ;;
  esac
  [ -n "$URL_HOST" ] || return 1
  return 0
}
