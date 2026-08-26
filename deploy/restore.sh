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
# Das Health-Gate ebenso: dieselbe Frage wie im Rollback, also dieselbe
# Antwort. Warum sie nicht `curl -sf` lautet, steht dort.
# shellcheck source=deploy/health-gate.sh
source "$(dirname "$0")/health-gate.sh"

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

# Das Medien-Archiv wird HIER geprüft, nicht erst beim Auspacken.
#
# `tar -xzf … -C "$DATA_DIR"` packt aus, was drinsteht. Ein Archiv, das
# `app.db` mitbringt, überschriebe damit die gerade eingespielte Datenbank —
# NACH allen Prüfungen, an denen sie hängt. Und ein unlesbares Archiv fiele
# erst auf, wenn der Dienst schon steht: ein Fehlschlag, der zusätzlich den
# Dienst kostet (dieselbe Klasse wie der Befund aus PR #110).
#
# Verlangt wird: lesbar UND jedes Mitglied unter `uploads/`. Absolute Pfade
# und `..` fallen damit ebenfalls heraus, ohne dass eine Liste verbotener
# Muster gepflegt werden müsste — erlaubt ist genau eine Form.
if [[ -n "$UPLOADS_ARCHIV" ]]; then
  log "Prüfe das Medien-Archiv: $UPLOADS_ARCHIV"
  MITGLIEDER="$(tar -tzf "$UPLOADS_ARCHIV")" \
    || { rm -f "$EINGEHEND"; fail "$UPLOADS_ARCHIV ist nicht lesbar — nichts \
eingespielt, der Dienst läuft weiter."; }
  while IFS= read -r m; do
    [[ -z "$m" ]] && continue
    [[ "$m" == "uploads" || "$m" == "uploads/"* ]] \
      || { rm -f "$EINGEHEND"; fail "$UPLOADS_ARCHIV enthält '$m' — erlaubt ist \
nur uploads/. Nichts eingespielt, der Dienst läuft weiter."; }
  done <<< "$MITGLIEDER"
fi

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
  # Der Exit-Status sagt nur, dass der Aufruf durchlief. Genau diese Lüge —
  # podman meldet 0 und schreibt nichts — fängt deploy/backup.sh seit B16 ab;
  # hier stand die Prüfung nicht, und das Netz wäre leer gewesen, während
  # gleich darauf die Datenbank ersetzt wird.
  [[ -s "$DATA_DIR/backups/$VORHER" ]] \
    || { rm -f "$EINGEHEND" "$DATA_DIR/backups/$VORHER"; fail "Die Sicherung des \
jetzigen Standes meldete Erfolg, aber backups/$VORHER fehlt oder ist leer — \
nichts eingespielt."; }
  "$PODMAN" run --rm --entrypoint node -v "$DATA_DIR:/data" localhost/roses-blog:latest \
    -e "const db=require('better-sqlite3')('/data/backups/'+process.argv[1],{readonly:true});const r=db.pragma('integrity_check',{simple:true});db.close();if(r!=='ok'){console.error(r);process.exit(1)}" \
    "$VORHER" \
    || { rm -f "$EINGEHEND"; fail "Die Sicherung backups/$VORHER ist nicht \
lesbar — nichts eingespielt. Ein Netz, in das niemand hineingesehen hat, ist \
keins."; }
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
  # In eine NEBENABLAGE auspacken und dann tauschen, nicht über den Bestand
  # legen. Zwei Gründe, und beide sind Zustände, die es sonst gäbe:
  #
  #   * Ein Auspacken, das in der Mitte abbricht, hinterließe einen halb
  #     ersetzten Medienbestand. Hier bricht es in der Nebenablage ab, und der
  #     bisherige Stand steht unberührt daneben.
  #   * Dateien, die das Backup NICHT kennt, blieben liegen. Der Stand danach
  #     wäre weder der gesicherte noch der vorige, sondern eine Mischung —
  #     eine Wiederherstellung, die nichts wiederherstellt.
  #
  # Der vorige Stand wird beiseitegelegt, nicht gelöscht: Die Medien sind das
  # Einzige, wofür dieses Skript kein eigenes Netz spannt.
  rm -rf "$DATA_DIR/uploads.neu"
  mkdir -p "$DATA_DIR/uploads.neu"
  tar -xzf "$UPLOADS_ARCHIV" -C "$DATA_DIR/uploads.neu" \
    || { rm -rf "$DATA_DIR/uploads.neu"; fail "Das Medien-Archiv ließ sich nicht \
auspacken. Der bisherige Medienbestand ist UNVERÄNDERT; die Datenbank steht \
bereits auf dem gesicherten Stand, der Dienst ist NICHT gestartet."; }
  if [[ -d "$DATA_DIR/uploads" ]]; then
    rm -rf "$DATA_DIR/uploads.alt"
    mv "$DATA_DIR/uploads" "$DATA_DIR/uploads.alt" \
      || fail "Der bisherige Medienbestand ließ sich nicht beiseitelegen."
    log "Der bisherige Medienbestand liegt in $DATA_DIR/uploads.alt."
  fi
  mv "$DATA_DIR/uploads.neu/uploads" "$DATA_DIR/uploads" \
    || fail "Der eingespielte Medienbestand ließ sich nicht an seinen Platz \
bringen. Er liegt in $DATA_DIR/uploads.neu/uploads, der bisherige in \
$DATA_DIR/uploads.alt."
  rmdir "$DATA_DIR/uploads.neu" 2>/dev/null || true
fi

log "Starte den Dienst"
$COMPOSE up -d || fail "Container-Start fehlgeschlagen."

# ── 4. Health-Gate: erst grün, dann gilt die Wiederherstellung ────────────
# Der Port kommt aus der .env. Ein festes 3000 träfe auf dem Server einen
# fremden Dienst und meldete Erfolg, während hier noch gar nichts steht.
for _ in $(seq 1 30); do
  if health_gruen "$HEALTH_URL"; then
    log "Wiederherstellung erfolgreich (Health grün)."
    exit 0
  fi
  sleep 2
done
fail "Health-Gate blieb rot ($HEALTH_URL). Die Daten stehen auf dem \
gesicherten Stand; der Dienst antwortet nicht."
