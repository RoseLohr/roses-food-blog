#!/usr/bin/env bash
# Rollback (A-06/B-11) — rollt das vorige Image (:previous) zurück und stellt
# optional das jüngste Pre-Deploy-DB-Backup wieder her, mit Healthcheck-Gate.
# Der Rollback ist damit GEÜBT und GETIMT (Skript misst die Dauer), nicht ad hoc.
#
#   ./deploy/rollback.sh            # Image zurückrollen (DB unangetastet)
#   ./deploy/rollback.sh --with-db  # zusätzlich jüngstes Pre-Deploy-DB-Backup einspielen
#   ./deploy/rollback.sh --dry-run  # nur prüfen, was getan würde (nichts ändern)
set -euo pipefail

cd "$(dirname "$0")/.."

start=$(date +%s)
log(){ echo "[rollback] $*"; }
fail(){ echo "[rollback] FEHLER: $*" >&2; exit 1; }

# DIESELBE Konfigurationsquelle wie deploy.sh. Vorher riet das Skript
# DATA_DIR=/opt/roses/data und PORT=3000 — auf der echten Anlage liegen die
# Daten woanders und der Port ist 3011. Folge: Das Health-Gate unten pollte
# einen toten Port und konnte NIE grün werden (beobachtet 2026-08-10: der
# Rollback lief durch, sein Gate hing 60 s und musste abgebrochen werden), und
# `--with-db` hätte im falschen Verzeichnis nach Backups gesucht.
# Rangfolge: ausdrücklich vom AUFRUFER gesetzte Werte > .env > Standard.
# Ein blindes `source` würde die Umgebung des Aufrufers überschreiben und damit
# die dokumentierte Override-Möglichkeit still aushebeln — auch das wäre eine
# Verschlechterung (Befund gpt-5.6-sol, PR #57, Runde 5).
AUFRUFER_DATA_DIR="${DATA_DIR:-}"
AUFRUFER_PORT="${PORT:-}"
AUFRUFER_HEALTH_URL="${HEALTH_URL:-}"
AUFRUFER_COMPOSE="${COMPOSE:-}"
if [[ -f .env ]]; then
  set -a; source <(grep -E '^[A-Z_]+=' .env); set +a
fi
DATA_DIR="${AUFRUFER_DATA_DIR:-${DATA_DIR:-/srv/roses-blog/data}}"
PORT="${AUFRUFER_PORT:-${PORT:-3000}}"
# 127.0.0.1 statt localhost: der Container veröffentlicht ausdrücklich auf
# 127.0.0.1; ein localhost, das zuerst auf ::1 auflöst, läuft ins Leere.
HEALTH_URL="${AUFRUFER_HEALTH_URL:-http://127.0.0.1:$PORT/health}"
# Provider: ausdrückliche Vorgabe des Aufrufers gilt unverändert; sonst wie in
# deploy.sh ermitteln — ein hart verdrahtetes podman-compose scheitert auf
# Anlagen, die nur `podman compose` haben.
if [[ -n "$AUFRUFER_COMPOSE" ]]; then
  COMPOSE="$AUFRUFER_COMPOSE"
else
  COMPOSE="podman compose"
  podman compose version >/dev/null 2>&1 || {
    command -v podman-compose >/dev/null && COMPOSE="podman-compose" \
      || fail "Weder 'podman compose' noch 'podman-compose' im PATH."
  }
fi
WITH_DB=0; DRY=0
# Ein `case` OHNE `*)`-Zweig verschluckt jedes unbekannte Argument stillschweigend.
# Das ist hier kein Schönheitsfehler, sondern ein destruktiver Weg: `--dryrun`
# (Tippfehler) ließ DRY auf 0 stehen und fuhr den ECHTEN Rollback; `--with_db`
# rollte das Image zurück, ohne die Datenbank mitzunehmen — beide ohne ein Wort.
# Wer sich unter Zeitdruck vertippt, bekommt jetzt einen Abbruch statt einer
# Überraschung.
for a in "$@"; do
  case "$a" in
    --with-db) WITH_DB=1 ;;
    --dry-run) DRY=1 ;;
    *) fail "Unbekannte Option '$a'. Erlaubt sind: --with-db, --dry-run." ;;
  esac
done

# 1. Vorbedingung: es GIBT ein voriges Image.
podman image exists localhost/roses-blog:previous 2>/dev/null \
  || fail "Kein :previous-Image vorhanden — nichts zum Zurückrollen (erst nach dem zweiten Deploy verfügbar)."

