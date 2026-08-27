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

# Der Typ-Vertrag für Medien-Archive — dieselbe Datei, die deploy/restore.sh
# quellt. Wer sichert, muss sich an den Vertrag halten, an dem das Einspielen
# später misst; sonst entsteht eine Sicherung, die niemand annimmt.
# shellcheck source=deploy/archiv-typen.sh
source "$(dirname "$0")/archiv-typen.sh"

# ── DIE UMGEBUNG DARF TAR NICHT UMSTIMMEN (Panel-Runde 8) ─────────────────
# GNU tar liest `TAR_OPTIONS` und nimmt von dort jede Option an — dieselbe
# Klasse wie `.curlrc` beim Health-Gate, nur beim anderen Werkzeug. Ein
# `--dereference` darin archiviert einen Symlink in uploads/ als REGULÄRE
# Datei MIT DEM INHALT, auf den er zeigt. Gemessen:
#
#     ln -s /pfad/geheim.txt uploads/harmlos.jpg
#     TAR_OPTIONS=--dereference tar -czf …
#     -> Mitglied trägt Typ '-', der Typ-Vertrag ist zufrieden,
#        und `tar -xzO` liefert GEHEIM.
#
# Der Restore veröffentlichte den Inhalt danach unter uploads/. Die Zusage
# „kein Link-Mitglied" wäre also wahr geblieben und trotzdem wertlos.
unset TAR_OPTIONS

warn(){ echo "WARNUNG: $*" >&2; }
fail(){ echo "[backup] FEHLER: $*" >&2; exit 1; }

# Dasselbe für das Sicherungsverzeichnis selbst: Wäre es ein untergeschobener
# Link, sicherte dieser Lauf woandershin — und die Rotation räumte dort auf.
#
# ── ERST DEN SCHLUSS-SCHRÄGSTRICH WEG (Panel-Runde 7) ─────────────────────
#
# `-L` prüft den PFAD, wie er dasteht. Ein Schluss-Schrägstrich zwingt das
# Betriebssystem, ihn als Verzeichnis aufzulösen — der Test sieht dann das
# ZIEL und nicht den Link. Gemessen:
#
#     BACKUP_DIR=…/verweis    ->  [[ -L ]] wahr    (Wächter greift)
#     BACKUP_DIR=…/verweis/   ->  [[ -L ]] falsch  (Wächter LÄSST DURCH)
#
# Und dieser Wert kommt von außen: aus der Umgebung des Aufrufers oder aus
# `.env`. Ein Pfad mit Schrägstrich am Ende ist dort nichts Ungewöhnliches.
#
# Eine frühere Panel-Runde hatte darauf hingewiesen, und ich habe sie abgewiesen
# — mit der richtigen Feststellung, dass im QUELLTEXT kein Schrägstrich steht,
# und der falschen Annahme, damit sei die Sache erledigt. Geprüft gehört der
# WERT, nicht die Schreibweise an der Prüfstelle.
#
# ── NACHTRAG RUNDE 8: `/` ALLEIN GENÜGT NICHT ─────────────────────────────
# Die erste Fassung schnitt nur Schluss-Schrägstriche ab. `verweis/.` trägt
# keinen — und dereferenziert genauso. Gemessen:
#
#     'verweis'    -> 'verweis'    -> Wächter greift
#     'verweis/'   -> 'verweis'    -> Wächter greift
#     'verweis/.'  -> 'verweis/.'  -> Wächter LÄSST DURCH
#
# Dasselbe Muster wie eine Runde davor: Ich hatte EINEN Fall gemessen und die
# Klasse für erledigt erklärt. Deshalb jetzt nicht mehr Fall für Fall, sondern
# eine Regel über die Form: Ein Sicherungsverzeichnis wird als schlichter Pfad
# angegeben. Trägt der Wert ein `.`- oder `..`-Glied, wird er ABGEWIESEN statt
# zurechtgebogen — ein zurechtgebogener Wert ist wieder eine Aussage darüber,
# was der Betreiber wohl gemeint hat.
while [[ "$BACKUP_DIR" == */ && "$BACKUP_DIR" != "/" ]]; do
  BACKUP_DIR="${BACKUP_DIR%/}"
