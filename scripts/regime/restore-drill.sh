#!/usr/bin/env bash
# Restore-Drill (Mandat B-31): ein Backup ist erst eines, wenn es
# wiederhergestellt wurde. Erzeugt eine frische DB mit bekannten Daten,
# sichert sie über die Online-Backup-API (better-sqlite3 .backup), stellt sie
# in ein LEERES Verzeichnis wieder her, prüft die Zeilenzahlen und misst die
# Dauer. Ergebnis wird nach audit/evidence/ geschrieben.
#
# Fälligkeit (Cadence §9.2): monatlich. Überfällig blockiert Releases.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo manual)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$ROOT/audit/evidence"
SRC="$WORK/src"; DST="$WORK/restored"
mkdir -p "$SRC" "$DST"

echo "== Restore-Drill $STAMP =="
START=$(date +%s 2>/dev/null || echo 0)

# 1) Frische DB mit bekannten Daten anlegen (Migration + Seed).
DATA_DIR="$SRC" ADMIN_EMAIL=drill@test.local ADMIN_PASSWORD=drill-pw-123456 \
  node scripts/migrate.mjs >/dev/null
DATA_DIR="$SRC" npx tsx scripts/seed.ts >/dev/null 2>&1 || true

EXPECT=$(node -e "const d=require('better-sqlite3')('$SRC/app.db',{readonly:true});
console.log(d.prepare('select count(*) c from recipe').get().c)")
echo "Quelle: $EXPECT Rezepte in der DB."

# 2) Konsistentes Online-Backup (nicht cp — WAL könnte inkonsistent sein).
node -e "const d=require('better-sqlite3')('$SRC/app.db',{readonly:true});
d.backup('$WORK/backup.db').then(()=>{d.close();console.log('Backup erstellt.')})
.catch(e=>{console.error(e);process.exit(1)})"

# 3) In ein LEERES Verzeichnis wiederherstellen und verifizieren.
cp "$WORK/backup.db" "$DST/app.db"
ACTUAL=$(node -e "const d=require('better-sqlite3')('$DST/app.db',{readonly:true});
console.log(d.prepare('select count(*) c from recipe').get().c)")
echo "Wiederhergestellt: $ACTUAL Rezepte."

END=$(date +%s 2>/dev/null || echo 0)
DUR=$((END - START))

if [[ "$EXPECT" == "$ACTUAL" && "$EXPECT" -gt 0 ]]; then
  RESULT="ERFOLG"
else
  RESULT="FEHLGESCHLAGEN (erwartet $EXPECT, erhalten $ACTUAL)"
fi

REC="$ROOT/audit/evidence/restore-drill-$STAMP.txt"
{
  echo "Restore-Drill $STAMP"
  echo "Ergebnis:      $RESULT"
  echo "Rezepte quelle/restauriert: $EXPECT / $ACTUAL"
  echo "Dauer (s):     $DUR"
  echo "Methode:       better-sqlite3 .backup (Online-API) → leeres Verzeichnis"
} | tee "$REC"

[[ "$RESULT" == "ERFOLG" ]] || exit 1
echo "Beleg: $REC"