# 1b. …und es ist ein ANDERES als das laufende. Sind beide Tags identisch,
# rollt der Lauf nichts zurück und dürfte sich nicht „erfolgreich" nennen
# (stiller No-op statt ehrlicher Befund).
# Die IDs müssen WIRKLICH ermittelt werden. Frühere Platzhalter-Fallbacks
# ("previous"/"latest") hätten sich bei einem Abfragefehler zwangsläufig
# unterschieden und die Prüfung damit wirkungslos gemacht — unbekannt ist
# unsicher, nicht in Ordnung (gleiche Klasse wie der Befund zu NeedDaemonReload).
VORIG_ID="$(podman image inspect -f '{{.Id}}' localhost/roses-blog:previous 2>/dev/null)" \
  || VORIG_ID=""
AKTUELL_ID="$(podman image inspect -f '{{.Id}}' localhost/roses-blog:latest 2>/dev/null)" \
  || AKTUELL_ID=""
[[ -n "$VORIG_ID" && -n "$AKTUELL_ID" ]] \
  || fail "Image-IDs von :previous/:latest nicht ermittelbar — Abbruch statt Blindflug."
[[ "$VORIG_ID" != "$AKTUELL_ID" ]] \
  || fail ":previous und :latest sind identisch — es gibt nichts zurückzurollen (kein stiller No-op)."

if [[ $DRY -eq 1 ]]; then
  log "DRY-RUN: würde :previous → :latest taggen, Container neu starten$( [[ $WITH_DB -eq 1 ]] && echo ', DB-Backup einspielen' )."
  ls -1t "$DATA_DIR"/backups/pre-deploy-*.db 2>/dev/null | head -1 | sed 's/^/[rollback] jüngstes Backup: /' || true
  exit 0
fi

# ── UNBEKANNT IST UNSICHER — AUCH BEIM SCHEMA-STAND ─────────────────────────
#
# Schema-Vorsprung (Befund 6): Läuft die Datenbank bereits auf einem neueren
# Stand, als die zurückgerollte Anwendung kennt, startet diese gegen ein Schema,
# das sie nicht erwartet. `scripts/migrate.mjs` schreibt die Zahl der
# angewandten Migrationen nach `PRAGMA user_version`; das :previous-Image trägt
# seine Migrationen unter /app/drizzle. Beide Zahlen sind vergleichbar.
#
# Bis 08/2026 fing dieser Block einen Abfragefehler mit `|| DB_STAND=""` ab und
# ÜBERSPRANG daraufhin den Vergleich (`if [[ -n "$DB_STAND" && … ]]`). Der
# Rollback lief also genau dann ungeprüft durch, wenn die Prüfung nicht möglich
# war — und quittierte Erfolg. Das ist dieselbe Fehlerklasse, die oben für die
# Image-IDs schon ausdrücklich verworfen ist; sie stand hier zwei Absätze
# weiter unten trotzdem im Skript (Befund gpt-5.6-sol, PR #110).
#
# Jetzt bricht ein nicht ermittelbarer Stand ab, und die Fehlerausgabe der
# Abfrage bleibt sichtbar, statt nach /dev/null zu gehen. Auch ein Wert, der
# keine Zahl ist, gilt als nicht ermittelt: `[[ "x" -gt 3 ]]` wäre in bash
# still `false` gewesen — wieder eine übersprungene Prüfung, die wie eine
# bestandene aussieht.
#
# ── WARUM DIE HELFER IN GLOBALE VARIABLEN SCHREIBEN, STATT ZU ECHOEN ───────
# Ein `n="$(helfer)"` führt den Helfer in einer SUBSHELL aus. Ein `exit 1`
# darin beendet nur die Subshell; das Skript liefe mit leerem Wert weiter —
# also genau der Fehlschlag, den diese Helfer verhindern sollen. Deshalb
# setzen sie IMAGE_STAND bzw. DB_STAND und geben nichts aus.
zahl(){ [[ "$1" =~ ^[0-9]+$ ]]; }

IMAGE_STAND=""
image_stand_ermitteln(){
  IMAGE_STAND="$(podman run --rm --entrypoint node localhost/roses-blog:previous \
    -e "console.log(require('fs').readdirSync('/app/drizzle').filter(f=>f.endsWith('.sql')).length)")" \
    || fail "Migrationsstand des :previous-Images nicht ermittelbar — Abbruch statt ungeprüftem Start."
  zahl "$IMAGE_STAND" \
    || fail "Migrationsstand des :previous-Images ist keine Zahl ('$IMAGE_STAND') — Abbruch."
}

