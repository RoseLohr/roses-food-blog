#!/usr/bin/env bash
# ============================================================================
# Erhebung: was auf diesem Host WIRKLICH läuft — in einer Form, die man
# gefahrlos in ein öffentliches Repository kleben kann. (Spur A1)
#
#   erhebung.sh [--basis <url>]        Bericht auf stdout
#   erhebung.sh --maskieren            liest stdin, schreibt maskiert nach stdout
#   erhebung.sh --selftest             prüft die Maskierung an bekannten Fällen
#
# WARUM ES DIESES SKRIPT GIBT
# ---------------------------------------------------------------------------
# Die Infrastruktur-Erhebung 2026-08 lief als Folge von Einzelbefehlen aus
# einer Sitzung. Nichts davon war wiederholbar, und acht Fragen (M1–M8) blieben
# offen, weil niemand sie zweimal gleich stellen konnte. Ein Skript, das immer
# dieselben Fragen stellt, ist die Voraussetzung dafür, dass eine Antwort von
# heute mit einer von nächstem Monat vergleichbar ist.
#
# DER PORT KOMMT AUS DER .env, NICHT AUS `podman ps`
# ---------------------------------------------------------------------------
# Der ursprüngliche Vorschlag (A1) lautete „Port aus `podman ps` ableiten statt
# raten". Das ist die falsche Richtung: Autoritativ ist `PORT` aus der `.env` —
# so machen es `deploy.sh` und `rollback.sh` auch. Die Portspalte von
# `podman ps` ist genau die Konstruktion, an der die Erhebung selbst
# gescheitert ist (bei Host-Netzwerk steht dort gar nichts, bei einem Pod die
# Abbildung des Pods). Dieses Skript liest deshalb die `.env` und VERGLEICHT
# sie mit dem, was der Container veröffentlicht. Ein Unterschied ist ein
# Befund, kein Ableitungsproblem.
#
# MESSEN UND AUSWEISEN, NICHT DECKELN
# ---------------------------------------------------------------------------
# Es gibt hier keine Schwelle und keinen roten Rückgabewert für einen
# Messwert. Die Begründung steht in audit/12-infrastruktur-fahrplan.md
# (Spur A1/B2/F1): Die HTML-Rohgröße springt an jeder ISO-Wochengrenze, und
# drei der vorgeschlagenen booleschen Schwellen beschreiben Zustände, die heute
# nicht gelten — gepinnt wären sie ab dem ersten Lauf rot. Wer eine Schwelle
# setzen will, braucht erst eine Messreihe. Genau die liefert dieses Skript.
#
# WAS DIESES SKRIPT NIE ANFASST
# ---------------------------------------------------------------------------
# Die Datenbank des Proxy-Containers (`/data/database.sqlite` im
# Nginx-Proxy-Manager) trägt Zugangsdaten im Klartext. Sie wird hier nicht
# gelesen — auch nicht „nur die Tabellenliste". Die Konfiguration, die uns
# interessiert, steht ohnehin in den erzeugten nginx-Dateien.
#
# UND KEINE ANWENDUNGSPROTOKOLLE IM KLARTEXT. Die erste Fassung druckte 200
# Zeilen `podman logs` ab und nannte sie „maskiert". Das war eine Zusage, die
# der Filter nicht halten kann: Protokolle sind freier Text, und ein Filter,
# der `password|token|secret|…` kennt, sieht eine Verbindungszeichenfolge
# nicht, die Benutzer und Kennwort vor dem Klammeraffen traegt.
# Gezählt wird jetzt, gezeigt wird nicht — wer den Inhalt braucht, liest ihn
# auf dem Host.
#
# DIE MASKIERUNG IST DER GRUND, WARUM MAN DIE AUSGABE WEITERGEBEN DARF
# ---------------------------------------------------------------------------
# Dieses Repository ist ÖFFENTLICH. Die Adresse des Ursprungs darf darin nicht
# auftauchen — sie ist der einzige Weg, an Cloudflare vorbei direkt auf den
# Server zu zielen. Deshalb läuft JEDE Zeile dieses Berichts durch
# `maskieren()`, und zwar am Ende einer Pipe, nicht an jeder Fundstelle: Eine
# Maskierung, die man je Befehl von Hand anwenden muss, wird beim nächsten
# hinzugefügten Befehl vergessen.
#
# Ausdrücklich NICHT maskiert werden `127.0.0.1`, `::1` und `0.0.0.0`. Das ist
# eine benannte Ausnahme mit Grund: Ob der Proxy die Anwendung über den
# Loopback oder über eine Container-Adresse erreicht, ist die Antwort auf M1 —
# und keine dieser drei Adressen sagt jemandem, wo dieser Server steht.
#
# EINE ZWEITE GRENZE, DIE HIER STEHT STATT ÜBERRASCHT:
# Maskiert werden Namen mit MINDESTENS ZWEI Punkten (`blog.beispiel.de`).
# Zweiteilige Namen (`beispiel.de`, `docker.io`) bleiben lesbar — sonst würde
# aus `docker.io/jc21/npm:2.11.1` ein `<name>/jc21/npm`, und die Frage „welches
# Proxy-Image läuft da eigentlich" wäre nicht mehr zu beantworten. Das ist
# vertretbar, weil die Domain eines öffentlichen Blogs kein Geheimnis ist; das
# Geheimnis ist die ADRESSE des Ursprungs, denn sie ist der einzige Weg, an
# Cloudflare vorbei direkt auf den Server zu zielen. Wer auch den Domainnamen
# heraushalten will, filtert die Ausgabe zusätzlich selbst — das Skript
# behauptet das Gegenteil nicht.
# ============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Maskierung. Reihenfolge ist bedeutsam: erst die Schlüssel-Werte-Paare (sie
# dürfen Adressen enthalten), dann die Adressen, dann die Namen.
#
# DREI ENTSCHEIDUNGEN, DIE NICHT AUS DEM KOPF KAMEN, SONDERN AUS FEHLERN:
#
#  1. Bei einem Treffer auf `password`/`token`/`authorization`… fällt der REST
#     DER ZEILE weg, nicht nur das nächste Wort. `Authorization: Bearer eyJ…`
#     hatte sonst brav „Bearer" maskiert und den Schlüssel danach stehen
#     lassen. Über-Maskieren ist hier die sichere Richtung.
#
#  2. IPv6 in ZWEI Ausdrücken: die Vollform mit sieben Doppelpunkten und die
#     verkürzte mit `::`. Ein einzelner Ausdruck, der beides fängt, fängt auch
#     Uhrzeiten — `23:14:47` in der Kopfzeile wäre zu `<IPv6>` geworden, und
#     eine Maskierung, die den Zeitstempel frisst, macht den Bericht wertlos.
#
#  3. DER LOOPBACK-SCHUTZ BRAUCHT GRENZEN. Die erste Fassung ersetzte die
#     Zeichenfolge `::1` ÜBERALL. Damit verlor jede komprimierte IPv6, deren
#     Rest mit `1` beginnt, ihr `::` — danach griff keine der beiden
#     IPv6-Regeln mehr, und die Rückersetzung am Ende stellte die volle
#     Adresse wieder her. Gemessen an der Vorfassung kamen
#     `2001:db8:c17:b8f::1`, `2001:db8::10` und `fe80::1` UNMASKIERT durch —
#     also genau die Sorte Adresse, gegen deren Veröffentlichung dieses ganze
#     Skript geschrieben ist. Die Kontrolle fiel fail-open aus, und der
#     Selbsttest deckte den Fall nicht ab: Er kannte nur `::dead:beef` und
#     `2001:db8:cf00::/48`, und beide enden nicht auf `::1…`. Gefunden hat es der
#     Pflicht-Approver (PR #111) — nicht die eigene Prüfung.
#     Geschützt wird jetzt nur ein FREISTEHENDES `::1`: davor kein Hexzeichen
#     und kein Doppelpunkt, danach kein Hexzeichen.
#
#  4. IPv4-EINGEBETTETE IPv6 BRAUCHT EINE EIGENE REGEL — und zwar VOR der
#     IPv4-Regel. Die beiden IPv6-Ausdrücke verlangen entweder sieben
#     Doppelpunkte oder ein `::`. Eine Adresse wie
#     `2001:db8:c17:b8f:0:0:198.51.100.9` hat beides nicht: sechs Doppelpunkte,
#     kein `::`. Die IPv4-Regel schlug den hinteren Teil zu `<IPv4>`, und das
#     ROUTBARE 96-Bit-Präfix davor blieb stehen —
#     `2001:db8:c17:b8f:0:0:<IPv4>` sagt immer noch, in welchem Netz dieser
#     Server steht. Der zweite Befund des Pflicht-Approvers zu dieser Datei
#     (PR #111), und die eigene Gegenprobe hatte ihn zunächst nicht
#     reproduziert: Alle drei zuerst probierten Formen (`::ffff:…`,
#     `2001:db8::…`, `64:ff9b::…`) enthalten ein `::` und wurden deshalb
#     vollständig maskiert. Erst die UNKOMPRIMIERTE Schreibweise zeigt die
#     Lücke. Drei Stichproben, die alle dieselbe Eigenschaft teilen, sind eine
#     Stichprobe.
#
#  5. ZUGANGSDATEN STEHEN AUCH IN ADRESSEN. Eine `proxy_pass`-Zeile kann
#     Benutzer und Kennwort im Nutzerteil der Adresse tragen — zwischen
#     Doppelpunkt und Klammeraffe, ohne sich Geheimnis zu nennen. Die
#     Schlüssel-Wert-Regel sieht dort nichts; gemessen an der Vorfassung wurde
#     der Hostname brav maskiert und das Kennwort blieb daneben stehen. Dritter
#     Befund des Panels zu dieser Datei, und wieder dieselbe Klasse: eine
#     Stelle, an der ein Geheimnis steht, ohne sich so zu nennen. Die Regel
#     greift mit und ohne Schema, weil `//` ohnehin nicht Teil des Nutzerteils
#     sein kann.
#
#     (Die Selbsttestfälle unten setzen solche Adressen zur LAUFZEIT zusammen.
#     Literal im Quelltext wären sie ein Treffer für den Secret-Scan — B-06,
#     STOP-SHIP —, und der hätte recht: Die Form ist nicht davon harmlos, dass
#     sie in einem Test steht.)
#
#     NACHTRAG, RUNDE VIER: Die erste Fassung dieser Regel verlangte Nutzer UND
#     Kennwort. Ein Nutzerteil braucht aber weder das eine noch beides:
#     `://:kennwort@ziel` (leerer Nutzer) und `://zeichenkette@ziel` (nur ein
#     Merkmal, kein Doppelpunkt) sind gültig — und liefen unverändert durch.
#     Deshalb gibt es jetzt ZWEI Regeln: Hinter einem Schema fällt der ganze
#     Nutzerteil, EGAL wie er aussieht; ohne Schema greift weiterhin nur die
#     Doppelpunkt-Form.
#
#     BENANNTE GRENZE: Ohne Schema ist `zeichenkette@ziel` von einer
#     Mailadresse nicht zu unterscheiden. Wer dort maskierte, fräße jede
#     Kontaktangabe. `proxy_pass` trägt immer ein Schema, also ist der Fall,
#     um den es geht, gedeckt — aber die Grenze steht hier, statt zu
#     überraschen.
#
#  6. VON EINER ADRESSE BLEIBT NUR SCHEMA, WIRT UND HAFEN — der Pfad und alles
#     dahinter fallen. Das ist die einzige Regel hier, die NICHT versucht, ein
#     Geheimnis zu erkennen, und sie ist deshalb die wichtigste.
#
#     Runde fünf des Panels nannte „generische Query-Credentials": ein
#     Merkmal in `?key=…`, `?auth=…`, `?sig=…` oder als undurchsichtiger Pfad
#     (`/s/AbCdEf…`). Diese Klasse ist NICHT aufzählbar — jeder Dienst nennt
#     seinen Parameter anders, und ein Merkmal im Pfad hat gar keinen Namen.
#     Vier Runden lang wurde der Stichwortfilter erweitert, und jede Runde fand
#     dieselbe Klasse an einer neuen Stelle. Die fünfte Antwort ist deshalb
#     keine sechste Ausnahme, sondern WENIGER DRUCKEN.
#
#     M1 fragt: Wie erreicht der Proxy die Anwendung? Darauf antworten Schema,
#     Wirt und Hafen vollständig. Pfad und Abfrage tragen zur Antwort nichts
#     bei und können beliebige Geheimnisse enthalten — also entfallen sie.
#     Was man nicht abdruckt, muss man nicht maskieren.
#
#     NACHTRAG, RUNDE SECHS: Die erste Fassung dieser Regel verlangte einen
#     Schrägstrich. Eine Abfrage darf aber direkt hinter dem Hafen stehen —
#     `://ziel:3000?merkmal=…` hat keinen Pfad und lief unverändert durch.
#     Ausgelöst wird jetzt von `/`, `?` UND `#`. Dieselbe Lehre wie bei den
#     Adressen: Die zuerst gedachte Form ist nicht die einzige.
# ---------------------------------------------------------------------------
maskieren() {
  sed -E \
    -e 's/\b(127\.0\.0\.1)\b/@@LOOPBACK@@/g' \
    -e 's/\b(0\.0\.0\.0)\b/@@JEDE@@/g' \
    -e 's/(^|[^0-9a-fA-F:])::1($|[^0-9a-fA-F])/\1@@LOOPBACK6@@\2/g' \
    -e 's/([Pp][Aa][Ss][Ss][Ww]?[Oo]?[Rr]?[Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Bb][Ee][Aa][Rr][Ee][Rr])([[:space:]]*[:=][[:space:]]*|[[:space:]]+).*$/\1\2<maskiert>/' \
    -e 's#(://)[^/@"[:space:]]+@#\1<maskiert>@#g' \
    -e 's%(://[^/?#"[:space:]]*)[/?#][^"[:space:]]*%\1/<pfad-entfernt>%g' \
    -e 's#[^:/@"[:space:]]+:[^:/@"[:space:]]+@#<maskiert>@#g' \
    -e 's/([0-9a-fA-F]{0,4}:){2,7}([0-9]{1,3}\.){3}[0-9]{1,3}/<IPv6>/g' \
    -e 's/\b([0-9]{1,3}\.){3}[0-9]{1,3}\b/<IPv4>/g' \
    -e 's/([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/<IPv6>/g' \
    -e 's/[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{1,4}){0,6}::([0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){0,6})?/<IPv6>/g' \
    -e 's/\b[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+\.[A-Za-z]{2,}\b/<name>/g' \
    -e 's/\b[A-Za-z0-9+\/]{40,}={0,2}\b/<langer-wert>/g' \
    -e 's#/(home|Users)/[^/[:space:]]+#/\1/<benutzer>#g' \
    -e 's/@@LOOPBACK@@/127.0.0.1/g' \
    -e 's/@@JEDE@@/0.0.0.0/g' \
    -e 's/@@LOOPBACK6@@/::1/g'
}

