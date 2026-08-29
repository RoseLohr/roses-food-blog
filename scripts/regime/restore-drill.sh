#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Restore-Drill (Mandat B-31): ein Backup ist erst eines, wenn es
# wiederhergestellt wurde.
#
# ── WAS AN DIESEM DRILL BIS 08/2026 FALSCH WAR ────────────────────────────
#
# Er stellte mit `cp` in ein LEERES Verzeichnis wieder her. Die Produktion
# stellt über eine LEBENDE Datenbank wieder her, neben der ein gefülltes
# `-wal` liegt — der Container ist gerade hart weggenommen worden. Genau
# dieser Weg war katastrophal kaputt (B3: SQLite spielte das alte WAL über das
# eingespielte Backup, der Restore war ein stiller No-op und meldete Erfolg),
# und dieser Drill blieb Monat für Monat grün, weil er ihn nie ging.
#
# Ein Drill, der etwas anderes fährt als den Ernstfall, bescheinigt nichts.
# Deshalb jetzt:
#   * Wiederhergestellt wird über eine LEBENDE Datenbank mit gefülltem WAL.
#   * Gefahren wird die PRODUKTIONSFUNKTION `db_einspielen` aus
#     deploy/db-restore.sh — dieselbe Datei, die deploy/rollback.sh quellt.
#     Ein Nachbau könnte auseinanderlaufen; eine gemeinsame Funktion nicht.
#   * Es läuft eine NEGATIVKONTROLLE mit: derselbe Aufbau, naiv mit `cp`
#     wiederhergestellt. Sie MUSS den Fehler zeigen. Tut sie es nicht, kann der
#     Drill die beiden Wege nicht unterscheiden — dann ist er wirkungslos und
#     bricht ab, statt grün zu melden. (Diese Fehlerklasse — eine Kontrolle,
#     die grün ist und nichts kontrolliert — hat dieses Projekt sieben Mal
#     getroffen; sie wird hier ausdrücklich mitgeprüft.)
#
# ── WAS DIESER DRILL NICHT ABDECKT (ehrlich benannt) ──────────────────────
#   * podman: Produktion sichert und liest im Container (:latest bzw.
#     :previous), hier läuft dasselbe better-sqlite3 auf dem Host.
#   * Das Stoppen des Containers und das Zurückrollen des Images
#     (deploy/rollback.sh Schritte 3 und 5) — dafür gibt es
#     tests/rollback-ablauf.test.ts mit Attrappen.
#   * Die Wiederherstellung der Uploads aus dem tar-Archiv.
#
# Fälligkeit (Cadence §9.2): monatlich. Überfällig blockiert Releases.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

fail(){ echo "[restore-drill] FEHLER: $*" >&2; exit 1; }
# Die Produktionsroutine. Nach `fail`, damit deren Notfassung nicht greift.
# shellcheck source=deploy/db-restore.sh
source "$ROOT/deploy/db-restore.sh"

STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo manual)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$ROOT/audit/evidence"
SRC="$WORK/src"
mkdir -p "$SRC"

echo "== Restore-Drill $STAMP =="
START=$(date +%s 2>/dev/null || echo 0)

# ── 1) Frische DB mit bekannten Daten anlegen (Migration + Seed) ───────────
# Ohne `|| true`: ein Seed, der scheitert, ist ein Befund und keine Fußnote.
# Vorher verschluckte der Drill den Fehlschlag und lief mit leerer Datenbank
# weiter — dass er dann trotzdem fiel, lag allein an der Zeilenzahl.
DATA_DIR="$SRC" ADMIN_EMAIL=drill@test.local ADMIN_PASSWORD=drill-pw-123456 \
  node scripts/migrate.mjs >/dev/null \
  || fail "Migration der Drill-Datenbank fehlgeschlagen."
DATA_DIR="$SRC" npx tsx scripts/seed.ts >/dev/null \
  || fail "Seed der Drill-Datenbank fehlgeschlagen."

# Den Seed FESTSCHREIBEN. Er hinterlässt ein 2 MB großes `-wal`; die Daten
# stehen also NICHT in app.db. Ein Aufbau, der nur app.db weiterkopiert, arbeitet
# ab hier mit einer leeren Datenbank — beim Schreiben dieses Drills genau so
# passiert und erst durch die Negativkontrolle aufgefallen. Nach dem Checkpoint
# ist app.db für sich vollständig, und das einzige WAL, das beim Restore
# danebenliegt, ist das, welches Schritt 3 absichtlich erzeugt.
node -e "const d=require('better-sqlite3')('$SRC/app.db');
d.pragma('wal_checkpoint(TRUNCATE)');d.close()" \
  || fail "Checkpoint der Quell-Datenbank fehlgeschlagen."
