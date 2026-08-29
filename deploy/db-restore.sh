#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Gemeinsamer, ATOMARER DB-Restore. Wird von deploy/rollback.sh (Ernstfall) UND
# von scripts/regime/restore-drill.sh (Übung, Mandat B-31) GEQUELLT.
#
# ── WARUM DIESE DATEI ÜBERHAUPT EXISTIERT ─────────────────────────────────
#
# Bis 08/2026 stand die Wiederherstellung nur in rollback.sh, und der Drill
# baute sich seinen eigenen Weg: ein `cp` in ein LEERES Verzeichnis. Damit
# bescheinigte er eine Fähigkeit, die er nie angesehen hatte — der Weg, den die
# Produktion wirklich geht (über eine LEBENDE Datenbank mit gefülltem WAL), war
# ein halbes Jahr lang katastrophal kaputt (B3: der Restore war ein stiller
# No-op), während der Drill Monat für Monat grün meldete.
#
# Ein Drill, der etwas anderes fährt als den Ernstfall, ist kein Drill. Deshalb
# gibt es den Ablauf jetzt genau EINMAL, und beide fahren ihn. Auseinanderlaufen
# ist damit nicht mehr eine Frage der Disziplin, sondern unmöglich.
#
# ── DIE DREI SCHRITTE ─────────────────────────────────────────────────────
#
# Die Anwendung fährt SQLite im WAL-Modus. Bleibt das `-wal` der ERSETZTEN
# Datenbank liegen, spielt SQLite es beim nächsten Öffnen über das eingespielte
# Backup — der Restore tut nichts und meldet Erfolg. Nachgemessen: nach hartem
# Abbruch liefert die Datenbank danach die ALTEN Zeilen statt der gesicherten.
#
# Und zwischen den Schritten darf es diesen Zustand nicht geben: Wer den Lauf
# nach dem Kopieren, aber vor dem Entfernen abbricht (Strom, Kill, volle
# Platte), hinterlässt neues app.db neben altem WAL — genau die Kombination.
#
# Deshalb in drei Schritten, von denen KEIN Zwischenstand gefährlich ist:
#   1. In eine Nebendatei kopieren — app.db bleibt unangetastet, ein halb
#      geschriebenes Backup landet nie auf der echten Datenbank.
#   2. Erst dann WAL und SHM entfernen. Bricht es hier ab, bleibt das ALTE
#      app.db ohne WAL zurück: eine in sich STIMMIGE Datenbank.
#
#      Ehrlich gesagt ist das nicht der letzte festgeschriebene Stand — im
#      WAL-Modus liegen festgeschriebene Transaktionen bis zum nächsten
#      Checkpoint im `-wal`, und die sind mit ihm weg. (Der Satz stand hier
#      falsch, bis die Gegenprüfung 08/2026 ihn aufgriff.) Die umgekehrte
#      Reihenfolge wäre trotzdem SCHLECHTER, nicht besser: Sie hinterließe
#      neues app.db neben altem WAL, SQLite spielte das WAL darüber, und der
#      Restore wäre ein stiller No-op — ein falscher Stand, der sich für
#      richtig ausgibt. Ein in sich stimmiger älterer Stand ist erkennbar.
#
#      Das Netz gegen diesen Verlust ist deshalb nicht die Reihenfolge,
#      sondern die Sicherung DAVOR: deploy/rollback.sh und deploy/restore.sh
#      ziehen den jetzigen Stand vorher über die Online-Backup-API (die das
#      WAL mitliest) und prüfen sie mit integrity_check, bevor hier etwas
#      angefasst wird.
#   3. Umbenennen. `mv` innerhalb desselben Dateisystems ist atomar; einen
#      Zwischenstand "neu und alt zugleich" gibt es nicht.
#
# Aufruf:  db_einspielen <backup-datei> <daten-verzeichnis>
# ---------------------------------------------------------------------------

# Der Aufrufer bringt sein eigenes `fail` mit (rollback.sh protokolliert mit
# Präfix, der Drill schreibt zusätzlich seinen Beleg). Fehlt es, gibt es hier
# eines — ein stiller Weiterlauf nach einem gescheiterten Restore wäre das
# Gegenteil dessen, was diese Datei leistet.
if ! declare -F fail >/dev/null 2>&1; then
  fail(){ echo "[db-restore] FEHLER: $*" >&2; exit 1; }
fi

db_einspielen(){
  local backup="$1" daten="$2"
  [[ -n "$backup" && -n "$daten" ]] \
    || fail "db_einspielen braucht Backup-Datei und Daten-Verzeichnis."
  [[ -f "$backup" ]] || fail "Backup $backup existiert nicht."
  [[ -d "$daten" ]] || fail "Daten-Verzeichnis $daten existiert nicht."

  # ── DER MODUS GEHÖRT DER DATENBANK, NICHT DER SICHERUNG (Panel-Runde 7) ──
  #
  # `cp` legt die neue Datei mit dem Modus der QUELLE an. Eine Sicherung liegt
  # regelmäßig als 0644 da (sie entsteht im Container, unter dessen umask);
  # die laufende Datenbank ist 0600. Gemessen:
  #
  #     vorher   app.db 600, backup 644
  #     nachher  app.db 644
  #
  # Ein Restore hätte die Datenbank also jedes Mal ein Stück weiter geöffnet —
  # still, und ausgerechnet im Ernstfall. Der Modus des laufenden Standes wird
  # deshalb vorher abgelesen und danach wieder aufgesetzt. Gibt es noch keine
  # Datenbank (erste Wiederherstellung auf leerem Verzeichnis), gilt 0600:
  # enger als das, was `cp` liefern würde, und für eine Datenbank das Richtige.
  local modus="0600"
  [[ -f "$daten/app.db" ]] && modus="$(stat -c %a "$daten/app.db" 2>/dev/null || echo 0600)"

  rm -f "$daten/app.db.neu"
  cp "$backup" "$daten/app.db.neu" \
    || fail "Einspielen von $backup fehlgeschlagen — app.db ist UNVERÄNDERT. \
Die Sicherung des vorigen Standes liegt in $daten/backups/."
  # VOR dem Umbenennen: Sonst stünde die Datenbank zwischen `mv` und `chmod`
  # offen da, und genau dieses Fenster ist der Befund.
  chmod "$modus" "$daten/app.db.neu" \
    || fail "Modus $modus ließ sich nicht setzen — app.db ist UNVERÄNDERT."
  rm -f "$daten/app.db-wal" "$daten/app.db-shm"
  mv -f "$daten/app.db.neu" "$daten/app.db" \
    || fail "Umbenennen der eingespielten Datenbank fehlgeschlagen — \
$daten/app.db.neu liegt bereit, app.db trägt noch den vorigen Stand."
}
