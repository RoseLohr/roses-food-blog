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
# Der Typ-Vertrag für Medien-Archive — dieselbe Datei, die deploy/backup.sh
# quellt, damit Sichern und Einspielen nicht auseinandergehen können.
# shellcheck source=deploy/archiv-typen.sh
source "$(dirname "$0")/archiv-typen.sh"
# Die Umgebung darf tar nicht umstimmen — siehe deploy/backup.sh, Runde 8.
# Ein `--dereference` oder `--absolute-names` aus TAR_OPTIONS unterliefe hier
# jede Prüfung, die auf dem entsteht, was das Archiv ankündigt.
unset TAR_OPTIONS

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

# ── 0. Ein Lauf zur Zeit ───────────────────────────────────────────────────
#
# `app.db.eingehend` ist ein FESTER Name. Zwei Läufe gleichzeitig — im Ernstfall
# keine Seltenheit, wenn jemand unter Druck zweimal drückt — und Lauf A prüft
# Backup A, Lauf B überschreibt die Nebendatei mit Backup B, Lauf A spielt B ein
# und meldet Erfolg für A. Falsche Daten, die sich für richtige ausgeben: die
# teuerste Sorte Fehler, die dieses Verzeichnis kennt.
command -v flock >/dev/null \
  || fail "flock nicht gefunden (Paket util-linux). Ohne Sperre wird hier nicht \
wiederhergestellt: Zwei gleichzeitige Läufe spielen sonst still das falsche \
Backup ein."
# `>>` und nicht `>`: Ein `>` schneidet die Datei ab, auf die der Pfad zeigt.
# Läge dort ein untergeschobener Link, wäre das Ziel leer, bevor irgendeine
# Prüfung gelaufen ist. Zum Sperren genügt ein Schreib-Deskriptor; abschneiden
# muss dafür niemand.
#
# Ehrlich zur Reichweite: Wer in $DATA_DIR schreiben darf, kann die Datenbank
# ohnehin unmittelbar verändern — diese Zeile schließt keine Lücke, sie
# vermeidet nur, selbst eine destruktive Wirkung zu haben.
exec 9>>"$DATA_DIR/.restore.lock"
flock -n 9 \
  || fail "Es läuft bereits eine Wiederherstellung in $DATA_DIR. Nichts \
angefasst."

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