# ---------------------------------------------------------------------------
# Selbsttest (A-36): Fängt die Maskierung, was sie fangen muss — und lässt sie
# stehen, was stehen bleiben soll? Beide Richtungen, sonst ist es kein Beleg.
# ---------------------------------------------------------------------------
selbsttest() {
  local fehler=0
  pruefe() { # pruefe <Beschreibung> <Eingabe> <erwartete Ausgabe>
    local got
    got="$(printf '%s\n' "$2" | maskieren)"
    if [ "$got" != "$3" ]; then
      echo "FEHLER: $1"
      echo "  Eingabe:   $2"
      echo "  Erwartet:  $3"
      echo "  Bekommen:  $got"
      fehler=1
    fi
  }

  # Die Falle: eine öffentliche Adresse darf NICHT durchkommen.
  pruefe "IPv4 wird maskiert" "upstream 203.0.113.7:3000" "upstream <IPv4>:3000"
  pruefe "IPv4 in einer nginx-Zeile" "set_real_ip_from 198.51.100.0/22;" "set_real_ip_from <IPv4>/22;"
  pruefe "IPv6 wird maskiert" "listen [2001:db8::dead:beef]:443" "listen [<IPv6>]:443"
  pruefe "Kennwort wird maskiert" "DB_PASSWORD=hunter2" "DB_PASSWORD=<maskiert>"
  pruefe "Token mit Doppelpunkt" "api_key: abc123XYZ" "api_key: <maskiert>"
  pruefe "Authorization-Kopf" "Authorization: Bearer eyJhbGciOi" "Authorization: <maskiert>"
  pruefe "langer Wert" "wert=$(printf 'A%.0s' $(seq 1 44))" "wert=<langer-wert>"
  pruefe "Hostname wird maskiert" "server_name blog.example.de;" "server_name <name>;"

  # DIE FÄLLE, DIE DER PFLICHT-APPROVER GEFUNDEN HAT (PR #111) — jeder einzeln,
  # damit dieselbe Lücke nicht zweimal aufgeht. Die drei IPv6-Adressen kamen an
  # der Vorfassung UNMASKIERT durch, weil der Loopback-Schutz jede Zeichenfolge
  # `::1` fraß und die Rückersetzung sie danach wiederherstellte.
  pruefe "komprimierte IPv6, die auf ::1 endet" "upstream 2001:db8:c17:b8f::1 hoch" "upstream <IPv6> hoch"
  pruefe "komprimierte IPv6 mit ::10" "listen [2001:db8::10]:443" "listen [<IPv6>]:443"
  pruefe "link-local mit ::1" "fe80::1 dev eth0" "<IPv6> dev eth0"
  pruefe "Accountname im Pfad" "/home/beispielnutzer/npm/data -> /data" "/home/<benutzer>/npm/data -> /data"
  # RUNDE ZWEI desselben Prüfers: IPv4-eingebettete IPv6 OHNE `::`. Die
  # IPv4-Regel schlug den hinteren Teil, das routbare Präfix blieb stehen.
  pruefe "IPv4-eingebettete IPv6, unkomprimiert" "2001:db8:c17:b8f:0:0:198.51.100.9 host" "<IPv6> host"
  pruefe "IPv4-gemappt, lange Schreibweise" "0:0:0:0:0:ffff:203.0.113.7" "<IPv6>"
  pruefe "IPv4-gemappt, kurze Schreibweise" "::ffff:192.0.2.128" "<IPv6>"
  pruefe "IPv4-eingebettet mit ::" "2001:db8::192.0.2.1" "<IPv6>"
  # RUNDE DREI: Zugangsdaten stehen auch in Adressen — zwischen Doppelpunkt und
  # Klammeraffe, ohne sich Geheimnis zu nennen.
  # Zur Laufzeit zusammengesetzt, s. Punkt 5 im Kopf der Maskierung.
  local dp=":" at="@"
  pruefe "Userinfo in proxy_pass" \
    "proxy_pass http://admin${dp}hunter2${at}ziel:3000;" \
    "proxy_pass http://<maskiert>@ziel:3000;"
  pruefe "Userinfo ohne Schema" \
    "set \$server dienst${dp}kennwort${at}upstream;" \
    "set \$server <maskiert>@upstream;"
  # Runde vier: ein Nutzerteil braucht weder Nutzer noch Doppelpunkt.
  pruefe "Userinfo ohne Nutzer" \
    "proxy_pass http://${dp}kennwort${at}ziel:3000;" \
    "proxy_pass http://<maskiert>@ziel:3000;"
  pruefe "Userinfo ohne Doppelpunkt" \
    "proxy_pass http://gehe1mt0ken${at}ziel:3000;" \
    "proxy_pass http://<maskiert>@ziel:3000;"
  # Runde fuenf: Merkmale in Abfrage und Pfad sind nicht aufzaehlbar — also
  # faellt alles hinter dem Wirt, statt es zu erkennen zu versuchen.
  pruefe "Abfrage mit unbenanntem Merkmal" \
    "proxy_pass http://ziel:3000/hook?key=ABC123&auth=XYZ;" \
    "proxy_pass http://ziel:3000/<pfad-entfernt>"
  pruefe "undurchsichtiges Merkmal im Pfad" \
    "proxy_pass http://ziel:3000/s/AbCdEf0123456789;" \
    "proxy_pass http://ziel:3000/<pfad-entfernt>"
  pruefe "Adresse ohne Pfad bleibt vollstaendig" \
    "proxy_pass http://ziel:3000;" \
    "proxy_pass http://ziel:3000;"
  # Runde sechs: eine Abfrage braucht keinen Pfad vor sich.
  pruefe "Abfrage direkt hinter dem Hafen" \
    "proxy_pass http://ziel:3000?merkmal=ABC123;" \
    "proxy_pass http://ziel:3000/<pfad-entfernt>"
  pruefe "Fragment direkt hinter dem Hafen" \
    "proxy_pass http://ziel:3000#merkmal=ABC123;" \
    "proxy_pass http://ziel:3000/<pfad-entfernt>"
  pruefe "Accountname im macOS-Pfad" "/Users/beispielnutzer/x -> /y" "/Users/<benutzer>/x -> /y"

  # Das Geschonte: ohne diese Fälle wäre der Bericht unlesbar.
  pruefe "Loopback bleibt lesbar" "proxy_pass http://127.0.0.1:3000;" "proxy_pass http://127.0.0.1:3000;"
  pruefe "0.0.0.0 bleibt lesbar" "0.0.0.0:443->443/tcp" "0.0.0.0:443->443/tcp"
  pruefe "IPv6-Loopback bleibt lesbar" "listen [::1]:80" "listen [::1]:80"
  pruefe "gewöhnlicher Text bleibt" "client_max_body_size 20m;" "client_max_body_size 20m;"
  pruefe "Containername ohne Punkt bleibt" "roses-blog Up 3 days" "roses-blog Up 3 days"
  # Die benannte Grenze, hier festgehalten statt nur behauptet:
  pruefe "zweiteiliger Name bleibt lesbar (Grenze)" "docker.io/jc21/npm:2.11.1" "docker.io/jc21/npm:2.11.1"
  pruefe "Zeitstempel bleibt unversehrt" "Stand: 2026-08-22T23:14:47Z" "Stand: 2026-08-22T23:14:47Z"
  # Der Approver vermutete zusaetzlich, die Geheimnis-Regex trete auf
  # `proxy_pass` an. Nachgemessen trifft sie NICHT — das `[Dd]` in
  # `pass(w)(o)(r)d` ist Pflicht. Der Fall steht hier, damit die Messung
  # bleibt, falls jemand die Regex lockert.
  pruefe "proxy_pass ist kein Geheimnis" "proxy_pass http://127.0.0.1:3000;" "proxy_pass http://127.0.0.1:3000;"
  pruefe "Loopback-Adresse eines Proxys bleibt lesbar" "server 127.0.0.1:3000;" "server 127.0.0.1:3000;"
  # Die neue IPv6-Regel darf keine gewoehnliche URL mit IPv4 verschlucken:
  # dort ist genau die IPv4 das Geheimnis, und mehr soll nicht wegfallen.
  pruefe "URL mit oeffentlicher IPv4 bleibt eine URL" "http://192.0.2.1:3000 extern" "http://<IPv4>:3000 extern"
  # Eine Mailadresse hat keinen Doppelpunkt vor dem Klammeraffen und bleibt
  # deshalb stehen — die Userinfo-Regel darf nicht alles mit @ verschlucken.
  pruefe "Mailadresse bleibt lesbar" "Kontakt: name@beispiel.de" "Kontakt: name@beispiel.de"

  # DER PORTVERGLEICH — mit echten Argumenten, nicht ueber den Text geprueft.
  pruefen_gleich() { # pruefen_gleich <Beschreibung> <Ist> <Muster>
    case "$2" in
      *"$3"*) ;;
      *) echo "FEHLER: $1"; echo "  Bekommen:  $2"; echo "  Erwartet enthaelt: $3"; fehler=1 ;;
    esac
  }
  pruefen_gleich "Port stimmt ueberein" "$(hafen_abgleich 3000 '3000/tcp -> 0.0.0.0:3000')" "stimmt ueberein"
  pruefen_gleich "Portabweichung wird BENANNT" "$(hafen_abgleich 3000 '3000/tcp -> 0.0.0.0:3001')" "ABWEICHUNG"
  pruefen_gleich "3000 gilt nicht als in 30000 enthalten" "$(hafen_abgleich 3000 '30000/tcp -> 0.0.0.0:30000')" "ABWEICHUNG"
  pruefen_gleich "kein PORT in der .env wird gesagt" "$(hafen_abgleich '' '3000/tcp -> 0.0.0.0:3000')" "KEIN PORT"
  pruefen_gleich "keine Abbildung ist kein stiller Erfolg" "$(hafen_abgleich 3000 '')" "KEINE Abbildung"

  # RUNDE SIEBEN: M1 wird klassifiziert, nicht abgedruckt. Geprueft wird beides —
  # dass die Klasse stimmt UND dass in keiner Antwort eine Adresse steht.
  pruefen_gleich "Loopback erkannt" "$(adress_art 'proxy_pass http://127.0.0.1:3000;')" "Loopback"
  pruefen_gleich "IPv6-Loopback erkannt" "$(adress_art 'proxy_pass http://[::1]:3000;')" "Loopback"
  pruefen_gleich "privates Netz erkannt" "$(adress_art 'proxy_pass http://10.0.0.5:3000;')" "privates Netz"
  pruefen_gleich "Docker-Bereich erkannt" "$(adress_art 'proxy_pass http://172.17.0.2:3000;')" "privates Netz"
  pruefen_gleich "Containername erkannt" "$(adress_art 'set \$server "einname";')" "Containername"
  pruefen_gleich "externe Adresse als Klasse" "$(adress_art 'proxy_pass http://203.0.113.7:3000;')" "EXTERN"
  # Die beiden Formen, die keine Vierpunkt-Regel sieht — und die hier nicht
  # maskiert, sondern gar nicht erst gedruckt werden.
  pruefen_gleich "Kurzschreibweise wird nicht abgedruckt" "$(adress_art 'proxy_pass http://203.0.113;')" "nicht aufgeloest"
  pruefen_gleich "Zahlenliteral wird nicht abgedruckt" "$(adress_art 'proxy_pass http://3405803783;')" "nicht abgedruckt"
  for zeile in 'proxy_pass http://203.0.113;' 'proxy_pass http://3405803783;' \
               'proxy_pass http://127.0.0.1:3000;' 'proxy_pass http://[2001:db8::1]:3000;'; do
    antwort="$(adress_art "$zeile")"
    case "$antwort" in
      *[0-9].[0-9]*|*3405803783*|*2001*)
        echo "FEHLER: adress_art gibt eine Adresse zurueck: $antwort"; fehler=1 ;;
    esac
  done
  pruefe "Zahlen bleiben Zahlen" "RestartCount 4" "RestartCount 4"

  if [ "$fehler" -eq 0 ]; then
    echo "[erhebung] Selbsttest: 51 Fälle, Falle gestellt und Harmloses geschont ✓"
    return 0
  fi
  echo "[erhebung] Selbsttest FEHLGESCHLAGEN — die Ausgabe dieses Skripts ist NICHT weitergabesicher."
  return 1
}

