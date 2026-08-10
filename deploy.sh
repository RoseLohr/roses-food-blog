#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Roses Food Blog — One-Liner-Deployment
#
#   ./deploy.sh
#
# Führt idempotent aus: git pull, Image-Build, DB-Backup, Container-Neustart
# (Migrationen laufen im Container-Entrypoint), Healthcheck, Statusausgabe.
# Erkennt den Erstlauf selbst (fehlende .env, fehlende Volumes, Autostart).
# ---------------------------------------------------------------------------
set -euo pipefail

# Das komplette Skript läuft in einer Funktion: bash liest so die ganze Datei
# ein, BEVOR etwas ausgeführt wird — wichtig, weil der git pull unten dieses
# Skript selbst aktualisieren kann.
main() {

cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"
SECONDS=0   # Gesamtdauer fürs Abschluss-Log

# Live-Rückmeldung fürs Admin-Panel (Bereich „Aktualisierung“): deploy.sh
# schreibt fortlaufend eine Statusdatei (aktuelle Phase, läuft ja/nein, Ergebnis)
# und ein Log. Das Panel pollt beides und zeigt so, dass wirklich etwas passiert.
DEPLOY_STATUS_RESULT=""        # während des Laufs unbekannt
DEPLOY_PHASE="gestartet"
DEPLOY_RUNNING=1
_status_ready() { [[ -n "${DATA_DIR:-}" && -d "${DATA_DIR:-/nonexistent}" ]]; }
# Zeitstempel in MILLISEKUNDEN (wie Date.now() im Panel). Früher wurde auf
# Sekunden gerundet (…000) — dann konnte status.at knapp KLEINER als der
# Auslöse-Zeitpunkt (ms) sein und das Panel den frischen Status als „alt“
# verwerfen (Dauer-„startet gleich …“). Millisekunden vermeiden das.
_now_ms() { local ms; ms=$(date +%s%3N 2>/dev/null); [[ "$ms" =~ ^[0-9]+$ ]] && printf '%s' "$ms" || printf '%s000' "$(date +%s)"; }
status_write() {
  _status_ready || return 0
  local running=false; [[ "$DEPLOY_RUNNING" == "1" ]] && running=true
  local phase=${DEPLOY_PHASE//\\/\\\\}; phase=${phase//\"/\\\"}
  printf '{"at":%s,"running":%s,"phase":"%s","result":"%s","commit":"%s"}\n' \
    "$(_now_ms)" "$running" "$phase" "$DEPLOY_STATUS_RESULT" "${COMMIT:-}" \
    > "$DATA_DIR/deploy-status.json" 2>/dev/null || true
}
deploy_log() {
  _status_ready && printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" \
    >> "$DATA_DIR/deploy.log" 2>/dev/null || true
}
# Protokoll ROTIEREN statt überschreiben. Früher begann jeder Lauf mit
# `: > deploy.log` — nach dem nächsten Deploy war jede Spur des vorigen weg.
# Beim Ausfall 2026-08-10 fehlte deshalb genau das Protokoll des auslösenden
# Deploys. Die letzten zehn Läufe bleiben datiert erhalten; das Panel liest
# unverändert deploy.log (den laufenden).
rotate_deploy_log() {
  _status_ready || return 0
  # Nach einem Selbst-exec NICHT erneut rotieren: das ist derselbe logische
  # Deploy, und der zweite Lauf würde das Protokoll der Vorprüfung (inkl.
  # git-Ausgabe) wegrotieren — im selben Sekundentakt sogar über das eben
  # angelegte Archiv des VORIGEN Laufs. Genau die Forensik, die hier bewahrt
  # werden soll, ginge verloren (Befund gpt-5.6-sol, PR #57, Runde 5).
  if [[ "${DEPLOY_SELBSTUPDATE:-0}" == "1" ]]; then return 0; fi
  if [[ -s "$DATA_DIR/deploy.log" ]]; then
    # Kollisionsfreier Archivname: zwei Läufe in derselben Sekunde dürfen sich
    # nicht gegenseitig überschreiben. mv -n statt -f als zweite Sicherung.
    local ziel="$DATA_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
    local lauf=1
    while [[ -e "$ziel" ]]; do
      ziel="$DATA_DIR/deploy-$(date +%Y%m%d-%H%M%S)-$lauf.log"
      lauf=$((lauf + 1))
    done
    mv -n "$DATA_DIR/deploy.log" "$ziel" 2>/dev/null || true
    ls -1t "$DATA_DIR"/deploy-*.log 2>/dev/null | tail -n +11 | xargs -r rm -f || true
  fi
  : > "$DATA_DIR/deploy.log" 2>/dev/null || true
}
# EXIT-Trap: Ergebnis festhalten (leer = wir haben das Ende nie erreicht).
write_deploy_status() {
  DEPLOY_RUNNING=0
  [[ -z "$DEPLOY_STATUS_RESULT" ]] && DEPLOY_STATUS_RESULT="fehlgeschlagen"
  [[ "$DEPLOY_STATUS_RESULT" == "erfolgreich" ]] \
    && DEPLOY_PHASE="abgeschlossen" || DEPLOY_PHASE="fehlgeschlagen"
  deploy_log "Deployment $DEPLOY_STATUS_RESULT."
  status_write
}
trap write_deploy_status EXIT

# log()/fail() ZUERST definieren — damit auch frühe Fehler (fehlende Tools,
# fehlende .env) über die Statusdatei im Panel landen. Wird deploy.sh vom
# Panel-Watcher (systemd) angestoßen, sieht man so den ECHTEN Grund statt nur
# „Server reagiert nicht“.
log()  {
  printf '\n\033[1;32m==> %s\033[0m\n' "$*"
  DEPLOY_PHASE="$*"
  deploy_log "$*"
  status_write
}
fail() {
  printf '\n\033[1;31mFEHLER: %s\033[0m\n' "$*"
  DEPLOY_PHASE="Fehler: $*"
  deploy_log "FEHLER: $*"
  status_write
  exit 1
}

# DATA_DIR so FRÜH wie möglich auflösen, damit ab hier jeder Fehler sichtbar
# wird. .env liefert DATA_DIR/PORT; fehlt sie, greift der Standardpfad (wie in
# compose.yml). Die verpflichtende .env-Prüfung folgt gleich darunter.
if [[ -f .env ]]; then
  # nur einfache KEY=VALUE-Zeilen laden
  set -a; source <(grep -E '^[A-Z_]+=' .env); set +a
fi
DATA_DIR="${DATA_DIR:-/srv/roses-blog/data}"
PORT="${PORT:-3000}"
mkdir -p "$DATA_DIR" 2>/dev/null || true

# Sofortiger Herzschlag ans Panel: „angenommen, läuft an“. Ohne diesen Status
# würde ein Abbruch VOR Abschnitt 0 (z. B. podman nicht im PATH des systemd-
# Dienstes) gar keinen Status schreiben — das Panel meldete dann fälschlich
# „Watcher läuft nicht“, obwohl er sehr wohl lief.
rotate_deploy_log
DEPLOY_RUNNING=1; DEPLOY_STATUS_RESULT=""
log "Deployment angenommen — Umgebung wird geprüft"

# Deployt standardmäßig den aktuell ausgecheckten Branch (Override: DEPLOY_BRANCH)
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
[[ "$CURRENT_BRANCH" == "HEAD" ]] && CURRENT_BRANCH="main"
BRANCH="${DEPLOY_BRANCH:-$CURRENT_BRANCH}"
COMPOSE="podman compose"
command -v podman >/dev/null \
  || fail "podman nicht gefunden. PATH des Dienstes: ${PATH}"
podman compose version >/dev/null 2>&1 || {
  command -v podman-compose >/dev/null && COMPOSE="podman-compose" \
    || fail "Weder 'podman compose' noch 'podman-compose' im PATH (${PATH}). Installation: sudo apt install podman-compose"
}

# --- 0. .env verpflichtend --------------------------------------------------
if [[ ! -f .env ]]; then
  fail "Keine .env gefunden. Ersteinrichtung: cp .env.example .env und Werte befüllen (siehe README.md)."
fi

for var in BASE_URL SESSION_SECRET ADMIN_EMAIL ADMIN_PASSWORD; do
  [[ -n "${!var:-}" ]] || fail ".env unvollständig: $var ist nicht gesetzt."
done

# --- 0b. Selbstschutz: nicht unter einer Unit deployen, die den Container tötet ---
# Läuft dieser Deploy INNERHALB des systemd-Dienstes (Panel-Auslösung), dann
# entscheidet dessen KillMode darüber, ob der frisch gestartete Container das
# Ende dieses Laufs überlebt. Beim Default control-group räumt systemd die
# cgroup ab und erschießt conmon + rootlessport — exakt der Ausfall vom
# 2026-08-10, bei dem der Deploy „erfolgreich" meldete und die Seite 90 s
# später elf Stunden lang tot war.
# Fail-closed: lieber gar nicht deployen als die Seite umbringen.
#
# Erkennung des eigenen Kontexts über die cgroup UND INVOCATION_ID: die
# reparierte Unit entfernt INVOCATION_ID bewusst, die alte (gefährliche) setzt
# sie — beide Wege zusammen decken jeden Fall ab.
#
# Geprüft wird das EFFEKTIVE, von systemd GELADENE KillMode, nicht der Text der
# Unit-Datei (Befund gpt-5.6-sol, PR #57): Eine korrigierte Datei, für die noch
# kein `daemon-reload` lief, wäre wirkungslos — systemd benutzt dann weiterhin
# die alte Konfiguration und tötet den Container trotzdem. Ebenso könnte ein
# Drop-in (…service.d/*.conf) KillMode wieder auf control-group setzen, ohne die
# Datei anzufassen. `systemctl show` liefert genau den Wert, der beim Stoppen
# wirklich zählt; `NeedDaemonReload=yes` bedeutet „Datei und geladener Stand
# weichen ab" und ist deshalb ebenfalls ein Abbruchgrund. Leere Antwort (kein
# systemctl erreichbar) ist ungleich „process" und blockiert damit auch.
# Geprüft wird die Unit, die DIESEN Prozess tatsächlich umschließt — nicht
# pauschal roses-blog-deploy.service (Befund gpt-5.6-sol, PR #57, Runde 3):
# INVOCATION_ID setzt JEDE systemd-Unit. Würde deploy.sh aus einer anderen Unit
# heraus gestartet (eigener Dienst, Timer, systemd-run, Automatisierung), prüfte
# der Wächter den KillMode der falschen Unit und ließe den Lauf durch, während
# die echte, umschließende Unit mit dem Default control-group den Container nach
# ExecStart erschießt. Die eigene Unit steht in der cgroup-Zeile des Prozesses.
# Die cgroup-Zeile trägt die Unit — in BEIDEN Hierarchien:
#   cgroup v2: "0::/user.slice/…/foo.service"
#   cgroup v1: "1:name=systemd:/user.slice/…/foo.service" (plus weitere Zeilen)
# Der Ausdruck schneidet in beiden Fällen das Präfix ab; danach zählt der letzte
# Pfadbestandteil, sofern er wie eine Unit bzw. Scope aussieht. Nur v2 zu lesen
# ließ auf v1 die gesamte Prüfung aus (Befund gpt-5.6-sol, PR #57, Runde 4).
EIGENE_UNIT=""
if [[ -r /proc/self/cgroup ]]; then
  EIGENE_UNIT="$(sed -n 's#^[0-9]\+:[^:]*:##p' /proc/self/cgroup 2>/dev/null \
    | awk -F/ '{print $NF}' | grep -E '\.(service|scope)$' | head -1)" \
    || EIGENE_UNIT=""
fi

# Welche Unit wird geprüft? Normalfall: die eigene.
PRUEF_UNIT="$EIGENE_UNIT"

if [[ -z "$PRUEF_UNIT" ]]; then
  # Unit nicht bestimmbar. Zwei Fälle, streng getrennt:
  UNIT_ZUSTAND="$(systemctl --user is-active roses-blog-deploy.service 2>/dev/null)" \
    || UNIT_ZUSTAND=""
  if [[ -n "${INVOCATION_ID:-}" ]]; then
    # (a) Irgendeine FREMDE Unit umschließt uns (nur die reparierte Panel-Unit
    #     entfernt INVOCATION_ID). Welche, wissen wir nicht → unsicher.
    fail "Abbruch VOR jedem Eingriff: Dieser Lauf läuft in einer systemd-Unit
  (INVOCATION_ID gesetzt), aber die umschließende Unit ist nicht bestimmbar.
  Ohne sie lässt sich nicht prüfen, ob der Container das Ende dieses Laufs
  überlebt — unbekannt gilt als unsicher.
  Deploy stattdessen IM TERMINAL ausführen:
    cd $SCRIPT_DIR && git pull && FORCE_DEPLOY=1 ./deploy.sh"
  fi
  if [[ "$UNIT_ZUSTAND" == "activating" || "$UNIT_ZUSTAND" == "active" ]]; then
    # (b) INVOCATION_ID fehlt UND die Panel-Unit läuft gerade: Genau das ist die
    #     reparierte Unit, die die Variable selbst entfernt — wir sind also mit
    #     hoher Wahrscheinlichkeit sie. Statt blind durchzuwinken (das war die
    #     Lücke auf cgroup v1) wird ihr Zustand geprüft.
    PRUEF_UNIT="roses-blog-deploy.service"
  fi
fi

# Eine .scope ist eine interaktive Sitzung (SSH/Login) — dort räumt niemand
# nach dem Skriptende auf. Nur echte .service-Units sind gefährlich.
if [[ "$PRUEF_UNIT" == *.service ]]; then
  KILLMODE_EFFEKTIV="$(systemctl --user show "$PRUEF_UNIT" \
    --property=KillMode --value 2>/dev/null)" || KILLMODE_EFFEKTIV=""
  RELOAD_NOETIG="$(systemctl --user show "$PRUEF_UNIT" \
    --property=NeedDaemonReload --value 2>/dev/null)" || RELOAD_NOETIG=""
  # BEIDE Hälften fail-closed: nur die ausdrücklichen Gutwerte („process" bzw.
  # „no") lassen den Lauf durch. Ein Abfragefehler oder eine leere Antwort ist
  # ein UNBEKANNTER Zustand und blockiert — vorher wurde NeedDaemonReload nur
  # gegen „yes" geprüft, wodurch ein fehlgeschlagener Aufruf still durchlief
  # (Befund gpt-5.6-sol, PR #57, Runde 2).
  if [[ "$KILLMODE_EFFEKTIV" != "process" || "$RELOAD_NOETIG" != "no" ]]; then
    fail "Abbruch VOR jedem Eingriff: Dieser Lauf läuft im systemd-Dienst
  '$PRUEF_UNIT', der den Container beim Beenden töten würde.
  Effektives KillMode: '${KILLMODE_EFFEKTIV:-unbekannt}' (nötig: genau 'process');
  NeedDaemonReload: '${RELOAD_NOETIG:-unbekannt}' (nötig: genau 'no').
  Unbekannt bedeutet: nicht abfragbar — das gilt als unsicher, nicht als in Ordnung.
  Ein Deploy von hier aus schaltete die Seite ~90 s nach der Erfolgsmeldung ab.
  Einmalig IM TERMINAL ausführen, dann ist die Panel-Aktualisierung wieder sicher:
    cd $SCRIPT_DIR && git pull && FORCE_DEPLOY=1 ./deploy.sh && systemctl --user daemon-reload"
  fi
fi

# --- 1. Git pull ------------------------------------------------------------
if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  log "Hole aktuellen Stand (Branch: $BRANCH)"
  SELBST_VORHER="$(sha256sum "$SCRIPT_DIR/deploy.sh" | cut -d' ' -f1)"
  git fetch origin "$BRANCH"
  git checkout -q "$BRANCH"
  git pull --ff-only origin "$BRANCH"
  # SELBST-AKTUALISIERUNG: main() umschließt das ganze Skript, damit bash es
  # VOLLSTÄNDIG liest, bevor der Pull es überschreibt — sonst führte bash eine
  # halb alte, halb neue Datei aus. Die Kehrseite: der restliche Lauf ist immer
  # noch der ALTE Code. Er würde u. a. in Abschnitt 7c die ALTE systemd-Unit
  # zurückschreiben, also ausgerechnet eine Korrektur an der Unit sofort wieder
  # zunichtemachen. Hat der Pull dieses Skript geändert, übernimmt daher der
  # neue Stand per exec (einmalig, gegen Endlosschleife abgesichert).
  if [[ "$(sha256sum "$SCRIPT_DIR/deploy.sh" | cut -d' ' -f1)" != "$SELBST_VORHER" \
        && "${DEPLOY_SELBSTUPDATE:-0}" != "1" ]]; then
    log "deploy.sh hat sich selbst aktualisiert — starte mit dem neuen Stand neu"
    export DEPLOY_SELBSTUPDATE=1 SKIP_PULL=1
    exec /usr/bin/env bash "$SCRIPT_DIR/deploy.sh" "$@"
  fi
fi
COMMIT="$(git rev-parse --short HEAD)"

# --- 1b. Schnellpfad: nichts zu tun? ------------------------------------------
# Läuft der Container bereits gesund mit exakt diesem Commit und derselben
# .env, ist ein kompletter Rebuild + Neustart Verschwendung (und unnötige
# Downtime). Der Zustand des letzten erfolgreichen Deployments steht in
# $DATA_DIR/deploy-state. Übersprungen wird nur, wenn ALLES passt; FORCE_DEPLOY=1
# erzwingt den vollen Lauf, SKIP_PULL=1 (lokale Änderungen) deaktiviert ihn.
ENV_HASH="$(sha256sum .env | cut -d' ' -f1)"
STATE_FILE="$DATA_DIR/deploy-state"
# Welcher Stand läuft WIRKLICH? /health liefert den APP_COMMIT des Images
# (src/app/health/route.ts). Früher wurde die Antwort nach /dev/null geworfen
# und nur „irgendein Container läuft" geprüft — nach einem Rollback zeigte
# deploy-state aber weiterhin den NEUEN Commit, während das ALTE Image lief.
# deploy.sh meldete dann „Bereits aktuell", und der Server blieb ohne Warnung
# dauerhaft auf dem alten Stand (Vorfall 2026-08-10). Leere Antwort oder
# fehlendes Feld ⇒ Ungleichheit ⇒ voller Lauf (fail-closed).
# Das abschließende `|| LAUFENDER_COMMIT=""` ist ZWINGEND: unter `set -euo
# pipefail` ist der Status einer Zuweisung der der Kommandosubstitution, und
# pipefail reicht curls Exit 7 (Verbindung verweigert) durch — das Skript wäre
# sonst genau dann kommentarlos gestorben, wenn die App NICHT läuft, also im
# Wiederherstellungsfall. Empirisch nachgestellt, nicht vermutet.
LAUFENDER_COMMIT="$(curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null \
  | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" \
  || LAUFENDER_COMMIT=""
if [[ "${FORCE_DEPLOY:-0}" != "1" && "${SKIP_PULL:-0}" != "1" \
      && -z "$(git status --porcelain 2>/dev/null)" \
      && -f "$STATE_FILE" \
      && "$(cat "$STATE_FILE" 2>/dev/null)" == "$COMMIT $ENV_HASH" \
      && "$LAUFENDER_COMMIT" == "$COMMIT" ]] \
   && podman image exists localhost/roses-blog:latest 2>/dev/null \
   && [[ "$(podman inspect -f '{{.State.Running}}' roses-blog 2>/dev/null)" == "true" ]]; then
  rm -f "$DATA_DIR/deploy-request" 2>/dev/null || true
  DEPLOY_STATUS_RESULT="erfolgreich"
  log "Bereits aktuell (Commit $COMMIT) — Container läuft, kein Neustart nötig (${SECONDS}s)"
  echo "Branch:   $BRANCH"
  echo "Commit:   $COMMIT"
  podman ps --filter name=roses-blog --format "Container: {{.Names}} ({{.Status}})"
  echo "Hinweis:  FORCE_DEPLOY=1 ./deploy.sh erzwingt Rebuild + Neustart."
  return 0
fi

# --- 2. Erstlauf: Datenverzeichnisse ----------------------------------------
if [[ ! -d "$DATA_DIR" ]]; then
  log "Erstlauf: lege Datenverzeichnis $DATA_DIR an"
  mkdir -p "$DATA_DIR"/{uploads,geoip,backups} \
    || fail "Konnte $DATA_DIR nicht anlegen (ggf. einmalig: sudo mkdir -p $DATA_DIR && sudo chown \$USER $DATA_DIR)"
fi
mkdir -p "$DATA_DIR"/{uploads,geoip,backups}

# Etwaige Deploy-Anfrage aus dem Admin-Panel als "verbraucht" markieren
# (der Watcher-Dienst entfernt sie ebenfalls; hier für manuelle Läufe).
rm -f "$DATA_DIR/deploy-request" 2>/dev/null || true

# Start markieren. Das Protokoll wurde oben bereits rotiert und enthält seither
# die Vorprüfung samt git-Ausgabe — die gehört zum Lauf und wird NICHT verworfen.
DEPLOY_RUNNING=1; DEPLOY_STATUS_RESULT=""
log "Deployment gestartet (Commit $(git rev-parse --short HEAD 2>/dev/null || echo '?'))"

# --- 3. Image bauen ----------------------------------------------------------
# CPU-Check: sharps native Binärdatei braucht SSE4.2 (x86-64-v2). Fehlt das
# Flag (alte CPUs wie Intel Atom/Bonnell, VMs mit qemu64/kvm64-CPU-Typ),
# nutzt die Bildpipeline stattdessen die Debian-libvips-CLI (LOW_CPU-Image).
LOW_CPU="${FORCE_LOW_CPU:-0}"
if [[ "$LOW_CPU" != "1" ]] && ! grep -qm1 sse4_2 /proc/cpuinfo; then
  LOW_CPU=1
  echo "HINWEIS: CPU ohne SSE4.2 erkannt — baue LOW_CPU-Image"
  echo "         (Bildverarbeitung über Debians libvips-CLI statt sharp)."
fi

# Persistente Build-Caches auf dem Host (NO_CACHE=1 schaltet beides ab):
#  - npm-Cache: npm ci lädt Pakete nur noch einmal herunter
#  - Turbopack-Cache (.next/cache): next build kompiliert nur Geändertes neu
#    (next.config.ts: experimental.turbopackFileSystemCacheForBuild)
# `podman build -v` blendet die Host-Verzeichnisse nur während der RUN-Schritte
# ein — sie landen NICHT im Image.
BUILD_OPTS=(--build-arg "APP_COMMIT=$COMMIT" --build-arg "LOW_CPU=$LOW_CPU" -f Containerfile)
if [[ "${NO_CACHE:-0}" != "1" ]]; then
  mkdir -p "$DATA_DIR/build-cache/npm" "$DATA_DIR/build-cache/next"
  BUILD_OPTS+=(-v "$DATA_DIR/build-cache/npm:/root/.npm" \
               -v "$DATA_DIR/build-cache/next:/app/.next/cache")
else
  BUILD_OPTS+=(--no-cache)
fi

# Die Zwischen-Stages (deps, build) zusätzlich taggen: ungetaggt wären sie
# "dangling" und `podman image prune` (Abschnitt 8) würde sie samt Layer-Cache
# entfernen — dann liefe npm ci bei JEDEM Deployment komplett neu. Mit Tag
# bleibt der Cache erhalten; npm ci läuft nur noch, wenn sich
# package-lock.json ändert. Die Extra-Builds kosten nichts: alle drei
# Aufrufe teilen sich denselben Layer-Cache.
log "Baue Container-Image (Commit $COMMIT)"
podman build "${BUILD_OPTS[@]}" --target deps -t localhost/roses-blog:cache-deps . \
  || fail "Image-Build fehlgeschlagen (Stufe: Abhängigkeiten/npm ci)."
podman build "${BUILD_OPTS[@]}" --target build -t localhost/roses-blog:cache-build . \
  || fail "Image-Build fehlgeschlagen (Stufe: App-Build/next build)."
# Rollback-Vorbereitung (A-06/B-11): das aktuell laufende :latest als :previous
# sichern, BEVOR es überschrieben wird — so kann deploy/rollback.sh es in
# Sekunden zurückrollen (samt DB-Backup aus Abschnitt 4).
if podman image exists localhost/roses-blog:latest 2>/dev/null; then
  podman tag localhost/roses-blog:latest localhost/roses-blog:previous || true
fi
podman build "${BUILD_OPTS[@]}" -t localhost/roses-blog:latest . \
  || fail "Image-Build fehlgeschlagen (Stufe: Laufzeit-Image)."

# --- 4. DB-Backup vor Migration/Neustart -------------------------------------
if [[ -f "$DATA_DIR/app.db" ]]; then
  log "Sichere Datenbank vor dem Update"
  BACKUP_FILE="$DATA_DIR/backups/pre-deploy-$(date +%Y%m%d-%H%M%S).db"
  # --entrypoint node: das Image-Entrypoint (entry.sh) startet sonst den Server
  # und ignoriert diese Argumente.
  podman run --rm --entrypoint node -v "$DATA_DIR:/data" localhost/roses-blog:latest \
    -e "const db=require('better-sqlite3')('/data/app.db',{readonly:true});db.backup('/data/backups/'+process.argv[1]).then(()=>{db.close();console.log('Backup ok')}).catch(e=>{console.error(e);process.exit(1)})" \
    "$(basename "$BACKUP_FILE")" || fail "DB-Backup fehlgeschlagen — Deployment abgebrochen."
  # Nur die letzten 10 Pre-Deploy-Backups behalten (Best-Effort — ein leerer
  # Glob würde sonst wegen pipefail das ganze Deployment abbrechen)
  ls -1t "$DATA_DIR"/backups/pre-deploy-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f || true
fi

# --- 5. Container (neu) starten — Migrationen laufen im Entrypoint ----------
log "Stoppe alten Container (falls vorhanden) und gebe Port $PORT frei"
# Erst über Compose herunterfahren; anschließend den Container zusätzlich
# direkt per Namen entfernen. Nötig, weil ein früherer Lauf ihn mit einem
# anderen Compose-Provider (podman-compose vs. docker-compose) angelegt
# haben kann — dann kennt der aktuelle Provider ihn nicht und der Port
# bliebe belegt ("address already in use").
$COMPOSE down --remove-orphans >/dev/null 2>&1 || true
podman rm -f roses-blog >/dev/null 2>&1 || true

# Falls trotzdem noch etwas auf dem Port lauscht: klar melden statt kryptisch
# zu scheitern. (Rootless-Leftover, oder ein fremder Dienst auf Port $PORT.)
if command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :$PORT )" 2>/dev/null | grep -q ":$PORT"; then
  echo
  echo "WARNUNG: Port $PORT ist noch belegt."
  # Verbliebene Container suchen, die den Port veröffentlichen (podman kennt den
  # 'publish'-Filter nicht — daher über die Portspalte statt --filter).
  podman ps -a --format '{{.ID}} {{.Names}} {{.Ports}}' 2>/dev/null \
    | grep ":$PORT->" | awk '{print $1}' | xargs -r podman rm -f >/dev/null 2>&1 || true
  sleep 2
  if ss -ltn "( sport = :$PORT )" 2>/dev/null | grep -q ":$PORT"; then
    fail "Port $PORT ist weiterhin belegt (evtl. anderer Dienst). Prüfen: sudo ss -ltnp 'sport = :$PORT'"
  fi
fi

# Preflight: kann der Container das Datenverzeichnis UND die Datenbankdatei
# beschreiben? Erst testen, nur bei Fehlschlag reparieren: die rekursive
# Besitz-Normalisierung (unshare chown über ALLE Uploads/Backups) kann bei
# großen Datenbeständen Minuten dauern und ist nur nötig, wenn ein früherer
# Container Dateien unter fremder Uid hinterlassen hat ("attempt to write a
# readonly database"). 'podman unshare chown 0:0' setzt sie im User-Namespace
# auf den Host-User zurück.
data_write_test() {
  podman run --rm --entrypoint sh -v "$DATA_DIR:/data" localhost/roses-blog:latest \
    -c 'touch /data/.write-test && rm -f /data/.write-test \
        && { [ ! -f /data/app.db ] \
             || dd if=/dev/null of=/data/app.db oflag=append conv=notrunc status=none; }' \
    >/dev/null 2>&1
}
if ! data_write_test; then
  log "Datenverzeichnis nicht (voll) beschreibbar — normalisiere Besitz"
  podman unshare chown -R 0:0 "$DATA_DIR" >/dev/null 2>&1 || true
  data_write_test || fail "Container kann $DATA_DIR nicht beschreiben. Rootless betreiben \
(podman als Nicht-root-User), oder einmalig: podman unshare chown -R 0:0 \"$DATA_DIR\"."
fi

log "Starte Container neu"
$COMPOSE up -d --force-recreate app

# --- 6. Healthcheck -----------------------------------------------------------
log "Warte auf Healthcheck (http://127.0.0.1:$PORT/health)"
# 1-s-Takt statt 2 s: gleiche Obergrenze (~60 s), aber die App wird bis zu eine
# Sekunde früher als bereit erkannt → kürzeres Umschaltfenster (weniger Downtime).
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    HEALTH_OK=1; break
  fi
  sleep 1
done
if [[ "${HEALTH_OK:-0}" != "1" ]]; then
  echo
  echo "Letzte Container-Logs:"
  podman logs --tail 40 roses-blog || true
  fail "Healthcheck fehlgeschlagen. Vollständige Logs: podman logs roses-blog"
fi

# --- 7. Autostart nach Reboot -------------------------------------------------
# Zwei unabhängige Voraussetzungen — beide bei JEDEM Lauf sicherstellen, sonst
# startet der Container nach einem Reboot nicht (Autostart still kaputt).
# (a) User-Service podman-restart.service (startet Container mit restart:always)
if ! systemctl --user is-enabled podman-restart.service >/dev/null 2>&1; then
  log "Aktiviere Autostart-Service (podman-restart.service)"
  systemctl --user enable --now podman-restart.service >/dev/null 2>&1 \
    || echo "HINWEIS: podman-restart.service nicht aktivierbar — siehe deploy/roses-blog.service"
fi
# (b) Linger — ohne das startet der User-systemd-Manager beim Boot nicht,
# der Service liefe nie. Bei jedem Lauf explizit prüfen (nicht still schlucken).
# $USER ist nicht in jeder Umgebung gesetzt (cron, minimale systemd-Units) —
# unter `set -u` bräche das Skript sonst hier ab.
DEPLOY_USER="${USER:-$(id -un)}"
if [[ "$(loginctl show-user "$DEPLOY_USER" --property=Linger --value 2>/dev/null)" != "yes" ]]; then
  if loginctl enable-linger "$DEPLOY_USER" >/dev/null 2>&1; then
    echo "Autostart: Linger für $DEPLOY_USER aktiviert."
  else
    echo "WARNUNG: Linger konnte nicht aktiviert werden — Autostart nach Reboot INAKTIV."
    echo "         Einmalig ausführen: sudo loginctl enable-linger $DEPLOY_USER"
  fi
fi

# --- 7c. Deploy-Watcher: Aktualisierung aus dem Admin-Panel ------------------
# Ein Klick im Panel schreibt $DATA_DIR/deploy-request. Dieser systemd-User-
# Path-Unit erkennt die Datei und startet EINMALIG das feste Kommando
# ./deploy.sh (keine Parameter aus dem Container — die Isolation bleibt
# gewahrt). So lässt sich ohne Terminal-Zugriff neu deployen.
if command -v systemctl >/dev/null 2>&1; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/roses-blog-deploy.service" <<EOF
[Unit]
Description=Roses Food Blog – Pull & Deploy (aus dem Admin-Panel angestoßen)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$SCRIPT_DIR
# WICHTIG: Ein systemd-User-Dienst startet mit MINIMALEM PATH — ohne
# ~/.local/bin (dort liegt z. B. ein per pip installiertes podman-compose)
# und ggf. ohne /usr/local/bin. deploy.sh bräche dann schon an der
# podman/podman-compose-Prüfung ab (Symptom: Panel meldet „Server reagiert
# nicht“, während der manuelle Aufruf im Terminal problemlos läuft). Wir
# setzen daher einen vollständigen PATH — die Standardorte plus den PATH,
# den der installierende Aufruf hatte.
Environment=HOME=$HOME
Environment=PATH=$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH
#
# LEBENSDAUER DES CONTAINERS VON DER DES DIENSTES ENTKOPPELN
# (Produktionsausfall 2026-08-10, ~11 h Totalausfall — Root Cause):
# Ein oneshot-Dienst gilt nach ExecStart als beendet; systemd räumt dann seine
# Control-Group ab. Der frisch gestartete Container lag mit conmon und
# rootlessport GENAU IN DIESER cgroup und wurde mitgerissen:
#     roses-blog-deploy.service: State 'stop-sigterm' timed out. Killing.
#     Killing process … (rootlessport) with signal SIGKILL.
#     Killing process … (conmon)      with signal SIGKILL.
# 90 s nach der Erfolgsmeldung war die Seite tot, und `restart: always` konnte
# nicht greifen, weil der Supervisor (conmon) selbst erschossen war.
# Zwei Maßnahmen, absichtlich beide — die TRAGENDE ist die erste:
#  1. `KillMode=process`. Der rekursive cgroup-Kill hängt in systemd an
#     KillMode=control-group (Default) bzw. mixed; bei `process` signalisiert
#     systemd ausschließlich den Hauptprozess — conmon und rootlessport werden
#     nie angefasst. Wer diese Zeile wegräumt, stellt den Ausfall wieder her.
#     (`mixed` wäre SCHLIMMER als der Default: die SIGTERM-Phase fände nichts,
#     systemd eskalierte sofort zu SIGKILL, und der Container stürbe in
#     Millisekunden statt nach 90 s. `none` ist seit systemd v249 abgekündigt.)
#  2. `env -u INVOCATION_ID` ergänzt das strukturell: an dieser Variablen
#     erkennt podman eine umgebende Unit und überspringt dann das Verschieben
#     von conmon in eine eigene transiente Scope (libpod-conmon-<id>.scope).
#     Ohne sie verhält sich podman wie beim interaktiven Start. Das ist
#     allerdings undokumentiertes podman-Innenleben, setzt cgroup_manager=systemd
#     und einen erreichbaren Benutzer-D-Bus voraus und kann still ausbleiben —
#     deshalb Ergänzung, nicht Fundament.
# tests/deploy-betrieb.test.ts hält beide Zeilen fest.
KillMode=process
# Anfrage vor dem Lauf entfernen, damit der Path-Unit erneut auslösen kann.
ExecStartPre=-/usr/bin/rm -f $DATA_DIR/deploy-request
ExecStart=/usr/bin/env -u INVOCATION_ID bash $SCRIPT_DIR/deploy.sh
EOF
  cat > "$UNIT_DIR/roses-blog-deploy.path" <<EOF
[Unit]
Description=Beobachtet Deploy-Anfragen aus dem Admin-Panel (Roses Food Blog)

[Path]
PathExists=$DATA_DIR/deploy-request
Unit=roses-blog-deploy.service

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  if systemctl --user enable --now roses-blog-deploy.path >/dev/null 2>&1; then
    echo "Panel-Deploy: Watcher aktiv (roses-blog-deploy.path)."
  else
    echo "HINWEIS: Deploy-Watcher nicht aktivierbar — Panel-Aktualisierung inaktiv."
  fi
fi

# --- 8. Aufräumen: alte, nun unbenutzte Images entfernen ---------------------
# Jeder Build hinterlässt das vorige Image als dangling <none>; ohne Prune
# läuft die Platte voll. Nur dangling entfernen — das laufende Image bleibt.
podman image prune -f >/dev/null 2>&1 || true

# --- 9. Status ----------------------------------------------------------------
echo "Branch:   $BRANCH"
echo "Commit:   $COMMIT"
# Finaler Health-Gate: der autoritative Healthcheck (Abschnitt 6) war grün; hier
# kurz erneut bestätigen, dass die App nach Neustart+Prune WIRKLICH noch antwortet.
# Mehrere Versuche absorbieren einen transienten Port-Reinit direkt nach dem
# Neustart (das war das ursprüngliche „erfolgreich + curl (7)"-Symptom — kein
# nacktes `curl && …`, das unter set -e das Skript mit Exit 7 beendet hätte).
# Bleibt /health danach unerreichbar, ist die App NICHT bloß transient weg →
# EHRLICH als Fehlschlag melden (fail-closed), kein „erfolgreich"-Silent-Pass.
FINAL_HEALTH_OK=0
for _ in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then FINAL_HEALTH_OK=1; break; fi
  sleep 1
done
if [[ "$FINAL_HEALTH_OK" != "1" ]]; then
  echo "Letzte Container-Logs:"
  podman logs --tail 30 roses-blog 2>&1 | sed 's/^/  /' || true
  fail "App nach Neustart auf Port $PORT nicht erreichbar (finaler Health-Gate gescheitert) — NICHT als erfolgreich quittiert."
fi

# --- 9b. Stabilitätsfenster: der Container muss den Start ÜBERLEBEN ----------
# „Erfolgreich" hieß bisher nur „ist hochgekommen", nicht „läuft noch". Dieses
# Fenster fängt frühe Absturzschleifen, Speicherprobleme und Startfehler ab, die
# erst nach dem ersten grünen /health auftreten.
#
# EHRLICHE GRENZE (nicht wegdiskutieren): Den systemd-Kill vom 2026-08-10 kann
# dieses Fenster PRINZIPIELL NICHT sehen. Der 90-Sekunden-Stop-Timeout beginnt
# erst, wenn ExecStart endet — dieser Abschnitt läuft aber INNERHALB von
# ExecStart und verschiebt die Stop-Uhr nur nach hinten. Gegen diese Klasse
# wirken KillMode=process in der Unit und der Selbstschutz in Abschnitt 0b,
# nicht dieses Fenster. Die Länge ist deshalb nach dem bemessen, was sie
# wirklich leistet, und nicht an den 90 s ausgerichtet.
STABIL_SEK=30
log "Prüfe Stabilität (${STABIL_SEK}s Fenster — der Container muss den Start überleben)"
for _ in $(seq 1 $((STABIL_SEK / 10))); do
  sleep 10
  if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "Letzte Container-Logs:"
    podman logs --tail 40 roses-blog 2>&1 | sed 's/^/  /' || true
    podman ps -a --filter name=roses-blog --format '  Status: {{.Status}}' || true
    fail "App war erreichbar, ist aber im Stabilitätsfenster wieder ausgefallen — Deployment NICHT erfolgreich. Logs oben prüfen."
  fi
done
# Erst NACH bestandenem Health-Gate: Schnellpfad-State festhalten + Erfolg markieren.
printf '%s %s\n' "$COMMIT" "$ENV_HASH" > "$STATE_FILE" 2>/dev/null || true
DEPLOY_STATUS_RESULT="erfolgreich"   # EXIT-Trap schreibt deploy-status.json
log "Deployment erfolgreich (Dauer: ${SECONDS}s)"
echo "Health:   OK (http://127.0.0.1:$PORT/health)"
podman ps --filter name=roses-blog --format "Container: {{.Names}} ({{.Status}})"

}

main "$@"