# Das Medien-Archiv wird HIER geprüft — und zwar, indem es HIER ausgepackt
# wird.
#
# `tar -xzf …` packt aus, was drinsteht. Ein Archiv, das `app.db` mitbringt,
# überschriebe damit die gerade eingespielte Datenbank. Und ein Archiv, das
# sich erst beim Auspacken als kaputt erweist, kostete zusätzlich den Dienst:
# Das Auspacken stand vorher NACH `compose down` und dem Tausch der Datenbank.
#
# ── WARUM DAS VERZEICHNIS GEPRÜFT WIRD UND NICHT DIE LISTE ────────────────
#
# Die vorige Fassung prüfte das INHALTSVERZEICHNIS (`tar -tvzf`) und packte
# danach aus. Zwischen beiden Aufrufen liegt die Datei offen: Was aufgelistet
# wurde, muss nicht sein, was ausgepackt wird. Und die Liste sagt ohnehin
# nicht alles — ein reguläres Mitglied namens `uploads` (statt eines
# Verzeichnisses) oder die Folge `a`, `a/b` steht darin harmlos da und
# scheitert erst beim Auspacken.
#
# Jetzt wird zuerst ausgepackt, in eine Nebenablage, die nichts kostet — und
# dann geprüft, was WIRKLICH dasteht:
#
#   * genau ein Eintrag daneben: das Verzeichnis `uploads` (kein Link),
#   * darin nur Verzeichnisse und reguläre Dateien. Ein Symlink trägt einen
#     einwandfreien Namen und ist trotzdem ein Loch: Nachgemessen packt tar
#     `uploads/leak -> ../app.db` anstandslos aus, und die Auslieferungsroute
#     liest daraufhin die Datenbank über HTTP.
#
# Die NAMEN werden trotzdem vorher geprüft, denn ein Mitglied, das aus der
# Nebenablage herausführt (`..`, absolut), landet gar nicht erst in dem Baum,
# den der Rundgang sieht. Beide Prüfungen tun also, was die andere nicht kann.
# (Den Namens-Traversal weist GNU tar zwar selbst ab — gemessen: Exit 2. Welche
# tar-Fassung auf dem Server liegt, ist aber keine Zusage, die dieses
# Repository geben kann.)
#
# Ein LEERES `uploads/` ist ausdrücklich gültig: `deploy/backup.sh` sichert
# einen leeren Medienbestand anstandslos, und ein Stand, den das eine Skript
# sichert, muss das andere wiederherstellen können. Die vorige Fassung
# verlangte mindestens eine Datei und machte die beiden damit uneins.
NEBENABLAGE="$DATA_DIR/uploads.neu"
if [[ -n "$UPLOADS_ARCHIV" ]]; then
  log "Prüfe das Medien-Archiv: $UPLOADS_ARCHIV"
  ARCHIV_ABBRUCH(){
    rm -f "$EINGEHEND"
    rm -rf "$NEBENABLAGE"
    fail "$1 Nichts eingespielt, der Dienst läuft weiter."
  }
  # Im STROM, nicht in einen Puffer (Panel-Runde 10): Ein winziges Archiv aus
  # Millionen Kopfsätzen ergibt eine Liste von hunderten Megabyte, und der
  # Prüfer stürbe am Speicher, bevor er ein Urteil fällt. Erst die Lesbarkeit
  # nach /dev/null feststellen, dann über eine Prozess-Ersetzung lesen — eine
  # Pipe legte die Schleife in eine Unterschale, aus der ARCHIV_ABBRUCH den
  # Lauf nicht mehr beenden könnte.
  # ── EIN LESEVORGANG, UND SEIN STATUS ZÄHLT (Panel-Runde 11) ─────────────
  #
  # Die vorige Fassung las zweimal: erst `tar -tzf` nach /dev/null, dann
  # dieselbe Liste in einer Prozess-Ersetzung. Deren Exit-Status ging verloren.
  # Scheitert der zweite Lauf, liefert er keine Zeilen, die Schleife läuft nie,
  # und der Namensgate hätte NICHTS geprüft und trotzdem durchgelassen.
  # Gemessen am Typ-Vertrag, wo dieselbe Konstruktion stand: Ein Archiv MIT
  # Symlink kam als „in Ordnung" heraus.
  #
  # `awk` fällt das Urteil in DEMSELBEN Lauf und gibt es über den Exit-Status
  # zurück; `pipefail` lässt ein gescheitertes `tar` durchschlagen. Kein
  # vorzeitiges `exit` in awk, damit tar kein SIGPIPE bekommt und sein Status
  # die Lesbarkeit bezeichnet und nur sie.
  NAMENSGRUND="$(
    set -o pipefail
    tar -tzf "$UPLOADS_ARCHIV" 2>/dev/null | awk '
      grund == "" && $0 != "" {
        if ($0 != "uploads" && substr($0, 1, 8) != "uploads/")
          grund = "enthält \047" $0 "\047 — erlaubt ist nur uploads/."
        else if (index("/" $0 "/", "/../") > 0)
          grund = "enthält \047" $0 "\047 — ein Pfadglied \047..\047 führt aus uploads/ heraus."
      }
      END { if (grund != "") { print grund; exit 3 } }
    '
  )"
  NAMENSSTATUS=$?
  case "$NAMENSSTATUS" in
    0) ;;
    3) ARCHIV_ABBRUCH "$UPLOADS_ARCHIV $NAMENSGRUND" ;;
    *) ARCHIV_ABBRUCH "$UPLOADS_ARCHIV ist nicht lesbar." ;;
  esac

  # ── TYPEN, BEVOR AUSGEPACKT WIRD ────────────────────────────────────────
  #
  # Diese Prüfung stand hier schon einmal und ist beim Umbau auf den
  # Baum-Rundgang herausgeflogen — mit der Begründung, der Rundgang decke sie
  # ab. Das war falsch, und der Befund benennt genau warum: Ein Rundgang NACH
  # dem Auspacken kann Schaden WÄHRENDDESSEN nicht verhindern.
  #
  # Der Angriff dazu ist zwei Mitglieder lang:
  #
  #     uploads/p         -> ../..        (Symlink)
  #     uploads/p/app.db                  (Datei)
  #
  # Beide Namen liegen unter `uploads/` und tragen kein `..`-Glied, kommen
  # also durch das Namensgate. tar legt erst den Link an und schriebe die
  # Datei dann durch ihn hindurch — auf `$DATA_DIR/app.db`, lange bevor
  # irgendein Rundgang läuft.
  #
  # Nachgemessen weist GNU tar das ab („Cannot open: Not a directory", Exit 2,
  # app.db unberührt). Aber das ist tars Härtung, nicht unsere — dieselbe
  # Feststellung wie beim Namens-Traversal. Welche tar-Fassung auf dem Server
  # liegt, ist keine Zusage, die dieses Repository geben kann.
  #
  # Also: KEIN Link-Mitglied, Punkt. Dann gibt es auch kein Linkziel zu
  # prüfen.
  #
  # Der Vertrag selbst steht seit Panel-Runde 6 in deploy/archiv-typen.sh und
  # wird auch von deploy/backup.sh gequellt. Vorher stand er NUR hier — mit
  # dem Ergebnis, dass das Backup anstandslos Archive erzeugte und als Erfolg
  # verbuchte, die genau diese Prüfung nie passiert hätten. Die Rotation hing
  # an jenem grünen Lauf und löschte die letzten einspielbaren Archive weg.
  if ! GRUND="$(archiv_typen_ok "$UPLOADS_ARCHIV")"; then
    ARCHIV_ABBRUCH "$UPLOADS_ARCHIV $GRUND"
  fi

  # ── PASST ES ÜBERHAUPT AUF DIE PLATTE? ──────────────────────────────────
  #
  # Ausgepackt wird in eine Nebenablage UNTER $DATA_DIR — also auf dasselbe
  # Dateisystem, auf dem die laufende Datenbank schreibt. Ein Archiv, dessen
  # Inhalt größer ist als der freie Platz, füllt beim Auspacken die Platte,
  # und SQLite läuft in ENOSPC, bevor der Dienst überhaupt gestoppt wird.
  #
  # Gefragt wird, was das Archiv ANKÜNDIGT (Spalte 3 von `tar -tvzf`, in
  # Bytes), gegen den freien Platz mit einem Viertel Luft.
  #
  # Reichweite, ehrlich: Ein Kopf kann lügen. Tut er das, greift die Grenze
  # nicht — dann scheitert `tar` am vollen Dateisystem, ARCHIV_ABBRUCH räumt
  # die Nebenablage weg und gibt den Platz zurück, und eingespielt ist nichts.
  # Diese Prüfung nimmt also dem EHRLICH angekündigten Fall den Schaden; den
  # unehrlichen fängt erst das Aufräumen. Das ist weniger, als es aussieht,
  # und deshalb steht es hier statt in einer Zusage.
  # ── GERECHNET WIRD IN BLÖCKEN UND INODES, NICHT IN NUTZBYTES (Runde 10) ──
  #
  # Die erste Fassung summierte die angekündigten Nutzbytes. Eine Datei belegt
  # aber immer einen ganzen Block, und jede belegt einen Inode. Gemessen:
  #
  #     3000 Dateien à 1 Byte
  #     angekündigt:      3 000 Byte
  #     belegt:      12 365 824 Byte   (Faktor 4121)
  #     Archivgröße:     38 385 Byte
  #
  # Das Gate lag also um drei Größenordnungen daneben — wieder eine Zahl, die
  # die Sache nicht misst, sondern eine bequeme Nachbargröße.
  #
  # Aufgerundet wird je Mitglied auf die Blockgröße des Ziel-Dateisystems, und
  # die Anzahl der Mitglieder wird gegen die freien Inodes gehalten. `stat -f`
  # liefert beides für das Dateisystem, auf dem $DATA_DIR liegt.
  BLOCK="$(stat -f -c %s "$DATA_DIR" 2>/dev/null || echo 4096)"
  [[ "$BLOCK" -gt 0 ]] || BLOCK=4096
  # `pipefail` auch hier: Ein gescheitertes `tar` ergäbe sonst „0 Byte, 0
  # Mitglieder" — und das Gate ließe genau dann durch, wenn es nichts weiß.
  gebraucht="$(
    set -o pipefail
    tar -tvzf "$UPLOADS_ARCHIV" 2>/dev/null \
      | awk -v b="$BLOCK" '{n++; s += int(($3 + b - 1) / b) * b} END {print (s+0) " " (n+0)}'
  )" || ARCHIV_ABBRUCH "$UPLOADS_ARCHIV ist nicht lesbar."
  BEDARF="${gebraucht%% *}"
  MITGLIEDERZAHL="${gebraucht##* }"

  FREI_KB="$(df -Pk "$DATA_DIR" | awk 'NR==2{print $4+0}')"
  if [[ -n "$FREI_KB" && "$FREI_KB" -gt 0 ]]; then
    BUDGET=$(( FREI_KB * 1024 / 5 * 4 ))
    [[ "$BEDARF" -le "$BUDGET" ]] \
      || ARCHIV_ABBRUCH "$UPLOADS_ARCHIV braucht rund $BEDARF Byte an Blöcken; auf dem Dateisystem von $DATA_DIR sind nur $((FREI_KB * 1024)) Byte frei. Auspacken füllte die Platte, auf der die laufende Datenbank schreibt."
  fi
  FREIE_INODES="$(df -Pi "$DATA_DIR" 2>/dev/null | awk 'NR==2{print $4+0}')"
  if [[ -n "$FREIE_INODES" && "$FREIE_INODES" -gt 0 ]]; then
    [[ "$MITGLIEDERZAHL" -le $(( FREIE_INODES / 5 * 4 )) ]] \
      || ARCHIV_ABBRUCH "$UPLOADS_ARCHIV enthält $MITGLIEDERZAHL Mitglieder; auf dem Dateisystem von $DATA_DIR sind nur $FREIE_INODES Inodes frei. Auspacken erschöpfte sie, und die laufende Datenbank könnte nichts mehr anlegen."
  fi

  rm -rf "$NEBENABLAGE"
  mkdir -p "$NEBENABLAGE"
  tar -xzf "$UPLOADS_ARCHIV" -C "$NEBENABLAGE" \
    || ARCHIV_ABBRUCH "$UPLOADS_ARCHIV ließ sich nicht auspacken."

  # Genau ein Eintrag daneben, und der ist ein echtes Verzeichnis.
  NEBEN="$(find "$NEBENABLAGE" -mindepth 1 -maxdepth 1 ! -name uploads -print -quit)"
  [[ -z "$NEBEN" ]] \
    || ARCHIV_ABBRUCH "$UPLOADS_ARCHIV hat '$(basename "$NEBEN")' neben uploads/ angelegt."
  [[ -d "$NEBENABLAGE/uploads" && ! -L "$NEBENABLAGE/uploads" ]] \
    || ARCHIV_ABBRUCH "$UPLOADS_ARCHIV enthält kein Verzeichnis uploads/."

  # Und darin NUR Verzeichnisse und reguläre Dateien. `find` folgt Links nicht,
  # sieht sie also als das, was sie sind.
  #
  # Das ist KEINE Wiederholung der Typprüfung von oben, sondern ihre zweite
  # Hälfte: Die eine sagt, was das Archiv ANKÜNDIGT, diese, was WIRKLICH
  # dasteht. Gingen die beiden auseinander, fiele es genau hier auf.
  FREMD="$(find "$NEBENABLAGE" -mindepth 1 ! -type d ! -type f -print -quit)"
  [[ -z "$FREMD" ]] \
    || ARCHIV_ABBRUCH "$UPLOADS_ARCHIV hat '${FREMD#"$NEBENABLAGE/"}' angelegt — weder Verzeichnis noch reguläre Datei. Ein Link im Medienverzeichnis zeigt aus ihm heraus; die Auslieferung folgte ihm."