[[ ! -s "$SRC/app.db-wal" ]] \
  || fail "Nach dem Checkpoint liegt in $SRC immer noch ein gefülltes WAL — \
der Aufbau würde mit unvollständigen Daten weiterarbeiten."

EXPECT=$(node -e "const d=require('better-sqlite3')('$SRC/app.db',{readonly:true});
console.log(d.prepare('select count(*) c from recipe').get().c)")
[[ "$EXPECT" -gt 0 ]] || fail "Quell-Datenbank enthält keine Rezepte — nichts zu prüfen."
echo "Quelle: $EXPECT Rezepte in der DB."

# ── 2) Konsistentes Online-Backup (nicht cp — WAL könnte inkonsistent sein) ─
node -e "const d=require('better-sqlite3')('$SRC/app.db',{readonly:true});
d.backup('$WORK/backup.db').then(()=>{d.close();console.log('Backup erstellt.')})
.catch(e=>{console.error(e);process.exit(1)})" \
  || fail "Online-Backup fehlgeschlagen."

# ── 3) Den Zustand herstellen, den der Ernstfall wirklich vorfindet ────────
#
# Eine Datenbank, in die NACH dem Backup geschrieben wurde, mit einem WAL, das
# nie festgeschrieben (checkpointed) wurde — weil der Container hart
# weggenommen wird. Der Schreiber beendet sich deshalb mit SIGKILL statt mit
# close(): close() würde einen Checkpoint fahren und genau die Bedingung
# beseitigen, die geprüft werden soll.
#
# Zwei Spuren werden hinterlassen, damit beide Richtungen messbar sind:
#   * ein gelöschtes Rezept  → die Zeilenzahl unterscheidet die Wege,
#   * eine Tabelle drill_nachher → ihr Vorhandensein ebenso.
# Ein Restore, der wirkt, macht BEIDES rückgängig.
lebend_herstellen(){
  local ziel="$1"
  rm -rf "$ziel"; mkdir -p "$ziel"
  cp "$SRC/app.db" "$ziel/app.db"
  # 137 = durch SIGKILL beendet, also der GEWOLLTE Ausgang. Jeder andere Wert
  # heißt, der Schreiber ist vorher gestorben — dann steht im WAL etwas anderes
  # als gedacht, und der Drill prüfte einen Zustand, den er nicht kennt.
  #
  # Zwei bash-Fallen sind hier bewusst umgangen: ein `|| true` würde $? auf 0
  # setzen, und ein `local rc=$?` gäbe den Status von `local` zurück, nicht den
  # des Kommandos. Deshalb wird rc vorher deklariert und im `||`-Zweig gesetzt.
  local rc=0
  # Die Shell meldet ein per Signal beendetes Kind mit "Killed" auf IHREM stderr
  # — hier der GEWOLLTE Ausgang, im Protokoll aber ein Fehlalarm. Deshalb ist
  # stderr genau für diesen einen Aufruf beiseitegelegt und danach wieder da.
  exec 3>&2 2>/dev/null
  node -e "
const D=require('better-sqlite3');
const db=D('$ziel/app.db');
db.pragma('journal_mode = WAL');
db.exec('create table drill_nachher (x integer)');
db.prepare('insert into drill_nachher (x) values (1)').run();
db.prepare('delete from recipe where id = (select id from recipe order by id desc limit 1)').run();
process.kill(process.pid, 'SIGKILL');
" >/dev/null 2>&1 || rc=$?
  exec 2>&3 3>&-
  [[ $rc -eq 137 ]] \
    || fail "Der Schreiber endete mit $rc statt durch SIGKILL (137) — er ist vor \
dem harten Abbruch gestorben, das WAL enthält nicht den geprobten Zustand."
  [[ -s "$ziel/app.db-wal" ]] \
    || fail "Aufbau misslungen: $ziel/app.db-wal ist leer oder fehlt — ohne \
gefülltes WAL prüft dieser Drill nicht den Zustand, den der Ernstfall vorfindet."
}

# `befund <verzeichnis>` → "<rezepte> <ja|nein>" (Rezeptzahl, Nachher-Tabelle da?)
befund(){
  node -e "
const D=require('better-sqlite3');
const db=D('$1/app.db',{readonly:true});
const n=db.prepare('select count(*) c from recipe').get().c;
const m=db.prepare(\"select count(*) c from sqlite_master where type='table' and name='drill_nachher'\").get().c;
console.log(n+' '+(m?'ja':'nein'));
db.close();
"
}

# ── 4) Produktionsweg: db_einspielen aus deploy/db-restore.sh ──────────────
ECHT="$WORK/restored"
lebend_herstellen "$ECHT"
db_einspielen "$WORK/backup.db" "$ECHT"
read -r ACTUAL NACHHER_ECHT <<<"$(befund "$ECHT")"
echo "Produktionsweg (db_einspielen): $ACTUAL Rezepte, Nachher-Tabelle: $NACHHER_ECHT"

# ── 5) Negativkontrolle: naives cp, WAL bleibt liegen ──────────────────────
# Sie muss den Fehler REPRODUZIEREN. Nur dann ist bewiesen, dass Schritt 4
# überhaupt etwas gemessen hat.
NAIV="$WORK/naiv"
lebend_herstellen "$NAIV"
cp "$WORK/backup.db" "$NAIV/app.db"
read -r NAIV_ZEILEN NACHHER_NAIV <<<"$(befund "$NAIV")"
echo "Negativkontrolle (naives cp):   $NAIV_ZEILEN Rezepte, Nachher-Tabelle: $NACHHER_NAIV"

END=$(date +%s 2>/dev/null || echo 0)
DUR=$((END - START))

# ── 6) Bewerten ────────────────────────────────────────────────────────────
FEHLER=()
[[ "$ACTUAL" == "$EXPECT" ]] \
  || FEHLER+=("Rezepte nach Restore: erwartet $EXPECT, erhalten $ACTUAL.")
[[ "$NACHHER_ECHT" == "nein" ]] \
  || FEHLER+=("Die nach dem Backup geschriebene Tabelle drill_nachher hat den \
Restore ÜBERLEBT — das alte WAL wurde eingespielt (stiller No-op, Befund B3).")
if [[ "$NACHHER_NAIV" != "ja" || "$NAIV_ZEILEN" == "$EXPECT" ]]; then
  FEHLER+=("NEGATIVKONTROLLE WIRKUNGSLOS: der naive cp-Weg zeigt den Fehler \
nicht (Rezepte $NAIV_ZEILEN, Nachher-Tabelle $NACHHER_NAIV). Damit ist NICHT \
belegt, dass dieser Drill die beiden Wege unterscheiden kann — sein grünes \
Ergebnis wäre wertlos.")
fi

if [[ ${#FEHLER[@]} -eq 0 ]]; then
  RESULT="ERFOLG"
else
  RESULT="FEHLGESCHLAGEN"
fi

REC="$ROOT/audit/evidence/restore-drill-$STAMP.txt"
{
  echo "Restore-Drill $STAMP"
  echo "Ergebnis:      $RESULT"
  echo "Rezepte quelle/restauriert:        $EXPECT / $ACTUAL"
  echo "Nachher-Tabelle nach Restore:      $NACHHER_ECHT (erwartet: nein)"
  echo "Negativkontrolle (naives cp):      $NAIV_ZEILEN Rezepte, Nachher-Tabelle $NACHHER_NAIV (erwartet: ja)"
  echo "Dauer (s):     $DUR"
  echo "Methode:       better-sqlite3 .backup (Online-API) → Restore über eine"
  echo "               LEBENDE Datenbank mit gefülltem WAL, gefahren mit der"
  echo "               Produktionsfunktion db_einspielen (deploy/db-restore.sh),"
  echo "               die auch deploy/rollback.sh quellt."
  echo "Nicht geprüft: podman-Container (Produktion sichert/liest im Image),"
  echo "               Container-Stopp und Image-Rollback (dafür:"
  echo "               tests/rollback-ablauf.test.ts), Uploads-Archiv."
  for f in ${FEHLER+"${FEHLER[@]}"}; do echo "BEFUND:        $f"; done
} | tee "$REC"

[[ "$RESULT" == "ERFOLG" ]] || exit 1
echo "Beleg: $REC"
