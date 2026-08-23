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
# ---------------------------------------------------------------------------
maskieren() {
  sed -E \
    -e 's/\b(127\.0\.0\.1)\b/@@LOOPBACK@@/g' \
    -e 's/\b(0\.0\.0\.0)\b/@@JEDE@@/g' \
    -e 's/::1/@@LOOPBACK6@@/g' \
    -e 's/([Pp][Aa][Ss][Ss][Ww]?[Oo]?[Rr]?[Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Bb][Ee][Aa][Rr][Ee][Rr])([[:space:]]*[:=][[:space:]]*|[[:space:]]+).*$/\1\2<maskiert>/' \
    -e 's/\b([0-9]{1,3}\.){3}[0-9]{1,3}\b/<IPv4>/g' \
    -e 's/([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/<IPv6>/g' \
    -e 's/[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{1,4}){0,6}::([0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){0,6})?/<IPv6>/g' \
    -e 's/\b[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+\.[A-Za-z]{2,}\b/<name>/g' \
    -e 's/\b[A-Za-z0-9+\/]{40,}={0,2}\b/<langer-wert>/g' \
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

  # Das Geschonte: ohne diese Fälle wäre der Bericht unlesbar.
  pruefe "Loopback bleibt lesbar" "proxy_pass http://127.0.0.1:3000;" "proxy_pass http://127.0.0.1:3000;"
  pruefe "0.0.0.0 bleibt lesbar" "0.0.0.0:443->443/tcp" "0.0.0.0:443->443/tcp"
  pruefe "IPv6-Loopback bleibt lesbar" "listen [::1]:80" "listen [::1]:80"
  pruefe "gewöhnlicher Text bleibt" "client_max_body_size 20m;" "client_max_body_size 20m;"
  pruefe "Containername ohne Punkt bleibt" "roses-blog Up 3 days" "roses-blog Up 3 days"
  # Die benannte Grenze, hier festgehalten statt nur behauptet:
  pruefe "zweiteiliger Name bleibt lesbar (Grenze)" "docker.io/jc21/npm:2.11.1" "docker.io/jc21/npm:2.11.1"
  pruefe "Zeitstempel bleibt unversehrt" "Stand: 2026-08-22T23:14:47Z" "Stand: 2026-08-22T23:14:47Z"
  pruefe "Zahlen bleiben Zahlen" "RestartCount 4" "RestartCount 4"

  if [ "$fehler" -eq 0 ]; then
    echo "[erhebung] Selbsttest: 16 Fälle, Falle gestellt und Harmloses geschont ✓"
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
  frage "Speicherlage (rootless?)" podman info --format '{{.Host.Security.Rootless}} · GraphRoot {{.Store.GraphRoot}}'

  abschnitt "1 · Anwendung"
  if [ -f "$wurzel/.env" ]; then
    printf 'PORT laut .env (autoritativ):\n  %s\n\n' \
      "$(grep -E '^PORT=' "$wurzel/.env" | head -1 | cut -d= -f2- || echo '(nicht gesetzt)')"
  else
    printf 'PORT laut .env (autoritativ):\n  (keine .env unter %s)\n\n' "$wurzel"
  fi
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
    frage "M4 · eingehängte Verzeichnisse" \
      podman inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' "$proxy"
    frage "nginx-Fassung im Proxy" podman exec "$proxy" nginx -v
    # M1: Woher weiß der Proxy, wohin er weiterreicht? Aus den erzeugten
    # proxy_host-Dateien — NICHT aus der Datenbank des Proxy-Managers.
    frage "M1 · Weiterleitungsziele (proxy_pass)" \
      podman exec "$proxy" sh -c "grep -rhE '^\s*(proxy_pass|set \\\$server|set \\\$port)' /data/nginx/proxy_host/ | sort -u"
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
  frage "Neustartzähler und Startzeitpunkt aller Container" \
    podman ps -a --format '{{.Names}}' --filter status=running \
    --filter status=exited
  frage "letzte Fehlerzeilen der Anwendung (maskiert)" \
    podman logs --tail 200 roses-blog

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