# ---------------------------------------------------------------------------
# Kleine Helfer für den Bericht. `frage` beantwortet eine Zeile und sagt
# ausdrücklich, wenn sie NICHT beantwortbar war — ein leerer Wert wäre sonst
# von „ist nicht gesetzt" nicht zu unterscheiden.
# ---------------------------------------------------------------------------
abschnitt() { printf '\n## %s\n\n' "$1"; }

# ---------------------------------------------------------------------------
# Der Portvergleich — jetzt wirklich einer.
#
# Der Kopf dieses Skripts sagt seit der ersten Fassung: „Das Skript liest die
# `.env` und VERGLEICHT sie mit dem, was der Container veröffentlicht." Der
# Code tat das nicht. Er DRUCKTE beide Werte untereinander und überließ den
# Vergleich dem Auge des Lesers — eine Zusage, die nirgends eingelöst wurde
# (Befund des Pflicht-Approvers, PR #111). Das ist schlimmer als eine fehlende
# Prüfung: Es steht geschrieben, dass sie stattfindet.
#
# Eigene Funktion, damit die Entscheidung im Selbsttest mit echten Argumenten
# geprüft werden kann statt über den Text des Skripts.
#
# Kein Rückgabewert ungleich 0: Dieses Skript misst und weist aus, es deckelt
# nicht. Eine Abweichung ist ein BEFUND im Bericht, kein roter Lauf.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# M1 wird BEANTWORTET, nicht ABGEDRUCKT.
#
# Die Frage lautet: Wie erreicht der Proxy die Anwendung? Die Antwort ist eine
# KLASSE — Loopback, privates/Container-Netz oder extern —, nicht eine Adresse.
# Genau das ist der Unterschied, der die Sache beendet.
#
# WARUM DAS DIE EINZIGE TRAGFAEHIGE ANTWORT IST: Sieben Runden lang hat das
# Fremd-Vendor-Panel dieselbe Klasse an immer neuen Stellen gefunden — erst
# `::1` als Teilzeichenkette, dann IPv4-eingebettete IPv6, dann Nutzerteile,
# dann Abfragen, dann Abfragen ohne Pfad. In der letzten Runde kamen die
# Kurzschreibweise (`203.0.113`) und das Integer-Literal (`3405803783`) dazu:
# Beide adressieren denselben Wirt, und keine Vierpunkt-Regel sieht sie.
#
# Man kann diese Liste nicht zu Ende schreiben. Eine Adresse hat zu viele
# gueltige Schreibweisen, und jede Maskierung erkennt nur die, an die jemand
# gedacht hat. Was man dagegen zu Ende bringen kann: die Adresse gar nicht
# erst ausgeben. Klassifiziert wird auf dem Host, gedruckt wird die Klasse.
# Ein Integer-Literal, eine Kurzform, eine IPv6 in beliebiger Notation — keine
# davon kann austreten, weil keine davon in die Ausgabe gelangt.
#
# Was das kostet: Wer die konkrete Zieladresse braucht, liest sie oertlich.
# Was es bringt: Diese Frage ist nicht mehr angreifbar.
adress_art() { # adress_art <konfigurationszeile>
  local roh="$1" wirt
  # 1. fuehrende Direktive weg (`proxy_pass `, `set $server `), 2. Schema weg,
  # 3. alles ab / ? # ; weg, 4. Anfuehrungszeichen weg.
  #
  # Die erste Fassung schnitt bis zum ERSTEN Doppelpunkt — das traf `http:` in
  # `proxy_pass http://…` und liess `//…` stehen, was danach vollstaendig
  # weggeschnitten wurde. Jede Adresse hiess „unlesbar"; aufgefallen ist es
  # beim Messen, nicht beim Schreiben.
  wirt="$(printf '%s' "$roh" \
    | sed -E 's#^[[:space:]]*[^[:space:]]+[[:space:]]+##' \
    | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##' \
    | sed -E 's#[/?;].*##' \
    | tr -d '\042\047' \
    | tr -d '[:space:]')"
  # Klammern einer IPv6 und den Hafen abtrennen.
  case "$wirt" in
    \[*\]*) wirt="${wirt#[}"; wirt="${wirt%%]*}" ;;
    *:*) wirt="${wirt%:*}" ;;
  esac
  [ -n "$wirt" ] || { echo "unlesbar"; return 0; }
  case "$wirt" in
    localhost|127.*|::1) echo "Loopback" ;;
    10.*|192.168.*) echo "privates Netz" ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) echo "privates Netz" ;;
    fc*:*|fd*:*) echo "privates Netz (IPv6)" ;;
    *[!0-9.]*:*) echo "IPv6 — Klasse hier nicht bestimmt" ;;
    *.*) echo "EXTERN oder Name — hier nicht aufgeloest" ;;
    *[!0-9]*) echo "Containername (Container-Netz)" ;;
    *) echo "Zahlenliteral — nicht abgedruckt, Notation unklar" ;;
  esac
}

