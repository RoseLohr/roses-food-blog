#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Konsistentes Backup: SQLite (.backup über die Online-Backup-API) + Uploads.
# Rotation: 14 Tage. Aufruf manuell oder per Cron, z. B. täglich um 03:30:
#
#   30 3 * * * /home/deploy/roses-food-blog/deploy/backup.sh >> /home/deploy/backup.log 2>&1
#
# Restore: siehe README.md Abschnitt "Backup & Restore".
#
# ── WAS AN DIESEM SKRIPT BIS 08/2026 FALSCH WAR (Befund B14/8) ────────────
#
# Es meldete Erfolg, wenn das DB-Backup fehlschlug. Ein `echo "WARNUNG…"` in
# einem Cron-Protokoll, das niemand liest, und Exit 0 — für den Aufrufer war
# der Lauf in Ordnung. Und die Rotation lief danach UNBEDINGT weiter: Nach
# vierzehn Fehlläufen in Folge war KEIN Backup mehr da, und gemerkt hätte es
# erst der, der eines gebraucht hätte.
#
# Beim Nachlesen kamen zwei weitere Fehler im selben Block heraus:
#   * Lief `podman` durch und scheiterte erst `gzip`, löschte das `rm -f` eine
#     GÜLTIGE unkomprimierte Sicherung — der Aufräum-Zweig unterschied nicht,
#     was er da wegwarf.
#   * Die Sicherung wurde nie GELESEN. Nur der Exit-Status von db.backup()
#     zählte. deploy/rollback.sh prüft jedes Backup mit `integrity_check`,
#     bevor es sich darauf verlässt; die Stelle, die es ERZEUGT, tat es nicht.
#     Ein Netz, in das niemand hineingesehen hat, ist keins.
#
# Die Regeln, die daraus folgen und die dieses Skript jetzt trägt:
#   1. Ein Lauf ohne gültiges DB-Backup endet mit Exit != 0. Cron meldet.
#   2. Gelöscht wird nur, was ERSETZT ist: Rotation läuft nur, wenn dieser Lauf
#      für die betreffende Familie etwas Gültiges erzeugt hat — und die jüngste
#      Datei bleibt IMMER liegen.
#   3. Ein Fehlschlag beim Komprimieren kostet die geprüfte Sicherung nicht.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# Rangfolge wie in deploy/rollback.sh: ausdrücklich vom AUFRUFER gesetzte Werte
# > .env > Standard. Ein blindes `set -a; source` würde die Umgebung des
# Aufrufers ÜBERSCHREIBEN — wer `DATA_DIR=… deploy/backup.sh` ruft, sicherte
# dann stillschweigend etwas anderes, als er angegeben hat. Dass die beiden
# Skripte sich hier unterschiedlich verhielten, war ein Unterschied ohne Grund.
AUFRUFER_DATA_DIR="${DATA_DIR:-}"
AUFRUFER_BACKUP_DIR="${BACKUP_DIR:-}"
AUFRUFER_KEEP_DAYS="${BACKUP_KEEP_DAYS:-}"
if [[ -f .env ]]; then
  set -a; source <(grep -E '^[A-Z_]+=' .env); set +a
fi

DATA_DIR="${AUFRUFER_DATA_DIR:-${DATA_DIR:-/srv/roses-blog/data}}"
BACKUP_DIR="${AUFRUFER_BACKUP_DIR:-${BACKUP_DIR:-$DATA_DIR/backups}}"
KEEP_DAYS="${AUFRUFER_KEEP_DAYS:-${BACKUP_KEEP_DAYS:-14}}"
STAMP="$(date +%Y%m%d-%H%M%S)"
PODMAN="${PODMAN:-podman}"

