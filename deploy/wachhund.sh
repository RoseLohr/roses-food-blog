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

# Ohne Image lässt sich nicht urteilen — und ohne Urteil wird nicht gehandelt.
podman image exists "$BILD" 2>/dev/null || { log "Kein Image — nichts zu tun."; exit 0; }

# 1. Messen.
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then GESUND=1; else GESUND=0; fi
NEUSTARTS="$(podman inspect -f '{{.RestartCount}}' roses-blog 2>/dev/null || echo 0)"
[[ "$NEUSTARTS" =~ ^[0-9]+$ ]] || NEUSTARTS=0
VORHER="$(cat "$STAND" 2>/dev/null || true)"

# 2. Urteilen (im Image, mit der geprüften Logik).
URTEIL="$(podman run --rm --entrypoint node "$BILD" \
  /app/scripts/wachhund.mjs --urteil "$GESUND" "$NEUSTARTS" "${VORHER:-}" 2>/dev/null)" || {
  log "Urteil nicht ermittelbar — kein Eingriff."; exit 0; }

hole(){ printf '%s' "$URTEIL" | sed -n "s/.*\"$1\":\\(true\\|false\\).*/\\1/p"; }
ALARM="$(hole alarm)"; STOPPEN="$(hole stoppen)"
GRUND="$(printf '%s' "$URTEIL" | sed -n 's/.*"grund":"\([^"]*\)".*/\1/p')"
NEUER="$(printf '%s' "$URTEIL" | sed -n 's/.*"neuerStand":\(null\|{[^}]*}\).*/\1/p')"

log "$GRUND"

# 3. Stand fortschreiben.
if [[ "$NEUER" == "null" || -z "$NEUER" ]]; then rm -f "$STAND"; else printf '%s' "$NEUER" > "$STAND"; fi

# 4. Handeln.
if [[ "$STOPPEN" == "true" ]]; then
  # Vor dem Stoppen das Protokoll sichern — `podman stop` behält es zwar, aber
  # der nächste Deploy entfernt den Container (Befund 3).
  podman logs roses-blog > "$DATA_DIR/wachhund-$(date +%Y%m%d-%H%M%S).log" 2>&1 || true
  podman stop roses-blog >/dev/null 2>&1 && log "Container gestoppt — die Schleife endet hier." \
    || log "WARNUNG: Stoppen fehlgeschlagen."
fi
if [[ "$ALARM" == "true" ]]; then
  podman run --rm --entrypoint node -v "$DATA_DIR:/data" -e DATA_DIR=/data "$BILD" \
    /app/scripts/betriebsalarm.mjs "⚠ Roses Blog — Container kommt nicht hoch" \
    "$GRUND

Protokoll: podman logs roses-blog
Wieder anfahren: ./deploy.sh (oder ./deploy/rollback.sh)" 2>&1 | sed 's/^/[wachhund] /' \
    || log "WARNUNG: Alarm nicht absetzbar."
fi
