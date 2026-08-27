#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Der Typ-Vertrag für ein Medien-Archiv — eine Aussage, an einer Stelle.
#
# Gequellt von deploy/backup.sh (das ein Archiv ERZEUGT) und deploy/restore.sh
# (das eines EINSPIELT). Beide müssen dieselbe Antwort geben, sonst entsteht
# genau der Zustand, gegen den dieser Vertrag geschrieben ist.
#
# ── WARUM ER EXISTIERT (Panel-Runde 6) ─────────────────────────────────────
#
# Der Vertrag stand nur im Restore. Das Backup packte ein, was ihm vorgelegt
# wurde, und meldete Erfolg. Nachgemessen mit einem Symlink in uploads/:
#
#     tar -czf ... uploads    Exit 0   ->  UPLOADS_OK=1, Lauf gilt als ERFOLG
#     Typgate im Restore      ABBRUCH  ->  dieses Archiv wird NIE eingespielt
#
# Der Lauf war also grün, das Archiv wertlos — und weil die Rotation an genau
# diesem grünen Lauf hängt, löschte sie danach die letzten Archive weg, die
# sich noch einspielen ließen. Ein Medienverzeichnis, in das je ein Link
# gerät, hätte damit still jede Wiederherstellbarkeit verloren.
#
# Dieselbe Fehlerklasse wie B16: eine Kontrolle, die grün ist, ohne das zu
# prüfen, was sie zu prüfen vorgibt. Wer sichert, muss sich an denselben
# Vertrag halten wie der, der einspielt — sonst sichert er Unbrauchbares.
#
# ── WAS GEPRÜFT WIRD ───────────────────────────────────────────────────────
#
# Nur Verzeichnisse und reguläre Dateien. KEIN Link-Mitglied, Punkt — dann
# gibt es auch kein Linkziel zu prüfen. Ein Symlink trägt einen einwandfreien
# Namen und ist trotzdem ein Loch: `uploads/leak -> ../app.db` packt tar
# anstandslos aus, und die Auslieferungsroute liest daraufhin die Datenbank
# über HTTP.
#
# Der Typ steht in der ERSTEN Spalte von `tar -tvzf`; geprüft wird nur dieses
# eine Zeichen, damit Namen mit Leerzeichen oder " -> " nichts zerlegen.
#
# Reichweite, ehrlich: Das ist, was das Archiv ANKÜNDIGT. Was nach dem
# Auspacken WIRKLICH dasteht, prüft restore.sh zusätzlich mit einem Rundgang
# durch den Baum. Beide Prüfungen tun, was die andere nicht kann — die eine
# verhindert Schaden WÄHREND des Auspackens, die andere sieht das Ergebnis.
# ---------------------------------------------------------------------------

# archiv_typen_ok <archiv>
#   Rückgabe 0: jedes Mitglied ist Verzeichnis oder reguläre Datei.
#   Rückgabe 1: der Grund steht auf stdout (zum Anhängen an eine Fehlermeldung).
archiv_typen_ok(){
  local zeilen z
  zeilen="$(tar -tvzf "$1" 2>/dev/null)" \
    || { echo "lässt sich nicht auflisten."; return 1; }
  while IFS= read -r z; do
    [[ -z "$z" ]] && continue
    case "${z:0:1}" in
      d|-) ;;
      l) echo "enthält einen SYMLINK. Ein Link im Archiv kann beim Auspacken aus dem Zielverzeichnis herausführen — die Datei danach schriebe tar durch ihn hindurch."
         return 1 ;;
      h) echo "enthält einen HARDLINK."
         return 1 ;;
      *) echo "enthält ein Mitglied, das weder Verzeichnis noch reguläre Datei ist ('${z:0:1}')."
         return 1 ;;
    esac
  done <<< "$zeilen"
  return 0
}
