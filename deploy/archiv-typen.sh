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
  # `TAR_OPTIONS` aus der Umgebung neutralisieren: GNU tar nimmt von dort jede
  # Option an, und ein `--dereference` machte aus einem Symlink still eine
  # reguläre Datei mit fremdem Inhalt — dieser Vertrag wäre zufrieden und
  # trotzdem wertlos. Lokal, damit der Aufrufer nichts davon merkt.
  local TAR_OPTIONS=
  local ausgabe status

  # ── EIN LESEVORGANG, UND SEIN STATUS ZÄHLT (Panel-Runde 11) ─────────────
  #
  # Die vorige Fassung las ZWEIMAL: erst `tar -tzf` nach /dev/null als
  # Lesbarkeitsprüfung, dann `tar -tvzf` in einer Prozess-Ersetzung für die
  # Typen. Deren Exit-Status ging dabei verloren. Scheitert der zweite Lauf,
  # liefert er keine Zeilen, die Schleife läuft nie — und die Funktion
  # antwortet „Typen in Ordnung". Gemessen, mit einem Archiv, das einen
  # Symlink ENTHÄLT:
  #
  #     tar -tzf  gelingt  /  tar -tvzf scheitert
  #     -> archiv_typen_ok: „Typen in Ordnung"   (fail-open)
  #
  # Das ist dieselbe Lehre wie aus Runde 4 — die Liste ist nicht der Baum —,
  # nur diesmal auf meine eigenen zwei Lesevorgänge angewandt: Was der erste
  # Lauf festgestellt hat, muss für den zweiten nicht mehr gelten.
  #
  # Deshalb jetzt EIN Lauf. Das Urteil kommt über den Exit-Status zurück und
  # nicht über eine Variable, die eine früh abgebrochene Schleife nie gesetzt
  # hat. `pipefail` sorgt dafür, dass ein gescheitertes `tar` durchschlägt;
  # `awk` läuft bis zum Ende durch (kein vorzeitiges `exit`), damit `tar` kein
  # SIGPIPE bekommt und sein Status die Lesbarkeit und nur sie bezeichnet.
  #
  #   Status 0  — jedes Mitglied ist Verzeichnis oder reguläre Datei
  #   Status 3  — Typverstoß; die Begründung steht auf stdout
  #   sonst     — tar konnte das Archiv nicht lesen
  ausgabe="$(
    set -o pipefail
    tar -tvzf "$1" 2>/dev/null | awk '
      grund == "" {
        c = substr($0, 1, 1)
        if (c == "l")
          grund = "enthält einen SYMLINK. Ein Link im Archiv kann beim Auspacken aus dem Zielverzeichnis herausführen — die Datei danach schriebe tar durch ihn hindurch."
        else if (c == "h")
          grund = "enthält einen HARDLINK."
        else if (c != "d" && c != "-")
          grund = "enthält ein Mitglied, das weder Verzeichnis noch reguläre Datei ist (\047" c "\047)."
      }
      END { if (grund != "") { print grund; exit 3 } }
    '
  )"
  status=$?

  case "$status" in
    0) return 0 ;;
    3) echo "$ausgabe"; return 1 ;;
    *) echo "lässt sich nicht auflisten."; return 1 ;;
  esac
}
