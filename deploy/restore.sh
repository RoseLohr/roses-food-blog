#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Wiederherstellung aus einem Backup — EIN Befehl statt sechs von Hand.
#
#   ./deploy/restore.sh backups/app-20260826-033000.db.gz
#   ./deploy/restore.sh backups/app-….db.gz backups/uploads-….tar.gz
#
# ── WARUM ES DIESE DATEI GIBT (Gegenprüfung 08/2026) ───────────────────────
#
# Die README beschrieb die Wiederherstellung als Folge einzelner Zeilen zum
# Abtippen: `podman compose down`, `gunzip`, `rm` des WAL, `mv`, `tar`,
# `podman compose up`. In einer interaktiven Shell gilt weder `set -e` noch
# eine Verkettung — jede Zeile lief, egal wie die vorige ausgegangen war.
#
# Was das im Ernstfall bedeutet: Scheitert das `gunzip` (falscher Zeitstempel
# im Dateinamen, volle Platte), entfernt die NÄCHSTE Zeile trotzdem das WAL
# des vorhandenen Standes. Das `mv` findet nichts zum Umbenennen, `app.db`
# bleibt liegen — aber ohne sein WAL, also um die zuletzt festgeschriebenen
# Transaktionen ärmer. Und `podman compose up -d` startet den Dienst darauf.
# Ein Wiederherstellungsversuch, der die Daten VERSCHLECHTERT, und niemand
# hält an.
#
# Dazu war die abgetippte Folge eine ABSCHRIFT von `db_einspielen` — der
# Funktion, die genau dafür existiert, weil der Ablauf einmal und nur einmal
# dastehen soll (siehe deploy/db-restore.sh). Eine Abschrift in der README
# ist dieselbe Fehlerklasse wie eine im Code: Sie läuft mit, wird nie geprüft
# und läuft irgendwann auseinander.
#
# Deshalb: derselbe Ablauf wie im Rollback, fail-closed, und vor jedem
# destruktiven Schritt eine Prüfung.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

log(){ echo "[restore] $*"; }
fail(){ echo "[restore] FEHLER: $*" >&2; exit 1; }

# Der atomare DB-Restore steht in deploy/db-restore.sh — dieselbe Funktion,
# die deploy/rollback.sh im Ernstfall und der Drill in der Übung fährt.
# Nach `fail`, damit die dortige Notfassung nicht greift.
# shellcheck source=deploy/db-restore.sh
source "$(dirname "$0")/db-restore.sh"

# Rangfolge wie in rollback.sh und backup.sh: Aufrufer > .env > Standard.
AUFRUFER_DATA_DIR="${DATA_DIR:-}"
AUFRUFER_PORT="${PORT:-}"
AUFRUFER_HEALTH_URL="${HEALTH_URL:-}"
AUFRUFER_COMPOSE="${COMPOSE:-}"
if [[ -f .env ]]; then
  set -a; source <(grep -E '^[A-Z_]+=' .env); set +a
fi
DATA_DIR="${AUFRUFER_DATA_DIR:-${DATA_DIR:-/srv/roses-blog/data}}"
PORT="${AUFRUFER_PORT:-${PORT:-3000}}"
HEALTH_URL="${AUFRUFER_HEALTH_URL:-http://127.0.0.1:$PORT/health}"
PODMAN="${PODMAN:-podman}"
if [[ -n "$AUFRUFER_COMPOSE" ]]; then
  COMPOSE="$AUFRUFER_COMPOSE"
else
  COMPOSE="podman compose"
  podman compose version >/dev/null 2>&1 || {
    command -v podman-compose >/dev/null && COMPOSE="podman-compose" \
      || fail "Weder 'podman compose' noch 'podman-compose' im PATH."
  }
fi

