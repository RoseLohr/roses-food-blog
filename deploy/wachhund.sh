#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Wachhund (Befund 5 der Deploy-Gegenprüfung): beendet eine Neustartschleife —
# laut, nicht still.
#
# `restart: always` startet einen Container, der beim Start stirbt, ohne
# Obergrenze neu. Keine Grenze, kein Alarm, kein Ende. Die Regel bleibt
# trotzdem `always`: `podman-restart.service` startet nach einem
# Rechnerneustart NUR Container mit genau dieser Regel — ein Tausch auf
# `on-failure:N` würde eine Störung gegen den Ausfall vom 2026-08-10
# eintauschen. Die Grenze zieht deshalb dieses Skript.
#
# Arbeitsteilung: Hier wird gemessen und gehandelt (curl, podman inspect,
# podman stop) — urteilen tut scripts/wachhund.mjs IM IMAGE, weil dort die
# geprüfte Logik liegt und der Host außer podman nichts voraussetzen darf.
#
# Aufruf alle 5 Minuten, per systemd-Timer (deploy.sh richtet ihn ein) oder:
#   */5 * * * * /home/deploy/roses-food-blog/deploy/wachhund.sh >> /home/deploy/wachhund.log 2>&1
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")/.."
[[ -f .env ]] && { set -a; source <(grep -E '^[A-Z_]+=' .env); set +a; }
DATA_DIR="${DATA_DIR:-/srv/roses-blog/data}"
PORT="${PORT:-3000}"
STAND="$DATA_DIR/wachhund-stand.json"
BILD=localhost/roses-blog:latest

log(){ echo "[wachhund] $*"; }

# Die SMTP-Zugangsdaten stehen laut README in der `.env`, nicht in der
# `setting`-Tabelle — bootstrap.sh legt sie ausschliesslich dort ab. Oben werden
# sie in DIESE Shell geladen; der Alarm läuft aber in einem CONTAINER, und der
# bekam bisher nur `-e DATA_DIR=/data`. betriebsalarm.mjs fand deshalb keinen
# SMTP-Host, meldete „NICHT verschickt" und beendete sich mit 0 — das einzige
# Netz an dieser Stelle (`|| log "WARNUNG…"`) konnte gar nie greifen.
#
# Bitter daran: Der Env-Weg ist in betriebsalarm.mjs vorgesehen UND getestet
# (tests/betriebsalarm.test.ts, „nimmt die Umgebung, wenn die Datenbank nichts
# hergibt"). Nur konnte ihn kein Aufrufer erreichen — ein grüner Test über einem
# unerreichbaren Pfad.
#
# Übergeben wird nur der NAME (`-e VAR`), nicht `-e VAR=Wert`: podman nimmt den
# Wert dann aus seiner eigenen Umgebung. Sonst stünde SMTP_PASS im Klartext in
# der Argumentliste und wäre für jeden lokalen Nutzer aus der Prozessliste
# bzw. /proc/<pid>/cmdline lesbar, solange der Alarm läuft.
SMTP_DURCHREICHEN=()
for v in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SECURE SMTP_FROM ADMIN_EMAIL; do
  if [[ -n "${!v:-}" ]]; then
    export "${v?}"
    SMTP_DURCHREICHEN+=("-e" "$v")
  fi
done

# Ohne Image lässt sich nicht urteilen — und ohne Urteil wird nicht gehandelt.
podman image exists "$BILD" 2>/dev/null || { log "Kein Image — nichts zu tun."; exit 0; }

# …und „Image vorhanden" heißt nicht „Image kann urteilen". scripts/wachhund.mjs
# kam erst mit dieser Änderung in die Containerfile; jedes ältere Image kennt es
# nicht. Der Lauf lief dann in den `|| { … exit 0; }`-Zweig unten und meldete
# Erfolg — ein Wachhund, der bei jedem Weckruf zufrieden wieder einschläft.
# Das ist kein „nichts zu tun", sondern ein Konfigurationsfehler: Exit 1, damit
# die Unit als fehlgeschlagen dasteht statt als erledigt.
podman run --rm --entrypoint node "$BILD" \
  -e "process.exit(require('fs').existsSync('/app/scripts/wachhund.mjs')?0:1)" \
  >/dev/null 2>&1 \
  || { log "FEHLER: $BILD enthält /app/scripts/wachhund.mjs nicht — kein Urteil möglich."; exit 1; }

# 1. Messen.
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then GESUND=1; else GESUND=0; fi
NEUSTARTS="$(podman inspect -f '{{.RestartCount}}' roses-blog 2>/dev/null || echo 0)"
[[ "$NEUSTARTS" =~ ^[0-9]+$ ]] || NEUSTARTS=0
VORHER="$(cat "$STAND" 2>/dev/null || true)"