warn(){ echo "WARNUNG: $*" >&2; }
fail(){ echo "[backup] FEHLER: $*" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"

DB_OK=0
UPLOADS_OK=0

# ── 1. SQLite konsistent sichern ───────────────────────────────────────────
# Online-Backup-API, funktioniert bei laufender App. Ein DB-Fehler darf das
# Uploads-Backup NICHT verhindern — deshalb gekapselt statt `set -e`-Abbruch;
# über den Exit-Code des Laufs entscheidet Schritt 4.
ROH="$BACKUP_DIR/app-$STAMP.db"
# Beide Zielpfade sind VORHERSAGBAR (Zeitstempel). Läge dort ein
# untergeschobener Link, schriebe tar bzw. die Backup-API durch ihn hindurch
# auf ein fremdes Ziel — und der Lauf könnte grün enden. Ein Link an dieser
# Stelle ist nie etwas, das dieses Skript erzeugt hat.
#
# Ehrlich zur Reichweite: Das fängt einen VORHER untergeschobenen Link ab,
# nicht das Wettrennen danach. Wer in $BACKUP_DIR schreiben darf, kann die
# Sicherungen ohnehin unmittelbar verändern; hier geht es darum, nicht selbst
# durch einen Link zu schreiben.
kein_link(){
  [[ ! -L "$1" ]] || fail "$1 ist ein symbolischer Link. Dorthin wird nicht \
gesichert — an dieser Stelle steht nie ein Link, den dieses Skript angelegt hat."
}
kein_link "$ROH"
kein_link "$ROH.gz"
if [[ -f "$DATA_DIR/app.db" ]]; then
  rm -f "$ROH"
  # BACKUP_DIR wird als EIGENER Mount hereingereicht, nicht als Unterverzeichnis
  # von DATA_DIR angenommen. Bis 08/2026 stand hier hart `/data/backups/`: Zeigte
  # BACKUP_DIR woandershin — auf eine eingehängte Platte etwa, wozu die
  # Einstellung da ist —, schrieb der Container trotzdem unter DATA_DIR, das
  # Skript sah am angegebenen Ort nach, fand nichts und verwarf den Lauf. Die
  # fehlgeleitete Datei blieb dabei liegen: Die Rotation räumt nur in
  # BACKUP_DIR auf, also sah sie dort nie jemand wieder.
  if "$PODMAN" run --rm --entrypoint node -v "$DATA_DIR:/data" -v "$BACKUP_DIR:/backups" localhost/roses-blog:latest \
       -e "const db=require('better-sqlite3')('/data/app.db',{readonly:true});db.backup('/backups/'+process.argv[1]).then(()=>{db.close()}).catch(e=>{console.error(e);process.exit(1)})" \
       "app-$STAMP.db"
  then
    # ── ERST: LIEGT ÜBERHAUPT ETWAS DA? ────────────────────────────────────
    # Der Exit-Status sagt nur, dass der Aufruf durchlief. Beim Schreiben
    # dieses Skripts stellte sich heraus: Ein podman, das 0 meldet und nichts
    # schreibt, ergab einen "erfolgreichen" Lauf ganz ohne Backup — genau die
    # Fehlerklasse, gegen die diese Datei geschrieben ist. Gefunden hat das
    # der Test zur Konfigurations-Rangfolge, nicht das Nachdenken.
    if [[ ! -s "$ROH" ]]; then
      warn "Der Sicherungslauf meldete Erfolg, aber $ROH fehlt oder ist leer — verworfen."
      rm -f "$ROH"
    # ── DANN: SIE WIRD GELESEN, NICHT NUR ABGESETZT ────────────────────────
    # Dieselbe Prüfung, die rollback.sh vor dem Einspielen fährt. Wer sie hier
    # nicht fährt, verschiebt den Befund auf den Tag, an dem es darauf ankommt.
    elif "$PODMAN" run --rm --entrypoint node -v "$BACKUP_DIR:/backups" localhost/roses-blog:latest \
         -e "const db=require('better-sqlite3')('/backups/'+process.argv[1],{readonly:true});const r=db.pragma('integrity_check',{simple:true});db.close();if(r!=='ok'){console.error(r);process.exit(1)}" \
         "app-$STAMP.db"
    then
      # Ab hier liegt eine GEPRÜFTE Sicherung. Sie wird nicht mehr weggeworfen.
      DB_OK=1
      if gzip "$ROH"; then
        echo "DB-Backup:      $ROH.gz"
      else
        warn "Komprimieren fehlgeschlagen — die GEPRÜFTE Sicherung bleibt \
unkomprimiert liegen: $ROH. (Sie wird nicht gelöscht; früher tat das ein \
pauschales rm und vernichtete damit ein gültiges Backup.)"
      fi
    else
      warn "DB-Backup $ROH ist beschädigt (integrity_check) — verworfen."
      rm -f "$ROH"
    fi
  else
    warn "DB-Backup fehlgeschlagen — fahre mit Uploads-Backup fort."
    rm -f "$ROH"   # evtl. Teil-Datei entfernen
  fi
else
  warn "$DATA_DIR/app.db nicht gefunden — kein DB-Backup."
fi

# ── 2. Uploads archivieren ─────────────────────────────────────────────────
UPLOADS_ARCHIV="$BACKUP_DIR/uploads-$STAMP.tar.gz"
kein_link "$UPLOADS_ARCHIV"
# Gibt es Medien, MUSS dieser Lauf ein Archiv davon erzeugen. Gibt es keine,
# ist nichts zu sichern und der Lauf darf trotzdem gelingen.
UPLOADS_NOETIG=0
if [[ -d "$DATA_DIR/uploads" ]]; then
  UPLOADS_NOETIG=1
  if tar -czf "$UPLOADS_ARCHIV" -C "$DATA_DIR" uploads; then
    UPLOADS_OK=1
    echo "Uploads-Backup: $UPLOADS_ARCHIV"
  else
    warn "Uploads-Backup fehlgeschlagen — abgebrochenes Archiv wird entfernt."
    rm -f "$UPLOADS_ARCHIV"
  fi
else
  # Kein Verzeichnis heißt: es gibt nichts zu sichern. Das ist kein Fehlschlag,
  # aber auch kein frisches Archiv — die Rotation bleibt deshalb aus.
  echo "Hinweis: $DATA_DIR/uploads existiert nicht — kein Uploads-Backup."
fi

# ── 3. Rotation ────────────────────────────────────────────────────────────
#
# Zwei Bedingungen, und die zweite gab es bis 08/2026 nicht:
#   a) Gelöscht wird nur in einer Familie, für die DIESER Lauf etwas Gültiges
#      erzeugt hat. Sonst räumt ein Fehllauf die Sicherungen weg, die er gerade
#      nicht ersetzen konnte.
#   b) Die JÜNGSTE Datei der Familie bleibt IMMER liegen, unabhängig vom Alter.
#      Das hält die Zusage "es gibt immer mindestens ein Backup" auch dann, wenn
#      die Uhr springt oder alle Dateien auf einmal zu alt werden.
#
# `app-*.db` und `app-*.db.gz` sind EINE Familie: Eine unkomprimierte Sicherung
# aus einem Lauf mit gescheitertem gzip ist so gut wie eine komprimierte, und
# der Schutz der jüngsten Datei muss über beide zusammen gelten.
rotieren(){
  local familie="$1"; shift
  local -a dateien=() m f
  for m in "$@"; do
    while IFS= read -r -d '' f; do dateien+=("$f"); done \
      < <(find "$BACKUP_DIR" -maxdepth 1 -name "$m" -type f -print0)
  done
  [[ ${#dateien[@]} -gt 0 ]] || return 0

  local juengste
  juengste="$(ls -1t "${dateien[@]}" 2>/dev/null | head -1 || true)"
  # Unbekannt ist unsicher: Lässt sich die jüngste Datei nicht bestimmen, wird
  # NICHTS gelöscht — sonst wäre der Schutz genau dann weg, wenn er nötig ist.
  [[ -n "$juengste" ]] \
    || fail "Rotation $familie: jüngste Datei nicht bestimmbar — es wird nichts gelöscht."

  local weg=0
  for f in "${dateien[@]}"; do
    [[ "$f" == "$juengste" ]] && continue
    [[ -n "$(find "$f" -maxdepth 0 -mtime "+$KEEP_DAYS" -print -quit)" ]] || continue
    rm -f "$f"
    weg=$((weg + 1))
  done
  [[ $weg -eq 0 ]] \
    || echo "Rotation $familie: $weg Datei(en) älter als $KEEP_DAYS Tage entfernt."
}

# ── 4. Ergebnis — und ZUERST, denn davon hängt die Rotation ab ────────────
# Ein Lauf ohne gültige Sicherung ist kein erfolgreicher Lauf. Cron wertet den
# Exit-Code aus; eine Warnung im Protokoll tut das niemand.
#
# Das gilt für BEIDE Familien. Bis zur Gegenprüfung dieses Zweigs fragte das
# Gate nur nach der Datenbank: Ein `tar`, das an der vollen Platte scheiterte,
# hinterließ eine Warnung und Exit 0. Die Medien sind aber so sehr Teil der
# Sicherung wie die Datenbank — ein Bericht ohne seine Fotos ist wiederher-
# gestellt und trotzdem kaputt.
[[ $DB_OK -eq 1 ]] \
  || fail "Kein gültiges DB-Backup in diesem Lauf ($STAMP). Die vorhandenen \
Sicherungen in $BACKUP_DIR wurden NICHT rotiert."
[[ $UPLOADS_NOETIG -eq 0 || $UPLOADS_OK -eq 1 ]] \
  || fail "Kein Uploads-Archiv in diesem Lauf ($STAMP), obwohl \
$DATA_DIR/uploads existiert. Die vorhandenen Sicherungen in $BACKUP_DIR \
wurden NICHT rotiert."

# ── 5. Rotation — erst jetzt, weil der Lauf ALS GANZES gelungen sein muss ──
#
# Sie stand bis zur Gegenprüfung dieses Zweigs VOR dem Endgate und entschied
# je Familie für sich. Ein Lauf, dessen DB-Sicherung fehlschlug, dessen `tar`
# aber durchlief, löschte deshalb alte Uploads-Archive — und meldete danach
# Fehler. Die Zusage in der README lautet aber: „Rotiert wird nur, was ersetzt
# ist. Ein Fehllauf löscht nichts." Ein Lauf mit Exit != 0 IST ein Fehllauf.
#
# Die Bedingung je Familie bleibt trotzdem stehen: Sie ist die zweite Hälfte
# derselben Zusage (gelöscht wird nur, wofür DIESER Lauf Ersatz erzeugt hat),
# und ohne sie würde ein Lauf ohne uploads/ die Uploads-Archive wegräumen.
if [[ $DB_OK -eq 1 ]]; then
  rotieren "DB" 'app-*.db.gz' 'app-*.db'
fi
if [[ $UPLOADS_OK -eq 1 ]]; then
  rotieren "Uploads" 'uploads-*.tar.gz'
else
  echo "Rotation Uploads übersprungen — dieser Lauf hat kein Archiv erzeugt."
fi

echo "Backup abgeschlossen: $STAMP"
