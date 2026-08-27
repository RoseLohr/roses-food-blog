#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Das Health-Gate — die eine Frage „antwortet die Anwendung?", einmal.
#
# Gequellt von deploy/rollback.sh (Ernstfall) und deploy/restore.sh
# (Wiederherstellung). Beide entscheiden daran, ob ihr Lauf als erfolgreich
# gilt; sie dürfen die Frage nicht unterschiedlich beantworten.
#
# ── WAS AN DER VORIGEN FASSUNG FALSCH WAR (Gegenprüfung 08/2026) ───────────
#
# Sie stand als `curl -sf "$HEALTH_URL"` in jedem Skript einzeln und hatte
# zwei Fehler, die beide dieselbe Richtung haben — sie machen ein rotes Gate
# grün oder gar keins:
#
#   * `-f` scheitert NUR bei 4xx/5xx. Eine 301 gilt curl als Erfolg. Ein
#     Reverse-Proxy, der während der Wartung auf eine Statusseite umleitet,
#     hätte den Lauf also für gelungen erklärt, ohne dass die Anwendung je
#     geantwortet hätte. Deshalb wird der Code ABGELESEN und auf 200 geprüft.
#
#   * Ohne `--max-time` wartet curl unbegrenzt. Hängt der Gegenüber, statt zu
#     antworten oder abzulehnen, käme das Gate zu GAR KEINEM Ergebnis — auch
#     nicht zu einem roten. Fünf Sekunden je Versuch, dreißig Versuche.
#
# Bewusst KEIN `-L`: Eine Umleitung ist hier keine Antwort, der man folgt,
# sondern der Befund selbst.
#
# ── UND `-q`, DAMIT DAS AUCH GILT (Panel-Runde 6) ──────────────────────────
#
# „Bewusst kein -L" stand hier als Satz, war aber keine Zusage: curl liest
# ohne `-q` seine Konfiguration aus $CURL_HOME/.curlrc bzw. $HOME/.curlrc und
# nimmt von dort JEDE Option an. Gemessen — eine kaputte Zeile in der Datei
# quittiert curl mit „warning:", die Datei wird also wirklich gelesen.
#
# Ein `-L` oder `--connect-to` darin dreht das Gate um: Es folgte dann einer
# Umleitung oder fragte einen ganz anderen Rechner, und beides gälte als
# Antwort DIESER Anwendung. Dafür braucht es keinen Angreifer — die
# Bequemlichkeitszeile eines Betreibers genügt.
#
# Bitter daran: `scripts/regime/rollback-check.mjs` prüft den Quelltext auf
# die Abwesenheit von `-L`. Diese Kontrolle war grün, während die Umgebung das
# `-L` jederzeit wieder hineinreichen konnte — dieselbe Klasse wie B16.
#
# `-q` MUSS die erste Option sein; danach genannte Optionen gelten weiter.
# ---------------------------------------------------------------------------

health_gruen(){
  local antwort koerper code
  # `--noproxy '*'`: Ein in der Umgebung gesetztes http_proxy/https_proxy
  # schickte die Frage sonst an einen Vermittler — und dessen Antwort sagt
  # nichts über die Anwendung, die hier gerade hochkommen soll.
  antwort="$(curl -q -s --noproxy '*' --max-time 5 -w '\n%{http_code}' "$1" 2>/dev/null)" || return 1
  code="${antwort##*$'\n'}"
  koerper="${antwort%$'\n'*}"
  [[ "$code" == "200" ]] || return 1
  # UND es muss UNSERE Antwort sein. Ein 200 allein beweist nur, dass
  # irgendwer geantwortet hat; auf dem Server hören auf benachbarten Ports
  # andere Dienste. Genau davor warnt die README beim Restore-Port seit
  # Monaten — die Prüfung selbst tat es nicht.
  [[ "$koerper" == *'"status":"ok"'* ]]
}