done
[[ "/$BACKUP_DIR/" != */../* && "/$BACKUP_DIR/" != */./* ]] \
  || fail "$BACKUP_DIR enthält ein Pfadglied '.' oder '..'. Bitte den Pfad \
schlicht angeben: solche Glieder lassen die Linkprüfung ins Leere greifen, \
weil das Betriebssystem den Pfad dann als Verzeichnis auflöst."
# ── NACHTRAG RUNDE 9: `-L` SIEHT NUR DIE LETZTE KOMPONENTE ────────────────
#
# `verweis/sub` ist kein Link — `sub` ist ja einer echtes Verzeichnis —, und
# der Pfad löst trotzdem durch `verweis` hindurch auf. Gemessen:
#
#     [[ -L "verweis/sub" ]]      -> falsch (Wächter LÄSST DURCH)
#     readlink -f "verweis/sub"   -> …/echt/sub
#
# Zum dritten Mal in Folge lautete der Befund: Die Regel deckt ihre eigene
# Klasse nicht ab. Deshalb hier keine weitere Komponente mehr, sondern eine
# Aussage über den GANZEN Pfad: Er muss seiner eigenen kanonischen Form
# entsprechen. Weicht sie ab, führte irgendwo ein Link hindurch — gleich an
# welcher Stelle. (`-m` verlangt nicht, dass der Pfad schon existiert; das
# Verzeichnis wird gleich darauf angelegt.)
KANONISCH="$(readlink -m "$BACKUP_DIR")"
[[ "$KANONISCH" == "$BACKUP_DIR" ]] \
  || fail "$BACKUP_DIR löst nach $KANONISCH auf — irgendwo im Pfad steht ein \
symbolischer Link, oder der Pfad ist nicht absolut und schlicht angegeben. \
Dorthin wird nicht gesichert; bitte den aufgelösten Pfad direkt angeben."
mkdir -p "$BACKUP_DIR"

# ── DIE VORBEDINGUNG, DIE ALLE WÄCHTER OBEN STILL ANNAHMEN (Runde 9) ──────
#
# Werkstatt, `platz_frei` und `mv -fT` verhindern, dass DIESES Skript durch
# einen untergeschobenen Alias schreibt. Gegen jemanden, der IN $BACKUP_DIR
# schreiben darf, halten sie trotzdem nicht: Wer dort Einträge anlegen und
# umbenennen kann, kann auch die Werkstatt wegbenennen und einen Link an ihre
# Stelle setzen, während der Lauf läuft.
#
# Das ist keine Lücke, die sich im Skript schließen lässt — es ist eine
# Eigenschaft der Rechte auf dem Verzeichnis. Also wird sie hier nicht länger
# angenommen, sondern VERLANGT: Wer nicht wir ist, darf hier nicht schreiben.
# Damit fällt die ganze Klasse weg, statt Fall für Fall abgefangen zu werden.
RECHTE="$(stat -c %a "$BACKUP_DIR" 2>/dev/null || echo "")"
[[ -n "$RECHTE" ]] || fail "Rechte von $BACKUP_DIR nicht lesbar."
[[ $((8#$RECHTE & 8#022)) -eq 0 ]] \
  || fail "$BACKUP_DIR ist für Gruppe oder andere BESCHREIBBAR (Modus \
$RECHTE). Wer dort schreiben darf, kann jede Sicherung dieses Laufs umleiten \
oder ersetzen — dagegen hilft kein Wächter im Skript, nur der Modus. Bitte \
`chmod go-w` setzen."

# ── GESCHRIEBEN WIRD IN EINE WERKSTATT, NICHT AN DEN ZIELNAMEN (Runde 7) ───
#
# Die Prüfung „steht hier etwas?" fängt den VORHER gelegten Alias ab. Sie
# fängt NICHT das Wettrennen danach: Zwischen der Prüfung und dem Augenblick,
# in dem tar bzw. die Backup-API die Datei öffnet, kann jemand einen Link an
# den Zielnamen legen — die Zielnamen tragen einen Zeitstempel und sind damit
# vorhersagbar. Bisher stand genau das nur als ehrlicher Satz im Kommentar.
#
# Geschlossen wird es so: Gearbeitet wird in einem frisch angelegten
# Verzeichnis mit unvorhersagbarem Namen, das nur uns gehört (0700). Dort
# hinein kann niemand vorab etwas legen. Fertig wird die Datei mit `mv` an
# ihren Platz gebracht — und `mv` benennt um, es schreibt nicht durch einen
# Link hindurch. Gemessen:
#
#     ln -s opfer ziel;  mv -fT quelle ziel
#     -> "opfer" unverändert, "ziel" ist danach eine echte Datei.
#
# Damit gibt es kein Fenster mehr, in dem ein untergeschobener Alias etwas
# bewirken könnte: Während des Schreibens ist der Name geheim, und beim
# Veröffentlichen wird nicht geschrieben, sondern umbenannt.
#
# ── NACHTRAG RUNDE 8: `-T` IST NICHT OPTIONAL ─────────────────────────────
# Oben stand zuerst `mv -f`, gemessen an einem Link auf eine DATEI. Zeigt der
# Link aber auf ein VERZEICHNIS, verschiebt `mv` die Datei HINEIN, statt den
# Link zu ersetzen. Gemessen:
#
#     ln -s fremdes-verzeichnis ziel
#     mv -f  quelle ziel   -> ziel bleibt Link, quelle liegt IM Fremdziel
#     mv -fT quelle ziel   -> Link ersetzt
#
# Die Sicherung wäre also in einem fremden Verzeichnis gelandet, der Lauf
# grün geblieben. `-T` sagt: Das Ziel ist ein NAME, kein Verzeichnis.
# Wieder dasselbe Muster: einen Fall gemessen, die Klasse für erledigt
# erklärt.
WERKSTATT="$(mktemp -d "$BACKUP_DIR/.werkstatt-XXXXXX")" \
  || fail "Werkstatt-Verzeichnis in $BACKUP_DIR ließ sich nicht anlegen."
chmod 700 "$WERKSTATT"
# Auch bei Abbruch: eine halbfertige Sicherung gehört nicht in den Bestand,
# und die Rotation soll sie nie zu Gesicht bekommen.
trap 'rm -rf "$WERKSTATT"' EXIT

DB_OK=0
UPLOADS_OK=0

# ── 1. SQLite konsistent sichern ───────────────────────────────────────────
# Online-Backup-API, funktioniert bei laufender App. Ein DB-Fehler darf das
# Uploads-Backup NICHT verhindern — deshalb gekapselt statt `set -e`-Abbruch;
# über den Exit-Code des Laufs entscheidet Schritt 4.
ZIEL_DB="$BACKUP_DIR/app-$STAMP.db"
# Gearbeitet wird in der Werkstatt, veröffentlicht wird mit `mv`.
ROH="$WERKSTATT/app-$STAMP.db"
IM_MOUNT="$(basename "$WERKSTATT")/app-$STAMP.db"
# Beide Zielpfade sind VORHERSAGBAR (Zeitstempel). Läge dort ein
# untergeschobener Link, schriebe tar bzw. die Backup-API durch ihn hindurch
# auf ein fremdes Ziel — und der Lauf könnte grün enden. Ein Link an dieser
# Stelle ist nie etwas, das dieses Skript erzeugt hat.
#
# Ehrlich zur Reichweite: Das fängt einen VORHER untergeschobenen Alias ab,
# nicht das Wettrennen danach. Wer in $BACKUP_DIR schreiben darf, kann die
# Sicherungen ohnehin unmittelbar verändern; hier geht es darum, nicht selbst
# durch einen Alias zu schreiben.
#
# ── WARUM NICHT NUR `-L` (Panel-Runde 6) ──────────────────────────────────
# Die vorige Fassung hieß `kein_link` und fragte allein `[[ ! -L ]]`. Ein
# HARDLINK ist aber genau derselbe Angriff mit einem anderen Werkzeug: Er
# teilt sich den Inode mit seinem Ziel, und `-L` sieht ihn nicht. Gemessen:
#
#     ln $DATA_DIR/app.db $BACKUP_DIR/uploads-$STAMP.tar.gz
#     tar -czf "$UPLOADS_ARCHIV" ...   Exit 0, UPLOADS_OK=1
#     -> $DATA_DIR/app.db IST DANACH DAS GZIP-ARCHIV. Der Lauf bleibt grün.
#
# `tar -czf` (wie auch die Backup-API im Container) öffnet mit O_TRUNC und
# schreibt in den Inode, nicht in den Namen. Die Live-Datenbank war weg, und
# nichts im Protokoll sagte es.
#
# Die richtige Frage ist deshalb nicht „ist das ein Link?", sondern „ist hier
# überhaupt etwas?". Die Zielpfade tragen einen Zeitstempel; an dieser Stelle
# steht nie etwas, das dieses Skript angelegt hat — gleich welcher Art.
# (`-e` folgt Links, `-L` fängt zusätzlich den toten Link ab, den `-e` verneint.)
platz_frei(){
  [[ ! -e "$1" && ! -L "$1" ]] || fail "$1 existiert bereits. Dorthin wird \
nicht gesichert — an dieser Stelle steht nie etwas, das dieses Skript angelegt \
hat, und ein untergeschobener Alias (Sym- ODER Hardlink) ließe diesen Lauf \
durch ihn hindurch schreiben."
}
platz_frei "$ZIEL_DB"
platz_frei "$ZIEL_DB.gz"
if [[ -f "$DATA_DIR/app.db" ]]; then
  # BACKUP_DIR wird als EIGENER Mount hereingereicht, nicht als Unterverzeichnis
  # von DATA_DIR angenommen. Bis 08/2026 stand hier hart `/data/backups/`: Zeigte
  # BACKUP_DIR woandershin — auf eine eingehängte Platte etwa, wozu die
  # Einstellung da ist —, schrieb der Container trotzdem unter DATA_DIR, das
  # Skript sah am angegebenen Ort nach, fand nichts und verwarf den Lauf. Die
  # fehlgeleitete Datei blieb dabei liegen: Die Rotation räumt nur in
  # BACKUP_DIR auf, also sah sie dort nie jemand wieder.
  if "$PODMAN" run --rm --entrypoint node -v "$DATA_DIR:/data" -v "$BACKUP_DIR:/backups" localhost/roses-blog:latest \
       -e "const db=require('better-sqlite3')('/data/app.db',{readonly:true});db.backup('/backups/'+process.argv[1]).then(()=>{db.close()}).catch(e=>{console.error(e);process.exit(1)})" \
       "$IM_MOUNT"
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
         "$IM_MOUNT"
    then
      # Ab hier liegt eine GEPRÜFTE Sicherung. Sie wird nicht mehr weggeworfen.
      DB_OK=1
      # Komprimieren NOCH in der Werkstatt, dann an den Platz bringen. Erst
      # das `mv` macht die Sicherung sichtbar — halbfertig sieht sie niemand,
      # und die Rotation bekommt sie nie in diesem Zustand zu Gesicht.
      if gzip "$ROH"; then
        mv -fT "$ROH.gz" "$ZIEL_DB.gz" \
          || fail "Die geprüfte Sicherung ließ sich nicht nach $ZIEL_DB.gz bringen."
        echo "DB-Backup:      $ZIEL_DB.gz"
      else
        warn "Komprimieren fehlgeschlagen — die GEPRÜFTE Sicherung bleibt \
unkomprimiert: $ZIEL_DB. (Sie wird nicht gelöscht; früher tat das ein \
pauschales rm und vernichtete damit ein gültiges Backup.)"
        mv -fT "$ROH" "$ZIEL_DB" \
          || fail "Die geprüfte Sicherung ließ sich nicht nach $ZIEL_DB bringen."
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
ZIEL_UPLOADS="$BACKUP_DIR/uploads-$STAMP.tar.gz"
UPLOADS_ARCHIV="$WERKSTATT/uploads-$STAMP.tar.gz"
platz_frei "$ZIEL_UPLOADS"
# Gibt es Medien, MUSS dieser Lauf ein Archiv davon erzeugen. Gibt es keine,
# ist nichts zu sichern und der Lauf darf trotzdem gelingen.
UPLOADS_NOETIG=0
if [[ -d "$DATA_DIR/uploads" ]]; then
  UPLOADS_NOETIG=1

  # ── KEIN ALIAS IM QUELLBAUM (Panel-Runde 9) ─────────────────────────────
  #
  # Der Typ-Vertrag prüft, was das ARCHIV ankündigt. Ein Hardlink verschwindet
  # dort aber, sobald sein zweiter Name AUSSERHALB des Archivs liegt: tar hat
  # dann nichts zum Verlinken und schreibt eine reguläre Datei MIT INHALT.
  # Gemessen:
  #
  #     ln $DATA_DIR/app.db $DATA_DIR/uploads/leak.webp
  #     tar -czf … -C $DATA_DIR uploads
  #     -> [-] uploads/leak.webp, Inhalt: die DATENBANK
  #
  # Der Vertrag ist zufrieden (Typ '-'), und der Restore veröffentlicht die
  # Datenbank unter uploads/. Ich hatte diesen Befund zweimal abgewiesen — mit
  # einer Messung, bei der BEIDE Namen im Archiv lagen; dann meldet tar 'h'.
  # Die Messung war für ihren Fall richtig und als Widerlegung falsch.
  #
  # Die Lehre daraus steht in der Prüfung selbst: Ein Name kann lügen, ein
  # INODE nicht. Gefragt wird deshalb nicht mehr, wie etwas heißt oder wie tar
  # es serialisiert, sondern ob die Datei mehr als einen Namen hat. Ein
  # Medienverzeichnis, das die Anwendung füllt, enthält keine Hardlinks.
  ALIAS="$(find "$DATA_DIR/uploads" -type f -links +1 -print -quit 2>/dev/null || true)"
  if [[ -n "$ALIAS" ]]; then
    warn "$ALIAS trägt mehr als einen Namen (Hardlink). Ein solcher Eintrag \
landet als reguläre Datei MIT dem Inhalt seines Gegenstücks im Archiv, und der \
Restore veröffentlicht ihn unter uploads/. Es wird kein Medien-Archiv erzeugt."
  elif tar -czf "$UPLOADS_ARCHIV" -C "$DATA_DIR" uploads; then
    # ── UND ES MUSS SICH EINSPIELEN LASSEN ─────────────────────────────────
    # Der Exit-Code von tar sagt nur, dass ein Archiv entstanden ist — nicht,
    # dass deploy/restore.sh es je annimmt. Dieselbe Lücke wie bei der
    # Datenbank, wo `integrity_check` sie seit B16 schließt: Wer hier nicht
    # prüft, verschiebt den Befund auf den Tag, an dem es darauf ankommt.
    #
    # Der Vertrag steht in deploy/archiv-typen.sh und wird von beiden Skripten
    # gequellt — eine zweite Abschrift hier wäre genau die Uneinigkeit, die
    # den Befund erzeugt hat.
    if GRUND="$(archiv_typen_ok "$UPLOADS_ARCHIV")"; then
      mv -fT "$UPLOADS_ARCHIV" "$ZIEL_UPLOADS" \
        || fail "Das geprüfte Archiv ließ sich nicht nach $ZIEL_UPLOADS bringen."
      UPLOADS_OK=1
      echo "Uploads-Backup: $ZIEL_UPLOADS"
    else
      warn "Das erzeugte Archiv $UPLOADS_ARCHIV $GRUND
Es ließe sich nicht wiederherstellen und wird deshalb NICHT als Sicherung
gezählt — entfernt. Ursache beheben: $DATA_DIR/uploads enthält etwas, das
weder Verzeichnis noch reguläre Datei ist."
      rm -f "$UPLOADS_ARCHIV"
    fi
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
