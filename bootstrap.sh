#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Roses Food Blog — Ersteinrichtung auf einem frischen Ubuntu-Server.
#
# One-Liner (nach dem Klonen ist dies der einzige Befehl):
#
#   git clone <REPO-URL> && cd roses-food-blog && ./bootstrap.sh
#
# Das Skript ist idempotent und übernimmt:
#   1. Systempakete installieren (podman, podman-compose, curl, openssl)
#   2. .env interaktiv erzeugen (SESSION_SECRET automatisch)
#   3. Datenverzeichnis anlegen
#   4. ./deploy.sh ausführen (Build, Migrationen, Start, Healthcheck, Autostart)
#   5. Optional: nginx + Let's-Encrypt-TLS einrichten
#
# Alle Werte können auch nicht-interaktiv über Umgebungsvariablen vorgegeben
# werden (BASE_URL, SMTP_HOST, ..., ADMIN_EMAIL, ADMIN_PASSWORD).
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")"

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mFEHLER: %s\033[0m\n' "$*"; exit 1; }

SUDO="sudo"
[[ $(id -u) -eq 0 ]] && SUDO=""

# Eingaben auch dann ermöglichen, wenn das Skript gepipet wurde
ask() { # ask VAR "Frage" "Default"
  local var="$1" prompt="$2" default="${3:-}" value
  if [[ -n "${!var:-}" ]]; then return 0; fi
  if [[ -n "$default" ]]; then prompt="$prompt [$default]"; fi
  read -rp "$prompt: " value < /dev/tty || true
  printf -v "$var" '%s' "${value:-$default}"
}

# --- 1. Systempakete ---------------------------------------------------------
MISSING=()
command -v podman >/dev/null || MISSING+=(podman)
command -v curl >/dev/null || MISSING+=(curl)
command -v openssl >/dev/null || MISSING+=(openssl)
if ! podman compose version >/dev/null 2>&1 && ! command -v podman-compose >/dev/null; then
  MISSING+=(podman-compose)
fi
if [[ ${#MISSING[@]} -gt 0 ]]; then
  log "Installiere fehlende Pakete: ${MISSING[*]}"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y "${MISSING[@]}"
fi

# --- 2. .env erzeugen ---------------------------------------------------------
if [[ -f .env ]]; then
  log ".env existiert bereits — wird unverändert genutzt."
else
  log "Konfiguration (.env) erstellen"
  echo "Hinweis: Passwörter bitte ohne Leerzeichen und Anführungszeichen."
  ask BASE_URL      "Öffentliche URL der Website (z. B. https://www.example.de)" "http://localhost:3000"
  ask ADMIN_EMAIL   "E-Mail des Admin-Kontos" ""
  ask ADMIN_PASSWORD "Passwort des Admin-Kontos (mind. 10 Zeichen)" ""
  ask SMTP_HOST     "SMTP-Server" "smtp.example.de"
  ask SMTP_PORT     "SMTP-Port" "587"
  ask SMTP_USER     "SMTP-Benutzer" ""
  ask SMTP_PASS     "SMTP-Passwort" ""
  ask SMTP_FROM_ADDR "Absenderadresse für Newsletter" "${SMTP_USER:-newsletter@example.de}"
  ask DATA_DIR      "Datenverzeichnis" "/srv/roses-blog/data"
  ask PORT          "Lokaler Port für den Container" "3000"

  [[ -n "$ADMIN_EMAIL" && -n "$ADMIN_PASSWORD" ]] \
    || fail "ADMIN_EMAIL und ADMIN_PASSWORD sind Pflicht (Admin-Erstanlage)."
  [[ ${#ADMIN_PASSWORD} -ge 10 ]] || fail "Das Admin-Passwort braucht mindestens 10 Zeichen."

  SESSION_SECRET="$(openssl rand -hex 32)"
  BASE_URL_OHNE_SLASH="${BASE_URL%/}"

  # Setzt @NAME@-Platzhalter in EINEM Durchlauf ein.
  #
  # Warum nicht einfach `${text//@A@/$a}; ${text//@B@/$b}` nacheinander: dabei
  # durchsucht jeder Schritt auch das, was der vorige eingesetzt hat. Ein Wert,
  # der zufällig wie ein späterer Platzhalter aussieht, wird dann still durch
  # einen fremden Wert ersetzt — nachgestellt: ein SMTP_USER mit dem Text
  # „@SMTP_PASS@" bekam das echte Passwort eingesetzt, das Secret landete im
  # Benutzernamen. Umgekehrt bleibt ein FRÜHERER Marker in einem SPÄT
  # eingesetzten Wert stehen und ließ die Rest-Prüfung falsch anschlagen
  # (Befund gpt-5.6-sol, PR #65).
  #
  # Hier wird der Text von links nach rechts zerlegt und die Ausgabe nur
  # ANGEHÄNGT. Was einmal eingesetzt ist, wird nie wieder angesehen.
  #
  # Aufruf: einmal_einsetzen "$vorlage" NAME1 "$wert1" NAME2 "$wert2" …
  einmal_einsetzen() {
    local rest="$1"; shift
    local aus="" vor name i j gefunden
    while [[ "$rest" == *@*@* ]]; do
      vor=${rest%%@*}          # Text vor dem nächsten @
      rest=${rest#*@}          # ab hinter diesem @
      name=${rest%%@*}         # möglicher Platzhaltername
      gefunden=0
      for ((i = 1; i <= $#; i += 2)); do
        if [[ "${!i}" == "$name" ]]; then
          j=$((i + 1))
          aus+="$vor${!j}"     # Wert anhängen — nie erneut durchsucht
          rest=${rest#*@}      # schließendes @ überspringen
          gefunden=1
          break
        fi
      done
      # Kein bekannter Name: das @ gehört zum Text (etwa eine E-Mail-Adresse).
      (( gefunden )) || aus+="$vor@"
    done
    printf '%s' "$aus$rest"
  }

  # Vorlage GEQUOTET (<<'EOF'): die Shell fasst den Text nicht an, Werte kommen
  # ausschließlich über @PLATZHALTER@ herein. Das ist hier besonders wichtig,
  # weil in diese Datei Secrets geschrieben werden (SESSION_SECRET,
  # ADMIN_PASSWORD, SMTP_PASS) — und weil ein unquotiertes Heredoc in genau
  # dieser Rolle am 2026-08-14 die komplette Prozessumgebung in eine
  # systemd-Unit geschrieben hat. Zudem darf so ein Passwort mit Backtick oder
  # $( ) nicht mehr zur Ausführung führen, sondern landet als Text in der .env.
  env_vorlage=$(cat <<'EOF'
BASE_URL=@BASE_URL@
PORT=@PORT@
DATA_DIR=@DATA_DIR@
SESSION_SECRET=@SESSION_SECRET@

SMTP_HOST=@SMTP_HOST@
SMTP_PORT=@SMTP_PORT@
SMTP_USER=@SMTP_USER@
SMTP_PASS=@SMTP_PASS@
SMTP_FROM="Roses Food Blog <@SMTP_FROM_ADDR@>"
EMAIL_RATE_PER_MINUTE=30

ADMIN_EMAIL=@ADMIN_EMAIL@
ADMIN_PASSWORD=@ADMIN_PASSWORD@

TZ=Europe/Berlin
EOF
)
  # Vorlage prüfen, BEVOR eingesetzt wird: jeder @NAME@ in der Vorlage muss
  # unten einen Wert bekommen. Geprüft wird der VORLAGENTEXT (Quelltext), nicht
  # das Ergebnis — dort könnte ein @NAME@ aus einem WERT stammen, und die
  # Prüfung schlüge falsch an (Befund gpt-5.6-sol, PR #65).
  rest_vorlage="$env_vorlage"
  for platz in @BASE_URL@ @PORT@ @DATA_DIR@ @SESSION_SECRET@ @SMTP_HOST@ \
               @SMTP_PORT@ @SMTP_USER@ @SMTP_PASS@ @SMTP_FROM_ADDR@ \
               @ADMIN_EMAIL@ @ADMIN_PASSWORD@; do
    rest_vorlage=${rest_vorlage//"$platz"/}
  done
  if [[ "$rest_vorlage" =~ @[A-Z_]+@ ]]; then
    fail ".env-Vorlage enthält einen Platzhalter ohne Wert: ${BASH_REMATCH[0]}"
  fi

  env_vorlage=$(einmal_einsetzen "$env_vorlage" \
    BASE_URL "$BASE_URL_OHNE_SLASH" PORT "$PORT" DATA_DIR "$DATA_DIR" \
    SESSION_SECRET "$SESSION_SECRET" SMTP_HOST "$SMTP_HOST" \
    SMTP_PORT "$SMTP_PORT" SMTP_USER "$SMTP_USER" SMTP_PASS "$SMTP_PASS" \
    SMTP_FROM_ADDR "$SMTP_FROM_ADDR" ADMIN_EMAIL "$ADMIN_EMAIL" \
    ADMIN_PASSWORD "$ADMIN_PASSWORD")

  # Erst die leere Datei mit 600 anlegen, dann befüllen: sonst stünden die
  # Secrets für einen Wimpernschlag mit den Standardrechten (meist 644) da.
  : > .env
  chmod 600 .env
  printf '%s\n' "$env_vorlage" > .env
  echo ".env geschrieben (SESSION_SECRET automatisch erzeugt)."
fi

# --- 3. Datenverzeichnis -------------------------------------------------------
set -a; source <(grep -E '^[A-Z_]+=' .env); set +a
DATA_DIR="${DATA_DIR:-/srv/roses-blog/data}"
if [[ ! -d "$DATA_DIR" ]]; then
  log "Lege Datenverzeichnis $DATA_DIR an"
  $SUDO mkdir -p "$DATA_DIR"
  $SUDO chown "$(id -u):$(id -g)" "$DATA_DIR"
fi

# --- 4. Deployment --------------------------------------------------------------
log "Starte Deployment (Build, Migrationen, Start, Healthcheck, Autostart)"
SKIP_PULL=1 ./deploy.sh

# --- 5. Optional: nginx + TLS ----------------------------------------------------
DOMAIN="$(echo "${BASE_URL:-}" | sed -E 's#https?://##; s#/.*##')"
if [[ "$DOMAIN" != "localhost:${PORT:-3000}" && "$DOMAIN" != "localhost" && -n "$DOMAIN" ]]; then
  SETUP_NGINX="${SETUP_NGINX:-}"
  if [[ -z "$SETUP_NGINX" ]]; then
    read -rp "nginx als Reverse Proxy + Let's-Encrypt-TLS für $DOMAIN jetzt einrichten? [j/N]: " SETUP_NGINX < /dev/tty || true
  fi
  if [[ "$SETUP_NGINX" =~ ^[jJyY] ]]; then
    log "Richte nginx + certbot für $DOMAIN ein"
    $SUDO apt-get install -y nginx certbot python3-certbot-nginx
    # brotli-Modul separat und OHNE Abbruch: `set -e` gilt im ganzen Skript,
    # ein fehlendes Paket (andere Distribution, alter Ubuntu-Stand) würde die
    # Ersteinrichtung sonst mitten im Lauf beenden. Schlägt es fehl, wird
    # weiter unten der brotli-Block aus der Config entfernt — nginx läuft dann
    # mit gzip, und `nginx -t` bleibt grün. Ein „brotli on;" ohne geladenes
    # Modul ist ein harter Konfigurationsfehler, kein stiller Rückfall.
    #
    # Nur das „…-filter"-Paket: es komprimiert im Durchreichen. Das Gegenstück
    # „…-static" liefert vorkomprimierte .br-Dateien aus — die erzeugt hier
    # niemand.
    BROTLI_OK=1
    $SUDO apt-get install -y libnginx-mod-http-brotli-filter || BROTLI_OK=0
    # Der Rückgabewert von apt ist KEIN Beweis, dass nginx das Modul lädt: Das
    # postinst des Pakets verlinkt nach /etc/nginx/modules-enabled NUR bei der
    # Erstinstallation ([ -z "$2" ]). War das Paket schon installiert und der
    # Link von Hand entfernt, meldet apt Erfolg und `load_module` fehlt
    # trotzdem — ein „brotli on;" zerlegte dann das `nginx -t` weiter unten.
    # Beweis ist der Link, nicht der Exit-Code.
    #
    # Gesucht wird gezielt das FILTER-Modul, nicht „irgendwas mit brotli": Das
    # Schwesterpaket …-static verlinkt ebenfalls nach modules-enabled, bringt
    # aber nur `brotli_static` mit. Wäre nur das installiert, ginge eine grobe
    # Suche auf, und `brotli on;` bliebe eine unbekannte Direktive.
    #
    # Gelesen wird GENAU das, was auch nginx liest — sonst weicht die Antwort
    # von der Wirklichkeit ab, und zwar in beide Richtungen gefährlich:
    #
    #   `-R`, nicht `-r`: Die Einträge in modules-enabled sind Symlinks nach
    #   modules-available. `grep -r` folgt Symlinks nur auf der Kommandozeile,
    #   nicht im Verzeichnis — es fände den Debian-Standardlink NIE.
    #
    #   `--include='*.conf'`: nginx.conf bindet die Module mit
    #   `include /etc/nginx/modules-enabled/*.conf;` ein. Eine Sicherungskopie
    #   wie „…conf.disabled" liest nginx NICHT — sie darf hier also auch nicht
    #   zählen.
    #
    #   `^[[:space:]]*load_module`: eine auskommentierte Zeile ist keine
    #   geladene. Reine Textsuche hielte „# load_module …brotli…" für ein
    #   aktives Modul.
    #
    # Ein falsches Ja heißt: brotli-Direktiven ohne Modul, nginx verweigert den
    # Start. Ein falsches Nein heißt: der Reparaturzweig weiter unten löscht den
    # Block bei jedem Re-Run aus einer funktionierenden Config.
    # tests/kompression.test.ts führt genau diesen Befehl gegen die echte
    # Verzeichnisstruktur aus, in allen fünf Lagen.
    if [[ "$BROTLI_OK" == "1" ]] &&
      ! grep -Rqs --include='*.conf' -E \
        '^[[:space:]]*load_module[^#]*ngx_http_brotli_filter_module' \
        /etc/nginx/modules-enabled/; then
      BROTLI_OK=0
    fi
    if [[ "$BROTLI_OK" == "0" ]]; then
      echo "HINWEIS: brotli-Modul nicht aktiv — nginx komprimiert nur mit gzip."
      echo "         Das ist funktionsfähig, kostet aber rund 4 % mehr Bytes (JS) bzw. 7 % (CSS)."
    fi
    # nginx-Config nur beim ersten Mal aus der HTTP-Vorlage schreiben. Ein
    # Re-Run darf certbots eingefügten TLS-/443-Block NICHT überschreiben.
    NGINX_GEAENDERT=0
    NGINX_SICHERUNG=""
    if [[ ! -e /etc/nginx/sites-available/roses-blog ]]; then
      $SUDO tee /etc/nginx/sites-available/roses-blog >/dev/null < <(
        sed -e "s/www\.example\.de example\.de/$DOMAIN/" \
            -e "s/127\.0\.0\.1:3000/127.0.0.1:${PORT:-3000}/" \
            deploy/nginx.conf.example \
        | if [[ "$BROTLI_OK" == "1" ]]; then cat; else
            sed '/# BROTLI-ANFANG/,/# BROTLI-ENDE/d'
          fi
      )
      $SUDO ln -sf /etc/nginx/sites-available/roses-blog /etc/nginx/sites-enabled/roses-blog
      NGINX_GEAENDERT=1
    else
      echo "nginx-Config existiert bereits — Server-Block unverändert gelassen."
      # GENAU EINE Ausnahme von „unverändert": brotli-Direktiven ohne geladenes
      # Modul sind ein harter `nginx -t`-Fehler, kein stiller Rückfall auf gzip.
      # Wurde die Config einst MIT brotli geschrieben und ist das Modul heute
      # weg (nginx-Upgrade auf eine neue ABI — das Paket hängt an
      # nginx-abi-1.24.0-1 —, Paket entfernt, Distributionswechsel), stünde hier
      # eine ungültige Config, die nginx beim nächsten Start nicht mehr annimmt.
      # Der markierte Block wird deshalb gezielt herausgeschnitten. Der
      # sed-Bereich trifft JEDES Vorkommen, also auch das in den von certbot
      # kopierten 443-Block; alles außerhalb der Marken — Zertifikatspfade,
      # Weiterleitungen, proxy_pass — bleibt unangetastet.
      #
      # ABER: Ein sed-Bereich, dessen Endmuster nie auftritt, läuft bis zum
      # DATEIENDE. Fehlt „# BROTLI-ENDE" — von Hand entfernt, beim Editieren
      # verrutscht —, löschte der Schnitt den gesamten Rest der Config: TLS,
      # proxy_pass, schließende Klammern. Aus einer Reparatur würde ein
      # Totalschaden an einer fremden, laufenden Datei. Deshalb wird nur
      # geschnitten, wenn die Marken PAARWEISE aufgehen, und nur über eine
      # Sicherungskopie.
      if [[ "$BROTLI_OK" == "0" ]] &&
        $SUDO grep -q '# BROTLI-ANFANG' /etc/nginx/sites-available/roses-blog; then
        MARKEN_AUF=$($SUDO grep -c '# BROTLI-ANFANG' /etc/nginx/sites-available/roses-blog || true)
        MARKEN_ZU=$($SUDO grep -c '# BROTLI-ENDE' /etc/nginx/sites-available/roses-blog || true)
        if [[ "$MARKEN_AUF" != "$MARKEN_ZU" ]]; then
          echo "Gefunden: $MARKEN_AUF × BROTLI-ANFANG, aber $MARKEN_ZU × BROTLI-ENDE."
          echo "Ohne Endmarke schnitte sed bis zum Dateiende und zerstörte die Config."
          fail "brotli-Block in /etc/nginx/sites-available/roses-blog ist unvollständig markiert.
       Das Modul fehlt, die brotli-Zeilen müssen weg — bitte von Hand entfernen.
       nginx nimmt die Config sonst nicht mehr an (unknown directive „brotli\")."
        fi
        echo "Entferne brotli-Block aus der bestehenden Config — das Modul fehlt."
        NGINX_SICHERUNG="/etc/nginx/sites-available/roses-blog.vor-brotli-schnitt"
        $SUDO cp -a /etc/nginx/sites-available/roses-blog "$NGINX_SICHERUNG"
        $SUDO sed -i '/# BROTLI-ANFANG/,/# BROTLI-ENDE/d' \
          /etc/nginx/sites-available/roses-blog
        NGINX_GEAENDERT=1
      fi
      # Die Gegenrichtung — Modul ist da, Config kennt kein brotli — wird
      # bewusst NICHT automatisch nachgetragen: Dafür müsste das Skript in einen
      # von certbot verwalteten Block hineinschreiben, und der Zustand ist
      # funktionsfähig (gzip), nur nicht optimal. Wer nachrüsten will, nimmt den
      # Block aus deploy/nginx.conf.example (README §4).
      if [[ "$BROTLI_OK" == "1" ]] &&
        ! $SUDO grep -q '# BROTLI-ANFANG' /etc/nginx/sites-available/roses-blog; then
        echo "HINWEIS: brotli-Modul ist aktiv, die bestehende Config nutzt es aber nicht."
        echo "         Nachrüsten: Block aus deploy/nginx.conf.example übernehmen (README §4)."
      fi
    fi
    if [[ "$NGINX_GEAENDERT" == "1" ]]; then
      # `set -e` würde hier abbrechen und eine womöglich von uns beschädigte
      # Config zurücklassen. Wenn wir geschnitten haben, wird sie zuerst
      # zurückgerollt — der Server läuft dann weiter wie vorher, und der Fehler
      # steht im Klartext da, statt beim nächsten Neustart aufzuschlagen.
      if ! $SUDO nginx -t; then
        if [[ -n "$NGINX_SICHERUNG" ]]; then
          echo "nginx -t fehlgeschlagen — stelle $NGINX_SICHERUNG wieder her."
          $SUDO cp -a "$NGINX_SICHERUNG" /etc/nginx/sites-available/roses-blog
        fi
        fail "nginx-Konfiguration ungültig (nginx -t, Ausgabe siehe oben)."
      fi
      $SUDO systemctl reload nginx
      if [[ -n "$NGINX_SICHERUNG" ]]; then
        echo "Sicherung der vorherigen Config: $NGINX_SICHERUNG"
      fi
    fi
    # certbot nur, wenn noch kein Zertifikat existiert (sonst Re-Run-Rausch /
    # Rate-Limit-Risiko).
    if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
      echo "TLS-Zertifikat für $DOMAIN existiert bereits — certbot übersprungen."
    else
      $SUDO certbot --nginx -d "$DOMAIN" --redirect || {
        echo "HINWEIS: certbot fehlgeschlagen (DNS zeigt evtl. noch nicht auf diesen Server)."
        echo "         Später manuell: sudo certbot --nginx -d $DOMAIN"
      }
    fi
  else
    echo "nginx-Einrichtung übersprungen — Anleitung: README.md Abschnitt 4."
    echo
    echo "  ACHTUNG: Die App komprimiert NICHT selbst (next.config.ts:"
    echo "  compress: false) — das übernimmt der Reverse Proxy. Ohne einen"
    echo "  solchen gehen alle Antworten unkomprimiert raus, also grob das"
    echo "  Dreifache an Bytes. Entweder nginx nach README §4 einrichten oder"
    echo "  in next.config.ts wieder compress: true setzen."
  fi
fi

log "Ersteinrichtung abgeschlossen"
echo "Website (lokal):  http://127.0.0.1:${PORT:-3000}"
echo "Admin-Login:      ${BASE_URL:-http://127.0.0.1:${PORT:-3000}}/admin"
echo "Updates künftig:  ./deploy.sh"
echo
echo "Empfohlene nächste Schritte:"
echo "  - Backup-Cron:   crontab -e  →  30 3 * * * $PWD/deploy/backup.sh"
echo "  - GeoIP-Daten:   $PWD/scripts/update-geoip.sh"
echo "  - Rechtstexte (Datenschutz/Impressum) im Admin unter „Seiten“ einpflegen"
