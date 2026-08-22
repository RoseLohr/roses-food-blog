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
  # Schemata sind nach RFC 3986 GROSS/KLEIN-UNABHÄNGIG: `HTTPS://…` ist gültig.
  # Die erste Fassung verlangte Kleinschreibung und hätte einen solchen Wert in
  # der .env mit Code 2 abgewiesen — das Deployment wäre daran gescheitert.
  # (Befund des Pflicht-Approvers, PR #103.)
  case "$url" in
    [A-Za-z]*://?*) ;;
    *) return 1 ;;
  esac
  URL_SCHEMA=$(printf '%s' "${url%%://*}" | tr 'A-Z' 'a-z')
  case "$URL_SCHEMA" in
    *[!a-z0-9.+-]*) return 1 ;;
  esac
  # Auch der Name wird kleingeschrieben — DNS ist gross/klein-unabhaengig, und
  # nachgelagerte Vergleiche sollen sich darauf verlassen koennen.
  local hostport; hostport=$(printf '%s' "${url#*://}" | tr 'A-Z' 'a-z'); hostport="${hostport%%/*}"
  case "$URL_SCHEMA" in https) URL_PORT=443 ;; *) URL_PORT=80 ;; esac
  case "$hostport" in
    \[*\]:*) URL_HOST="${hostport%%]*}"; URL_HOST="${URL_HOST#[}"; URL_PORT="${hostport##*:}" ;;
    \[*\])   URL_HOST="${hostport#[}"; URL_HOST="${URL_HOST%]}" ;;
    *:*)     URL_HOST="${hostport%%:*}"; URL_PORT="${hostport##*:}" ;;
    *)       URL_HOST="$hostport" ;;
  esac
  [ -n "$URL_HOST" ] || return 1
  # Der Name muss wie ein Name aussehen. Das ist die Wurzel, an der eine ganze
  # Fehlerklasse verschwindet: Anführungszeichen, Semikolons und Leerzeichen
  # kommen so gar nicht erst bei einem Aufrufer an, der sie womöglich in eine
  # Kommandozeichenkette schreibt. Der Doppelpunkt bleibt zulässig — IPv6.
  case "$URL_HOST" in
    *[!A-Za-z0-9._:-]*) return 1 ;;
  esac
  return 0
}