hafen_abgleich() { # hafen_abgleich <port-aus-env> <veroeffentlichte-ports>
  local erwartet="$1" ist="$2"
  if [ -z "$erwartet" ]; then
    echo "KEIN PORT in der .env — die autoritative Quelle ist leer. Ohne sie ist jeder Vergleich geraten."
    return 0
  fi
  if [ -z "$ist" ]; then
    echo ".env sagt $erwartet · der Container veroeffentlicht KEINE Abbildung. Im Host-Netz ist das normal (dann hoert die Anwendung direkt auf $erwartet); mit Portabbildung waere es ein Befund."
    return 0
  fi
  # VERGLICHEN WIRD DIE HOST-SEITE, und das ist keine Kleinigkeit.
  # `podman port` schreibt `<container>/tcp -> <adresse>:<host>`. Ein
  # Textvergleich gegen die ganze Zeile fand die 3000 in `3000/tcp` und nannte
  # `3000/tcp -> 0.0.0.0:3001` „stimmt ueberein" — also genau die Abweichung,
  # die zu finden war. Aufgefallen ist das dem eigenen Selbsttest, nicht dem
  # Auge. Erreichbar ist, was hinter dem Pfeil steht; das wird verglichen.
  local host_ports
  host_ports="$(printf '%s' "$ist" | tr ' ' '\n' | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' | tr '\n' ' ')"
  if [ -z "$host_ports" ]; then
    echo "UNKLAR · .env sagt $erwartet · veroeffentlicht: $ist · daraus laesst sich keine Host-Portnummer lesen."
    return 0
  fi
  case " $host_ports " in
    *" $erwartet "*)
      echo ".env sagt $erwartet · veroeffentlicht auf Host-Port(en): $host_ports· stimmt ueberein." ;;
    *)
      echo "ABWEICHUNG · .env sagt $erwartet · veroeffentlicht auf Host-Port(en): $host_ports· autoritative Quelle und laufender Container sagen Verschiedenes." ;;
  esac
}
frage() { # frage <Beschriftung> <Befehl…>
  local titel="$1"; shift
  local wert
  if wert="$("$@" 2>/dev/null)" && [ -n "$wert" ]; then
    printf '%s:\n%s\n\n' "$titel" "$wert"
  else
    printf '%s:\n  (nicht ermittelbar)\n\n' "$titel"
  fi
}