DB_STAND=""
# $1 = Pfad der Datenbank RELATIV zu DATA_DIR (z. B. app.db oder backups/…db)
db_stand_ermitteln(){
  DB_STAND="$(podman run --rm --entrypoint node -v "$DATA_DIR:/data" localhost/roses-blog:previous \
    -e "const db=require('better-sqlite3')('/data/'+process.argv[1],{readonly:true});console.log(db.pragma('user_version',{simple:true}));db.close()" \
    "$1")" \
    || fail "Schema-Stand von $1 nicht ermittelbar — Abbruch statt ungeprüftem Start."
  zahl "$DB_STAND" \
    || fail "Schema-Stand von $1 ist keine Zahl ('$DB_STAND') — Abbruch."
}

# Vergleicht den Stand einer Datenbank mit dem, was :previous kennt.
schema_vergleichen(){
  local was="$1"
  [[ "$DB_STAND" -le "$IMAGE_STAND" ]] || fail "Schema ist der zurückgerollten Anwendung VORAUS: \
$was auf Stand $DB_STAND, :previous kennt $IMAGE_STAND Migrationen. Ein Rollback auf ein zu neues \
Schema wird nicht als Erfolg quittiert."
  log "Schema-Stand: $was $DB_STAND, :previous kennt $IMAGE_STAND Migrationen."
}

schema_pruefen(){
  [[ -f "$DATA_DIR/app.db" ]] || return 0
  db_stand_ermitteln "app.db"
  image_stand_ermitteln
  schema_vergleichen "Datenbank"
}

# 2. Vorbedingungen, die KEINEN Stillstand rechtfertigen — vor dem Stoppen.
#
# Bis 08/2026 stand die Suche nach dem Backup HINTER dem `podman rm -f`: Wer
# `--with-db` rief und kein Pre-Deploy-Backup hatte, stand danach ohne Dienst da
# — abgeschaltet für einen Lauf, der unmittelbar darauf abbrach. Ein Fehlschlag,
# der zusätzlich den intakten Dienst kostet, ist teurer als der Fehlschlag
# selbst (Befund gpt-5.6-sol, PR #110).
#
# Alles, was ohne Stillstand feststellbar ist, wird deshalb hier festgestellt.
# Das sind DREI Fragen, und die dritte fehlte in der ersten Fassung dieses
# Blocks (zweite Runde desselben Befunds):
#
#   a) Gibt es überhaupt ein Backup?
#   b) Ist es LESBAR? Ein abgeschnittenes oder halb geschriebenes Backup fiel
#      früher erst auf, nachdem `cp` es über die laufende Datenbank gelegt
#      hatte.
#   c) PASST SEIN SCHEMA zu :previous? Ein gültiges, aber ZU NEUES Backup kam
#      durch a) und b) glatt durch. Der Dienst wurde gestoppt, app.db
#      überschrieben, das WAL gelöscht — und ERST DANN brach die Prüfung ab.
#      Vermeidbarer Ausfall, und dazu ein veränderter Zustand, den niemand
#      gewollt hatte.
#
# Der Lesetest fährt dabei genau die Maschinerie an, die die Sicherung in
# Schritt 4 braucht: das :previous-Image, den Mount, better-sqlite3. Was danach
# beim Sichern noch schiefgehen kann, ist ein echter Fehler (volle Platte etwa)
# — dann ist der Abbruch richtig, auch wenn der Dienst dafür schon steht.
if [[ $WITH_DB -eq 1 ]]; then
  BACKUP=$(ls -1t "$DATA_DIR"/backups/pre-deploy-*.db 2>/dev/null | head -1 || true)
  [[ -n "$BACKUP" ]] \
    || fail "--with-db verlangt, aber kein Pre-Deploy-Backup gefunden — Dienst läuft unverändert weiter."
  BACKUP_NAME="$(basename "$BACKUP")"
  log "Prüfe das Backup auf Lesbarkeit: $BACKUP"
  podman run --rm --entrypoint node -v "$DATA_DIR:/data" localhost/roses-blog:previous \
    -e "const db=require('better-sqlite3')('/data/backups/'+process.argv[1],{readonly:true});const r=db.pragma('integrity_check',{simple:true});db.close();if(r!=='ok'){console.error(r);process.exit(1)}" \
    "$BACKUP_NAME" \
    || fail "Backup $BACKUP ist unlesbar oder beschädigt — Rollback abgebrochen, Dienst läuft unverändert weiter."
  db_stand_ermitteln "backups/$BACKUP_NAME"
  image_stand_ermitteln
  schema_vergleichen "das Backup $BACKUP_NAME"
