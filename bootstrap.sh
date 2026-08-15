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
  # Ersatz GEQUOTET: seit bash 5.2 steht ein unquotiertes `&` im Ersatzstring
  # für den gefundenen Text (wie bei sed). Ein Passwort mit „&" zerlegte die
  # Zeile sonst still — nachgestellt mit bash 5.2.21.
  env_vorlage=${env_vorlage//@BASE_URL@/"$BASE_URL_OHNE_SLASH"}
  env_vorlage=${env_vorlage//@PORT@/"$PORT"}
  env_vorlage=${env_vorlage//@DATA_DIR@/"$DATA_DIR"}
  env_vorlage=${env_vorlage//@SESSION_SECRET@/"$SESSION_SECRET"}
  env_vorlage=${env_vorlage//@SMTP_HOST@/"$SMTP_HOST"}
  env_vorlage=${env_vorlage//@SMTP_PORT@/"$SMTP_PORT"}
  env_vorlage=${env_vorlage//@SMTP_USER@/"$SMTP_USER"}
  env_vorlage=${env_vorlage//@SMTP_PASS@/"$SMTP_PASS"}
  env_vorlage=${env_vorlage//@SMTP_FROM_ADDR@/"$SMTP_FROM_ADDR"}
  env_vorlage=${env_vorlage//@ADMIN_EMAIL@/"$ADMIN_EMAIL"}
  env_vorlage=${env_vorlage//@ADMIN_PASSWORD@/"$ADMIN_PASSWORD"}
  # Fail-closed: ein nicht ersetzter Platzhalter wäre eine kaputte .env — der
  # Blog startete dann mit „@SESSION_SECRET@" als Schlüssel. Lieber abbrechen.
  #
  # Geprüft wird gegen die NAMENSLISTE, nicht gegen ein Muster wie
  # `*"@"*"@"*`: jede .env enthält zwei E-Mail-Adressen, das Muster träfe also
  # immer. Genau daran ist die erste Fassung gescheitert — der nachfolgende
  # Test lief auf Rückgabewert 1 und `set -e` beendete bootstrap.sh mitten in
  # der Ersteinrichtung, ohne Meldung.
  for platz in @BASE_URL@ @PORT@ @DATA_DIR@ @SESSION_SECRET@ @SMTP_HOST@ \
               @SMTP_PORT@ @SMTP_USER@ @SMTP_PASS@ @SMTP_FROM_ADDR@ \
               @ADMIN_EMAIL@ @ADMIN_PASSWORD@; do
    if [[ "$env_vorlage" == *"$platz"* ]]; then
      fail ".env-Vorlage: Platzhalter $platz wurde nicht ersetzt."
    fi
  done

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
    # nginx-Config nur beim ersten Mal aus der HTTP-Vorlage schreiben. Ein
    # Re-Run darf certbots eingefügten TLS-/443-Block NICHT überschreiben.
    if [[ ! -e /etc/nginx/sites-available/roses-blog ]]; then
      $SUDO tee /etc/nginx/sites-available/roses-blog >/dev/null < <(
        sed -e "s/www\.example\.de example\.de/$DOMAIN/" \
            -e "s/127\.0\.0\.1:3000/127.0.0.1:${PORT:-3000}/" \
            deploy/nginx.conf.example
      )
      $SUDO ln -sf /etc/nginx/sites-available/roses-blog /etc/nginx/sites-enabled/roses-blog
      $SUDO nginx -t
      $SUDO systemctl reload nginx
    else
      echo "nginx-Config existiert bereits — unverändert gelassen."
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