fi

# ── 2. Den JETZIGEN Stand sichern, solange er noch steht ──────────────────
#
# Über die Online-Backup-API und nicht per `cp`: Die Anwendung fährt SQLite im
# WAL-Modus, und eine `cp`-Kopie einer laufenden Datenbank enthält die zuletzt
# festgeschriebenen Zeilen nicht (nachgemessen in tests/rollback-wal.test.ts:
# app.db 4096 Byte, das WAL 70 KB). Das Netz wäre leer gewesen.
if [[ -f "$DATA_DIR/app.db" ]]; then
  # Das Netz wird nicht durch einen Link gespannt. Wäre `backups` ein
  # untergeschobener Link, landete die Sicherung des jetzigen Standes irgendwo
  # anders — und die Prüfungen darunter (`-s`, integrity_check) folgten ihm
  # brav mit und bestätigten sie dort.
  #
  # Ehrlich zur Reichweite: Der Befund nannte als Folge ein Leck über die
  # Medien-Auslieferung. Das trägt nicht — die Route verlangt
  # `<20 Hex>/w<Zahl>.webp`, und `pre-restore-….db` trifft das nie. Der
  # Wächter ist trotzdem richtig: Die Sicherung gehört dorthin, wo das Skript
  # sie hinlegt, und nirgendwo sonst hin.
  [[ ! -L "$DATA_DIR/backups" ]] \
    || { rm -f "$EINGEHEND"; fail "$DATA_DIR/backups ist ein symbolischer Link. \
Dorthin wird die Sicherung des jetzigen Standes nicht gelegt — nichts \
eingespielt, der Dienst läuft weiter."; }
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
  # Ausgepackt und geprüft ist längst — hier wird nur noch getauscht. Zwei
  # Gründe, und beide sind Zustände, die es sonst gäbe:
  #
  #   * Ein Auspacken, das in der Mitte abbricht, hinterließe einen halb
  #     ersetzten Medienbestand. Es ist deshalb oben passiert, wo ein
  #     Abbruch nichts kostet.
  #   * Dateien, die das Backup NICHT kennt, blieben beim Überlagern liegen.
  #     Der Stand danach wäre weder der gesicherte noch der vorige, sondern
  #     eine Mischung — eine Wiederherstellung, die nichts wiederherstellt.
  #
  # Der vorige Stand wird beiseitegelegt, nicht gelöscht: Die Medien sind das
  # Einzige, wofür dieses Skript kein eigenes Netz spannt.
  if [[ -d "$DATA_DIR/uploads" ]]; then
    rm -rf "$DATA_DIR/uploads.alt"
    mv "$DATA_DIR/uploads" "$DATA_DIR/uploads.alt" \
      || fail "Der bisherige Medienbestand ließ sich nicht beiseitelegen."
    log "Der bisherige Medienbestand liegt in $DATA_DIR/uploads.alt."
  fi
  mv "$NEBENABLAGE/uploads" "$DATA_DIR/uploads" \
    || fail "Der eingespielte Medienbestand ließ sich nicht an seinen Platz \
bringen. Er liegt in $NEBENABLAGE/uploads, der bisherige in \
$DATA_DIR/uploads.alt."
  rmdir "$NEBENABLAGE" 2>/dev/null || true
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
