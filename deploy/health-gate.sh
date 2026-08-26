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
# ---------------------------------------------------------------------------

health_gruen(){
  [[ "$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$1" 2>/dev/null)" == "200" ]]
}