DB_BACKUP="${1:-}"
UPLOADS_ARCHIV="${2:-}"
[[ -n "$DB_BACKUP" ]] || fail "Aufruf: $0 <db-backup[.gz]> [uploads-archiv.tar.gz]"
[[ $# -le 2 ]] || fail "Zu viele Argumente. Aufruf: $0 <db-backup[.gz]> [uploads-archiv.tar.gz]"
[[ -f "$DB_BACKUP" ]] || fail "Backup $DB_BACKUP existiert nicht."
[[ -z "$UPLOADS_ARCHIV" || -f "$UPLOADS_ARCHIV" ]] \
  || fail "Uploads-Archiv $UPLOADS_ARCHIV existiert nicht."
[[ -d "$DATA_DIR" ]] || fail "Daten-Verzeichnis $DATA_DIR existiert nicht."

# ── 1. Alles Prüfbare VOR dem ersten destruktiven Schritt ──────────────────
#
# Der Dienst läuft hier noch. Scheitert etwas in diesem Abschnitt, ist der
# Stand unverändert und die Anlage oben — ein Fehlschlag, der nichts kostet.
# (Befund aus PR #110, eine Datei weiter: Der Rollback stoppte den Container,
# bevor er nachsah, ob er überhaupt ein Backup vorfindet.)
EINGEHEND="$DATA_DIR/app.db.eingehend"
rm -f "$EINGEHEND"
if [[ "$DB_BACKUP" == *.gz ]]; then
  log "Entpacke $DB_BACKUP"
  gunzip -c "$DB_BACKUP" > "$EINGEHEND" \
    || { rm -f "$EINGEHEND"; fail "Entpacken von $DB_BACKUP fehlgeschlagen — \
$DATA_DIR/app.db ist UNVERÄNDERT, der Dienst läuft weiter."; }
else
  cp "$DB_BACKUP" "$EINGEHEND" \
    || { rm -f "$EINGEHEND"; fail "Kopieren von $DB_BACKUP fehlgeschlagen — \
$DATA_DIR/app.db ist UNVERÄNDERT, der Dienst läuft weiter."; }
fi
[[ -s "$EINGEHEND" ]] \
  || { rm -f "$EINGEHEND"; fail "$DB_BACKUP ergibt eine LEERE Datenbank — \
nichts eingespielt, der Dienst läuft weiter."; }

# Sie wird GELESEN, nicht nur entpackt. Dieselbe Prüfung, die backup.sh beim
# Erzeugen und rollback.sh vor dem Einspielen fährt.
log "Prüfe die eingehende Datenbank (integrity_check)"
"$PODMAN" run --rm --entrypoint node -v "$DATA_DIR:/data" localhost/roses-blog:latest \
  -e "const db=require('better-sqlite3')('/data/app.db.eingehend',{readonly:true});const r=db.pragma('integrity_check',{simple:true});db.close();if(r!=='ok'){console.error(r);process.exit(1)}" \
  || { rm -f "$EINGEHEND"; fail "$DB_BACKUP ist nicht lesbar (integrity_check) — \
nichts eingespielt, der Dienst läuft weiter."; }

# ── 2. Den JETZIGEN Stand sichern, solange er noch steht ──────────────────
#
# Über die Online-Backup-API und nicht per `cp`: Die Anwendung fährt SQLite im
# WAL-Modus, und eine `cp`-Kopie einer laufenden Datenbank enthält die zuletzt
# festgeschriebenen Zeilen nicht (nachgemessen in tests/rollback-wal.test.ts:
# app.db 4096 Byte, das WAL 70 KB). Das Netz wäre leer gewesen.
if [[ -f "$DATA_DIR/app.db" ]]; then
  mkdir -p "$DATA_DIR/backups"
  VORHER="pre-restore-$(date +%Y%m%d-%H%M%S).db"
  log "Sichere den jetzigen Stand: backups/$VORHER"
  "$PODMAN" run --rm --entrypoint node -v "$DATA_DIR:/data" localhost/roses-blog:latest \
    -e "const db=require('better-sqlite3')('/data/app.db',{readonly:true});db.backup('/data/backups/'+process.argv[1]).then(()=>{db.close()}).catch(e=>{console.error(e);process.exit(1)})" \
    "$VORHER" \
    || { rm -f "$EINGEHEND"; fail "Sicherung des jetzigen Standes fehlgeschlagen \
— nichts eingespielt. Ohne Netz wird hier nicht weitergemacht."; }
fi

# ── 3. Ab hier wird ersetzt ───────────────────────────────────────────────
log "Stoppe den Dienst"
$COMPOSE down || fail "Der Dienst ließ sich nicht stoppen — nichts eingespielt. \
Eine Datenbank unter einer LAUFENDEN Anwendung zu ersetzen, ist der Weg zu \
genau dem stillen No-op, gegen den deploy/db-restore.sh geschrieben ist."

log "Spiele die Datenbank ein"
# Der Ablauf — Nebendatei, WAL/SHM weg, atomares Umbenennen — steht in
# deploy/db-restore.sh, weil der Ernstfall und der monatliche Drill Zeile für
# Zeile denselben Weg gehen müssen.
db_einspielen "$EINGEHEND" "$DATA_DIR"
rm -f "$EINGEHEND"

if [[ -n "$UPLOADS_ARCHIV" ]]; then
  log "Spiele die Medien ein: $UPLOADS_ARCHIV"
  tar -xzf "$UPLOADS_ARCHIV" -C "$DATA_DIR" \
    || fail "Das Medien-Archiv ließ sich nicht auspacken. Die Datenbank steht \
bereits auf dem gesicherten Stand; der Dienst ist NICHT gestartet."
fi

log "Starte den Dienst"
$COMPOSE up -d || fail "Container-Start fehlgeschlagen."

# ── 4. Health-Gate: erst grün, dann gilt die Wiederherstellung ────────────
# Der Port kommt aus der .env. Ein festes 3000 träfe auf dem Server einen
# fremden Dienst und meldete Erfolg, während hier noch gar nichts steht.
for _ in $(seq 1 30); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    log "Wiederherstellung erfolgreich (Health grün)."
    exit 0
  fi
  sleep 2
done
fail "Health-Gate blieb rot ($HEALTH_URL). Die Daten stehen auf dem \
gesicherten Stand; der Dienst antwortet nicht."