else
  # Ohne --with-db bleibt die Datenbank, wie sie ist — ob ihr Schema der
  # zurückgerollten Anwendung voraus ist, steht damit JETZT schon fest und
  # braucht den Stillstand nicht.
  schema_pruefen
fi

# 3. Container STOPPEN — vor JEDEM Eingriff an der Datenbank.
#
# Bis 08/2026 stand der DB-Restore VOR dem Stoppen: Die Datei wurde unter einer
# laufenden SQLite-Verbindung ausgetauscht. Das ist kein Randfall, das ist der
# Normalfall beim Rollback — der alte Container läuft ja noch.
#
# Vorher wird das Protokoll gesichert (Befund 3 der Gegenprüfung): `podman rm`
# nimmt die Logs mit, und beim Rollback ist gerade das interessant, was der
# fehlgeschlagene Stand zuletzt gesagt hat.
PROTOKOLL="$DATA_DIR/rollback-$(date +%Y%m%d-%H%M%S).log"
if podman container exists roses-blog 2>/dev/null; then
  log "Sichere Container-Protokoll nach $PROTOKOLL"
  podman logs roses-blog > "$PROTOKOLL" 2>&1 || log "WARNUNG: Protokoll nicht lesbar."
fi
log "Stoppe Container"
$COMPOSE down --remove-orphans >/dev/null 2>&1 || true
podman rm -f roses-blog >/dev/null 2>&1 || true
# ── UND JETZT FESTSTELLEN, DASS ER WIRKLICH WEG IST ───────────────────────
#
# Beide Zeilen darüber werfen ihren Rückgabewert weg (`|| true`) — bewusst, denn
# „war schon weg" ist kein Fehler. Bis 08/2026 prüfte danach aber NICHTS, ob der
# Container tatsächlich verschwunden ist, obwohl die Überschrift dieses
# Abschnitts das Stoppen zur Voraussetzung für JEDEN Eingriff an der Datenbank
# erklärt.
#
# Nachgestellt mit einem podman, das bei `rm` fehlschlägt: Das Skript legte das
# Backup unter der noch offenen SQLite-Verbindung ab, löschte deren `-wal`, und
# meldete am Ende „Rollback erfolgreich (Health grün)" — beantwortet hatte den
# Health-Ping der ALTE Container, der nie gestoppt worden war. Exit 0. Das
# Health-Gate kann „zurückgerollt" und „nie gestoppt" nicht unterscheiden.
#
# Das passende Idiom steht sechs Zeilen weiter oben und wurde nur zum Sichern
# des Protokolls benutzt. Hier ist es die Bedingung dafür, überhaupt
# weiterzumachen: Ein `$COMPOSE up -d` weiter unten trifft danach garantiert
# keinen bestehenden Container mehr an.
if podman container exists roses-blog 2>/dev/null; then
  fail "Container roses-blog ist nach dem Stoppen NOCH DA — die Datenbank bleibt \
unangetastet. Ein Eingriff unter einer laufenden SQLite-Verbindung ist genau der \
Datenverlust, den dieses Skript verhindern soll. Von Hand nachsehen: \
podman ps -a --filter name=roses-blog"
fi