bericht() {
  local basis="$1"
  local wurzel
  wurzel="$(cd "$(dirname "$0")/../.." && pwd)"

  printf '# Erhebung\n\nStand: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'Erzeugt von scripts/regime/erhebung.sh — jede Zeile ist maskiert.\n'

  abschnitt "0 · Umgebung"
  frage "Kernel" uname -sr
  frage "podman" podman --version
  # KEIN GraphRoot-PFAD. Gefragt ist die Speicherlage, und die beantwortet
  # „rootless ja/nein" vollstaendig. Der Pfad dorthin traegt Konto- und
  # Projektnamen und beantwortet nichts, was hier gefragt waere (Befund des
  # Panels, Runde acht — dieselbe Klasse wie bei M1).
  frage "Speicherlage (rootless?)" podman info --format 'rootless={{.Host.Security.Rootless}}'

  abschnitt "1 · Anwendung"
  # `|| echo '(nicht gesetzt)'` stand hier einmal und feuerte NIE: In einer
  # Pipe zaehlt der Status des LETZTEN Befehls, und `cut` gelingt auch bei
  # leerer Eingabe. Ein fehlendes PORT ergab damit eine leere Zeile statt eines
  # Hinweises (Befund des Pflicht-Approvers, PR #111). Jetzt entscheidet
  # `hafen_abgleich` ueber den leeren Fall, nicht ein Rueckgabewert, den es
  # nicht gibt.
  PORT_ENV=""
  if [ -f "$wurzel/.env" ]; then
    # NUR DIE ZAHL, nicht der Rohwert. Was in der `.env` steht, ist Text; was
    # M1/M4 beantwortet, ist eine Portnummer. Alles andere wird gemeldet statt
    # abgedruckt — ein unerwarteter Rohwert koennte alles enthalten (Befund des
    # Panels: „rohe .env-Werte statt Env-Semantik").
    PORT_ROH="$(grep -E '^PORT=' "$wurzel/.env" | head -1 | cut -d= -f2- || true)"
    PORT_ROH="$(printf '%s' "$PORT_ROH" | tr -d '[:space:]\042\047')"
    case "$PORT_ROH" in
      "") PORT_ENV="" ;;
      *[!0-9]*) PORT_ENV=""; printf 'PORT in der .env:\n  (gesetzt, aber keine reine Zahl — Wert wird nicht abgedruckt)\n\n' ;;
      *) PORT_ENV="$PORT_ROH" ;;
    esac
  else
    # Auch hier KEIN Pfad: `$wurzel` ist ein Hostpfad und traegt Konto- und
    # Projektnamen. Dass die Datei fehlt, ist die Auskunft; wo gesucht wurde,
    # weiss der, der das Skript aufruft.
    printf 'PORT laut .env (autoritativ):\n  (keine .env im Projektverzeichnis)\n\n'
  fi
  printf 'M1/M4 · Port: .env GEGEN laufenden Container\n  %s\n\n' \
    "$(hafen_abgleich "$PORT_ENV" "$(podman port roses-blog 2>/dev/null | tr '\n' ' ' || true)")"
  frage "Container" podman ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  frage "roses-blog: Netz, Neustartregel, Neustartzähler, Start" \
    podman inspect -f 'Netz {{.HostConfig.NetworkMode}} · Regel {{.HostConfig.RestartPolicy.Name}} · Neustarts {{.RestartCount}} · seit {{.State.StartedAt}}' roses-blog
  frage "Bild-Marken (latest/previous/last-good)" \
    podman images --format '{{.Repository}}:{{.Tag}} {{.Created}}' --filter reference=localhost/roses-blog

  abschnitt "2 · Proxy — Fragen M1 bis M4"
  local proxy=""
  if [ -n "$basis" ]; then
    proxy="$("$(dirname "$0")/npm-container-finden.sh" --basis "$basis" 2>/dev/null || true)"
  fi
  if [ -z "$proxy" ]; then
    printf 'Proxy-Container:\n  (nicht bestimmt — dieser Abschnitt braucht --basis <url>,\n'
    printf '   damit der Proxy POSITIV identifiziert wird statt geraten)\n\n'
  else
    printf 'Proxy-Container:\n  %s\n\n' "$proxy"
    frage "M4 · Netzlage und Portveröffentlichung" \
      podman inspect -f 'Netz {{.HostConfig.NetworkMode}} · Ports {{.NetworkSettings.Ports}}' "$proxy"
    # ART UND ZIEL, NICHT DIE QUELLE. Wonach M4 fragt, ist: Liegt der Zustand in
    # einem Hostverzeichnis, in einem benannten Volume oder fluechtig? Das sagt
    # `.Type`. Der Quellpfad traegt Konto- und Projektnamen und beantwortet
    # nichts davon — er entfaellt (Runde acht; die Pfadmaskierung kannte nur
    # /home und /Users, waehrend /srv, /opt und /var/home roh durchliefen).
    frage "M4 · eingehängte Verzeichnisse (Art → Ziel im Container)" \
      podman inspect -f '{{range .Mounts}}{{.Type}} -> {{.Destination}}{{"\n"}}{{end}}' "$proxy"
    # `nginx -v` schreibt seine Fassung auf STDERR. `frage` verwirft stderr,
    # also meldete diese Zeile „(nicht ermittelbar)" — bei installiertem nginx,
    # jedes Mal. Eine Auskunft, die immer dasselbe sagt, ist keine (Befund des
    # Pflicht-Approvers, PR #111). Zusammengeführt wird IM Container, damit
    # `frage` weiterhin nur echte Fehler schluckt.
    frage "nginx-Fassung im Proxy" podman exec "$proxy" sh -c "nginx -v 2>&1"
    # M1: Woher weiß der Proxy, wohin er weiterreicht? Aus den erzeugten
    # proxy_host-Dateien — NICHT aus der Datenbank des Proxy-Managers.
    # Die Rohzeilen werden GELESEN, aber nie gedruckt — s. adress_art().
    M1_ROH="$(podman exec "$proxy" sh -c "grep -rhE '^\s*(proxy_pass|set \\\$server)' /data/nginx/proxy_host/ | sort -u" 2>/dev/null || true)"
    if [ -z "$M1_ROH" ]; then
      printf 'M1 · Wie der Proxy die Anwendung erreicht:\n  (keine Weiterleitungsziele lesbar)\n\n'
    else
      printf 'M1 · Wie der Proxy die Anwendung erreicht (Klassen, keine Adressen):\n'
      printf '%s\n' "$M1_ROH" | while IFS= read -r zeile; do
        [ -n "$zeile" ] && adress_art "$zeile"
      done | sort | uniq -c | sed 's/^/  /'
      printf '\n'
    fi
    frage "M2 · client_max_body_size / proxy_read_timeout (wirksam, aus nginx -T)" \
      podman exec "$proxy" sh -c "nginx -T 2>/dev/null | grep -E 'client_max_body_size|proxy_read_timeout' | sort | uniq -c"
    frage "M2 · bindet die Konfiguration http.conf und server_proxy.conf ein?" \
      podman exec "$proxy" sh -c "nginx -T 2>/dev/null | grep -E '# configuration file .*(http\.conf|server_proxy\.conf)' || echo 'kein Treffer — die Dateien werden NICHT eingebunden'"
    frage "M3 · gesetzte Weiterleitungsköpfe" \
      podman exec "$proxy" sh -c "nginx -T 2>/dev/null | grep -E 'proxy_set_header +X-(Real-IP|Forwarded-For|Forwarded-Host|Forwarded-Proto)' | sort | uniq -c"
    frage "M3 · set_real_ip_from: Anzahl und Kontext" \
      podman exec "$proxy" sh -c "nginx -T 2>/dev/null | grep -c 'set_real_ip_from' | sed 's/^/Zeilen insgesamt: /'; nginx -T 2>/dev/null | grep -B2 'set_real_ip_from' | grep -E '# configuration file' | sort -u"
    frage "M3 · real_ip_header" \
      podman exec "$proxy" sh -c "nginx -T 2>/dev/null | grep -E 'real_ip_header|real_ip_recursive' | sort | uniq -c || echo 'nicht gesetzt'"

    abschnitt "3 · Zertifikate — Frage M5"
    # Bewusst über die Zertifikatsdateien, nicht über die Manager-Datenbank:
    # die trägt Zugangsdaten. Das Ablaufdatum steht im Zertifikat selbst und
    # ist damit die verlässlichere Quelle.
    frage "M5 · Namen, Aussteller und Restlaufzeit" \
      podman exec "$proxy" sh -c '
        for f in /etc/letsencrypt/live/*/fullchain.pem; do
          [ -f "$f" ] || continue
          ende=$(openssl x509 -in "$f" -noout -enddate | cut -d= -f2)
          tage=$(( ( $(date -d "$ende" +%s) - $(date +%s) ) / 86400 ))
          namen=$(openssl x509 -in "$f" -noout -ext subjectAltName | tail -1 | tr -d " ")
          echo "$namen | laeuft $ende | noch $tage Tage"
        done'
  fi

  abschnitt "4 · Betrieb — Frage M6"
  # DAS ETIKETT MUSS HALTEN, WAS DER BEFEHL LIEFERT. Vorher stand hier
  # „Neustartzähler und Startzeitpunkt aller Container" — ausgegeben wurden
  # aber nur die NAMEN. M6 war damit für jeden Container außer roses-blog gar
  # nicht erhoben, und niemandem wäre es aufgefallen: Die Zeile sah beantwortet
  # aus (Befund des Pflicht-Approvers, PR #111).
  frage "M6 · Zustand, Neustartzähler und Startzeitpunkt ALLER Container" \
    sh -c 'ids=$(podman ps -aq); [ -n "$ids" ] || exit 1;
           podman inspect --format "{{.Name}} · {{.State.Status}} · Neustarts {{.RestartCount}} · seit {{.State.StartedAt}}" $ids'

  # KEINE ROHEN PROTOKOLLE. Hier standen 200 Zeilen `podman logs` — durch
  # denselben Stichwortfilter geschickt und damit „maskiert" genannt. Das ist
  # eine Zusage, die der Filter nicht halten kann: Anwendungsprotokolle sind
  # freier Text, und ein Filter, der `password|token|secret|…` kennt, sieht
  # eine Verbindungszeichenfolge nicht, die Benutzer und Kennwort vor dem
  # Klammeraffen traegt (Befund des Pflicht-Approvers, PR #111). Gezaehlt wird
  # deshalb, gezeigt wird nicht.
  frage "M6 · Umfang der Protokolle (NICHT ihr Inhalt — s. Kommentar)" \
    sh -c 'z=$(podman logs --tail 500 roses-blog 2>&1 | wc -l);
           f=$(podman logs --tail 500 roses-blog 2>&1 | grep -ci "error" || true);
           echo "letzte 500 Zeilen: $z gelesen, $f mit \"error\"";
           echo "Inhalt bewusst nicht abgedruckt — auf dem Host lesen: podman logs roses-blog"'

  abschnitt "5 · Was dieses Skript NICHT beantworten kann"
  cat <<'ENDE'
M7 · Wie sich der Ursprungsmedian auf Datenbank, Render und Serialisierung
     verteilt. Das ist keine Frage an den Host, sondern an die Anwendung: Ohne
     Zeitmessung um die drei Phasen herum lässt sich der Wert nicht aufteilen.
     Eine Erhebung, die hier etwas schätzte, würde eine Zahl erfinden.

M8 · Auf welche Adresse der GitHub-Webhook für das Auto-Deploy zeigt. Das steht
     in den Repository-Einstellungen, nicht auf dem Server. Zeigt er auf den
     Ursprung statt auf die von Cloudflare bediente Domain, stirbt das
     Auto-Deploy nach einem Adresswechsel STILL — das Symptom wäre „gemergte
     Pull Requests erreichen die Produktion nicht mehr", und dafür gibt es
     keinen Alarm. Nachsehen muss das jemand mit Admin-Recht.

Nicht gelesen wurde /data/database.sqlite im Proxy-Container. Sie trägt
Zugangsdaten im Klartext; alles hier Gefragte steht in den erzeugten
nginx-Dateien.
ENDE
}

# ---------------------------------------------------------------------------
BASIS=""
case "${1:-}" in
  --selftest) selbsttest; exit $? ;;
  --maskieren) maskieren; exit 0 ;;
esac
while [ $# -gt 0 ]; do
  case "$1" in
    --basis) BASIS="${2:-}"; shift 2 ;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 3 ;;
  esac
done

# ALLES durch die Maskierung. Nicht je Befehl — hier, an genau einer Stelle.
bericht "$BASIS" | maskieren