# 2. Urteilen (im Image, mit der geprüften Logik).
# Kein `2>/dev/null`: Wenn das Urteil ausbleibt, will man den Grund sehen.
# Und kein `exit 0`: Ein nicht ermittelbares Urteil ist kein erledigter Lauf.
# Eingegriffen wird trotzdem nicht — ohne Urteil weiß niemand, ob eingegriffen
# gehört. Der Unterschied liegt darin, dass die Unit jetzt als fehlgeschlagen
# sichtbar bleibt, statt still „ok" zu melden.
URTEIL="$(podman run --rm --entrypoint node "$BILD" \
  /app/scripts/wachhund.mjs --urteil "$GESUND" "$NEUSTARTS" "${VORHER:-}")" || {
  log "FEHLER: Urteil nicht ermittelbar — kein Eingriff, Lauf gilt als fehlgeschlagen."
  exit 1; }

hole(){ printf '%s' "$URTEIL" | sed -n "s/.*\"$1\":\\(true\\|false\\).*/\\1/p"; }
ALARM="$(hole alarm)"; STOPPEN="$(hole stoppen)"
GRUND="$(printf '%s' "$URTEIL" | sed -n 's/.*"grund":"\([^"]*\)".*/\1/p')"
NEUER="$(printf '%s' "$URTEIL" | sed -n 's/.*"neuerStand":\(null\|{[^}]*}\).*/\1/p')"

log "$GRUND"

# 3. Stand fortschreiben — und zwar so, dass ein Fehlschlag auffällt.
#
# Hier stand `printf … > "$STAND"`: ohne Nebendatei und ohne Prüfung. Die
# Umlenkung KÜRZT die Datei, bevor geschrieben wird; geht das Schreiben schief
# (volle Platte, nicht beschreibbares Datenverzeichnis), bleibt eine leere oder
# halbe Datei zurück. Der nächste Lauf liest sie als „kein Stand", `rotSeit`
# fängt wieder bei 1 an — und die Stoppschwelle wird NIE erreicht. Der Wachhund
# bellt dann nie, gerade wenn er müsste: Eine volle Platte ist einer der
# klassischen Auslöser genau der Neustartschleife, die er erkennen soll
# (Befund gpt-5.6-sol, PR #110, Runde 4).
#
# Jetzt: in eine Nebendatei schreiben, dann atomar umbenennen. Und wenn das
# nicht geht, endet der Lauf mit 1 — die Unit steht dann als fehlgeschlagen da,
# statt Erfolg über einem verlorenen Fortschritt zu melden.
STAND_VERLOREN=0
if [[ "$NEUER" == "null" || -z "$NEUER" ]]; then
  rm -f "$STAND" || { log "WARNUNG: Wachhund-Stand nicht löschbar."; STAND_VERLOREN=1; }
else
  if printf '%s' "$NEUER" > "$STAND.neu" && mv -f "$STAND.neu" "$STAND"; then
    :
  else
    rm -f "$STAND.neu"
    log "FEHLER: Wachhund-Stand nicht schreibbar — der Fortschritt geht verloren,"
    log "        die Stoppschwelle wird so nie erreicht. Platte/Rechte prüfen."
    STAND_VERLOREN=1
  fi
fi

# 4. Handeln.
if [[ "$STOPPEN" == "true" ]]; then
  # Vor dem Stoppen das Protokoll sichern — `podman stop` behält es zwar, aber
  # der nächste Deploy entfernt den Container (Befund 3).
  podman logs roses-blog > "$DATA_DIR/wachhund-$(date +%Y%m%d-%H%M%S).log" 2>&1 || true
  podman stop roses-blog >/dev/null 2>&1 && log "Container gestoppt — die Schleife endet hier." \
    || log "WARNUNG: Stoppen fehlgeschlagen."
fi
if [[ "$ALARM" == "true" ]]; then
  podman run --rm --entrypoint node -v "$DATA_DIR:/data" -e DATA_DIR=/data \
    "${SMTP_DURCHREICHEN[@]}" "$BILD" \
    /app/scripts/betriebsalarm.mjs "⚠ Roses Blog — Container kommt nicht hoch" \
    "$GRUND

Protokoll: podman logs roses-blog
Wieder anfahren: ./deploy.sh (oder ./deploy/rollback.sh)" 2>&1 | sed 's/^/[wachhund] /' \
    || log "WARNUNG: Alarm nicht absetzbar."
fi

# Gehandelt wurde in jedem Fall; erst danach wird der verlorene Stand quittiert.
# Sonst bliebe ein echter Stopp oder Alarm aus, nur weil die Platte voll ist.
[[ "$STAND_VERLOREN" -eq 1 ]] && exit 1
exit 0