# 4. Optional DB zurückspielen (jüngstes Pre-Deploy-Backup, oben geprüft).
#
# ── WARUM HIER KEIN `cp` DER LAUFENDEN DATENBANK STEHT ─────────────────────
#
# Die Anwendung fährt SQLite im WAL-Modus. Frisch festgeschriebene Daten stehen
# dann im `-wal`, nicht in `app.db` — bis ein Checkpoint sie überträgt. Ein
# `cp app.db` nimmt genau diese Daten NICHT mit.
#
# Nachgemessen (tests/rollback-wal.test.ts hält es fest): 3000 Zeilen in EINER
# Transaktion festgeschrieben, Verbindung offen — `app.db` ist danach 4096 Byte
# groß (nur der Kopf), das `-wal` 70 KB. Die `cp`-Kopie enthält nicht 2985 von
# 3000 Zeilen, sie enthält die TABELLE NICHT. Die Sicherung des Standes, den
# man gerade überschreibt, wäre also leer gewesen.
#
# Richtig ist die Online-Backup-API — dieselbe, die deploy.sh und
# deploy/backup.sh längst benutzen. Sie liest das WAL mit und schreibt EINE
# in sich stimmige Datei. Gefahren wird sie im :previous-Image: Es ist der
# bekannt gute Stand: das laufende :latest ist ja gerade der Grund für den
# Rollback.
if [[ $WITH_DB -eq 1 ]]; then
  if [[ -f "$DATA_DIR/app.db" ]]; then
    SICHERUNG="pre-rollback-$(date +%Y%m%d-%H%M%S).db"
    log "Sichere den JETZIGEN Stand (Online-Backup-API): $SICHERUNG"
    podman run --rm --entrypoint node -v "$DATA_DIR:/data" localhost/roses-blog:previous \
      -e "const db=require('better-sqlite3')('/data/app.db',{readonly:true});db.backup('/data/backups/'+process.argv[1]).then(()=>{db.close()}).catch(e=>{console.error(e);process.exit(1)})" \
      "$SICHERUNG" \
      || fail "Sicherung des jetzigen Standes fehlgeschlagen — Rollback abgebrochen, statt ohne Netz weiterzumachen."
  fi

  log "Spiele Backup ein: $BACKUP"
  # Mit `|| fail`, wie jede andere riskante Operation hier auch: Ein an der
  # vollen Platte abgebrochenes `cp` hinterlässt eine HALBE Datenbank — und der
  # Lauf machte bisher weiter, löschte das WAL und quittierte Erfolg.
  cp "$BACKUP" "$DATA_DIR/app.db" \
    || fail "Einspielen von $BACKUP fehlgeschlagen — app.db ist möglicherweise \
unvollständig. Die Sicherung des vorigen Standes liegt in $DATA_DIR/backups/."
  # ── UND DIE ALTEN WAL-DATEIEN MÜSSEN WEG ────────────────────────────────
  # Sonst spielt SQLite beim nächsten Öffnen das WAL der ERSETZTEN Datenbank
  # über das eingespielte Backup. Nachgemessen: nach hartem Abbruch
  # (`podman rm -f`, also der Regelfall hier) liefert die Datenbank danach die
  # 3000 ALTEN Zeilen statt der 7 gesicherten — der Restore tut nichts und
  # meldet Erfolg. Das ist schlimmer als ein Fehlschlag.
  rm -f "$DATA_DIR/app.db-wal" "$DATA_DIR/app.db-shm"

  # 4b. Das letzte Wort hat die Datei, die WIRKLICH daliegt.
  #
  # Ihr Stand ist oben schon am Backup geprüft worden, und genau deshalb ist
  # der Dienst überhaupt noch bis hierher gekommen. Diese Prüfung misst nun
  # nicht mehr die Absicht, sondern das Ergebnis: Sie fällt nur noch, wenn
  # `cp` etwas anderes hinterlassen hat, als geprüft wurde.
  schema_pruefen
fi

# 5. Image zurückrollen + Container starten.
log "Rolle Image zurück: :previous → :latest"
podman tag localhost/roses-blog:previous localhost/roses-blog:latest
# deploy-state entwerten: die Datei beschreibt, welcher Stand ZULETZT ERFOLGREICH
# ausgerollt wurde, und ist die Grundlage des Schnellpfads in deploy.sh. Bleibt
# sie nach einem Rollback stehen, hält deploy.sh den zurückgerollten Server für
# aktuell und deployt nie wieder (beobachtet 2026-08-10: „Bereits aktuell
# (Commit c60bea7)", während das alte Image lief).
rm -f "$DATA_DIR/deploy-state" 2>/dev/null || true
# Ebenso der Zeuge des bekannt guten Images: Nach einem Rollback läuft :previous,
# und ob DAS gut ist, weiß erst das Health-Gate unten. Ohne dieses Löschen würde
# der nächste Deploy einen ungeprüften Stand als bekannt gut fortschreiben.
rm -f "$DATA_DIR/deploy-image-ok" 2>/dev/null || true
$COMPOSE up -d || fail "Container-Neustart fehlgeschlagen."

# 6. Healthcheck-Gate: erst grün, dann gilt der Rollback als erfolgreich.
for i in $(seq 1 30); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    dur=$(( $(date +%s) - start ))
    log "Rollback erfolgreich in ${dur}s (Health grün)."
    exit 0
  fi
  sleep 2
done
# Auch der Fehlschlag wird protokolliert, bevor jemand den Container anfasst.
podman logs roses-blog > "$DATA_DIR/rollback-fehlschlag-$(date +%Y%m%d-%H%M%S).log" 2>&1 || true
fail "Health nach Rollback nicht grün — manuell prüfen. Protokolle: $DATA_DIR/rollback-fehlschlag-*.log"
