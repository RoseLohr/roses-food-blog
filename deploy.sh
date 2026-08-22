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
# Gesetzt, wenn der Wachhund-Timer nachweislich NICHT läuft (Abschnitt 7e).
# Ausgewertet ganz am Ende — der Grund steht dort.
WACHHUND_FEHLT=0
# Gesetzt, sobald eine spezifische Alarmnachricht abgesetzt wurde; fail()
# schickt dann keine zweite, allgemeine hinterher.
ALARM_SCHON_GESENDET=0
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
# Alarm über das BEKANNT GUTE Image (:previous), nicht über die Anwendung.
#
# Befund 2 der Gegenprüfung: Startet der Container nach dem Deploy gar nicht,
# erfährt es niemand — der Selbst-Monitor läuft IN der Anwendung, und die ist
# ja tot. Genau im schlimmsten Fall schweigt die Meldekette.
#
# Best-Effort und bewusst nie blockierend: Ein fehlender Alarmweg darf den
# Fehlschlag nicht verschlimmern. Was geschah, steht in jedem Fall im Protokoll.
#
# ── DAS ERSTBESTE IMAGE IST NICHT DAS RICHTIGE ─────────────────────────────
#
# Hier stand: „nimm :previous, sonst :latest". Beim ERSTEN Ausrollen dieser
# Änderung ist :previous aber der Stand von VORHER — und der kennt
# scripts/betriebsalarm.mjs noch gar nicht. podman brach ab, übrig blieb eine
# Zeile im Protokoll, und niemand bekam eine Nachricht. Eine Meldekette, die
# ausgerechnet dann schweigt, wenn sie zum ersten Mal gebraucht wird, ist
# keine (Befund gpt-5.6-sol, PR #110, Runde 3).
#
# Gewählt wird deshalb nicht das erste VORHANDENE Image, sondern das erste, das
# das Alarmskript wirklich enthält. Geprüft wird mit node — nichts anderes
# braucht der Alarm auch. Das Ergebnis wird gemerkt, damit der Fehlerpfad nicht
# zwei zusätzliche Container startet.
ALARM_BILD=""
ALARM_BILD_GEPRUEFT=0
alarm_bild_waehlen() {
  [[ $ALARM_BILD_GEPRUEFT -eq 1 ]] && return 0
  ALARM_BILD_GEPRUEFT=1
  local kandidat
  for kandidat in localhost/roses-blog:previous localhost/roses-blog:latest; do
    podman image exists "$kandidat" 2>/dev/null || continue
    if timeout 30 podman run --rm --entrypoint node "$kandidat" \
         -e "process.exit(require('fs').existsSync('/app/scripts/betriebsalarm.mjs')?0:1)" \
         >/dev/null 2>&1; then
      ALARM_BILD="$kandidat"
      return 0
    fi
    deploy_log "Alarm: $kandidat enthält betriebsalarm.mjs nicht — nächster Kandidat."
  done
  deploy_log "Alarm: KEIN Image enthält betriebsalarm.mjs — es kann keine Nachricht abgesetzt werden."
}
alarm_absetzen() {
  local betreff="$1" text="$2"
  alarm_bild_waehlen
  [[ -n "$ALARM_BILD" ]] || return 0
  # Die SMTP-Zugangsdaten stehen laut README in der `.env`, nicht in der
  # `setting`-Tabelle. Sie stecken in DIESER Shell (oben aus .env geladen), der
  # Alarm läuft aber im CONTAINER — und der bekam bisher nur DATA_DIR. Dann
  # findet betriebsalarm.mjs keinen Host, meldet „NICHT verschickt" und endet
  # mit 0; das `||` unten konnte nie greifen. Derselbe Fehler stand in
  # deploy/wachhund.sh.
  # ── DER NAME AUF DIE BEFEHLSZEILE, DER WERT NICHT ────────────────────────
  #
  # Hier stand `-e "$v=${!v}"`. Damit steht SMTP_PASS im Klartext in der
  # Argumentliste von podman — und die liest jeder lokale Nutzer aus der
  # Prozessliste oder aus /proc/<pid>/cmdline, solange der Alarm läuft
  # (Befund gpt-5.6-sol, PR #110, Runde 7).
  #
  # `-e VAR` OHNE Wert ist die richtige Form: podman nimmt den Wert aus seiner
  # EIGENEN Umgebung und reicht ihn weiter; auf der Befehlszeile steht nur der
  # Name. Das setzt voraus, dass die Variable exportiert ist — .env wird oben
  # mit `set -a` gelesen, aber ein Aufrufer könnte sie auch anders gesetzt
  # haben, deshalb hier ausdrücklich.
  local -a smtp=()
  local v
  for v in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SECURE SMTP_FROM ADMIN_EMAIL; do
    if [[ -n "${!v:-}" ]]; then
      export "${v?}"
      smtp+=("-e" "$v")
    fi
  done
  timeout 60 podman run --rm --entrypoint node -v "$DATA_DIR:/data" \
    -e DATA_DIR=/data "${smtp[@]}" "$ALARM_BILD" \
    /app/scripts/betriebsalarm.mjs "$betreff" "$text" \
    2>&1 | sed 's/^/[alarm] /' || deploy_log "Alarm konnte nicht abgesetzt werden."
}

# Läuft der Wachhund-Timer WIRKLICH? Hinterlegt den Zeugen und setzt
# WACHHUND_FEHLT. Aufgerufen wird sie in Abschnitt 7e; sie steht hier oben als
# eigene Funktion, damit tests/deploy-wachhund-verankerung.test.ts sie gegen
# ein vorgetäuschtes systemctl fahren kann. „Der Deploy merkt es, wenn der
# Wachhund fehlt" ist sonst eine Behauptung über Verhalten, belegt durch einen
# Textvergleich — und genau diese Sorte Wächter ist hier schon zweimal als
# wirkungslos aufgefallen.
wachhund_verankern() {
  local zustand
  zustand="$(systemctl --user is-active roses-blog-wachhund.timer 2>/dev/null || true)"
  if [[ "$zustand" == "active" ]]; then
    printf 'roses-blog-wachhund.timer aktiv, geprueft am %s\n' "$(date -Is)" \
      > "$DATA_DIR/wachhund-ok" 2>/dev/null || true
    echo "Wachhund: aktiv (alle 5 min, roses-blog-wachhund.timer)."
    return 0
  fi
  # Kein Zeuge, wenn die Sache nicht bezeugt ist — und kein Ersatzvorschlag.
  rm -f "$DATA_DIR/wachhund-ok" 2>/dev/null || true
  WACHHUND_FEHLT=1
  echo "FEHLER: Wachhund-Timer NICHT aktiv (Zustand: ${zustand:-unbekannt})."
  echo "        Ohne ihn ist 'restart: always' unbegrenzt — das ist die Lage"
  echo "        vom 2026-08-10. Der Deploy wird deshalb nicht als erfolgreich"
  echo "        quittiert; die Ursache gehört behoben, nicht ersetzt."
  if command -v systemctl >/dev/null 2>&1; then
    echo "        Nachsehen: systemctl --user status roses-blog-wachhund.timer"
  else
    # Der Zustand ist leer, weil es gar kein systemctl gibt. Das ist eine
    # andere Ursache mit derselben Folge — und sie gehört benannt, sonst sucht
    # jemand an einem Timer, den es auf dieser Anlage nie geben kann.
    echo "        Auf dieser Anlage gibt es kein systemctl: Der Wachhund kann"
    echo "        so nicht laufen. Ohne systemd-User-Manager fehlt dem Betrieb"
    echo "        die Obergrenze — das ist eine Frage der Anlage, nicht des"
    echo "        Skripts."
  fi
}

fail() {
  printf '\n\033[1;31mFEHLER: %s\033[0m\n' "$*"
  DEPLOY_PHASE="Fehler: $*"
  deploy_log "FEHLER: $*"
  status_write
  # Nur wenn DATA_DIR schon feststeht — davor gibt es weder Datenbank noch
  # Einstellungen, aus denen ein Empfänger käme.
  #
  # Und nur, wenn nicht schon eine PASSENDERE Nachricht raus ist: Der Text hier
  # nennt den Rollback als nächsten Schritt. Bei einem Fehlschlag, der die
  # Anwendung gar nicht betrifft (fehlender Wachhund), wäre das die falsche
  # Anweisung — zwei Alarme, von denen einer in die Irre führt.
  if [[ -n "${DATA_DIR:-}" && -d "${DATA_DIR:-/nicht/vorhanden}" \
        && "${ALARM_SCHON_GESENDET:-0}" -ne 1 ]]; then
    alarm_absetzen "⚠ Roses Blog — Deployment fehlgeschlagen" \
      "Phase: ${DEPLOY_PHASE}

Das Deployment wurde abgebrochen. Der Server läuft möglicherweise noch auf dem
vorigen Stand — oder gar nicht.

Nächster Schritt: ./deploy/rollback.sh (Protokolle: podman logs roses-blog)"
  fi
  exit 1
}
# Einen langlaufenden Schritt ausführen und seine Ausgabe SOWOHL ins Terminal
# ALS AUCH ins Protokoll schreiben.
#
# WARUM (Fehlschlag 2026-08-16): `log()`/`fail()` hielten nur die Phasentexte
# fest. Die Ausgabe der Kommandos, die tatsächlich scheitern können, ging
# ausschließlich nach stdout/stderr — und wird deploy.sh vom Panel-Watcher
# (systemd) angestoßen, landet das im Journal des Dienstes. Im Panel stand
# darum nur „FEHLER: Image-Build fehlgeschlagen (Stufe: …)". Der eigentliche
# Grund — npm-Fehler, Compiler-Meldung, „no space left on device", nicht
# erreichbare Registry — war von dort aus unerreichbar; man musste sich auf
# den Server einloggen. Genau das kostete die Diagnose des fehlgeschlagenen
# Deploys von 298e6b6.
#
# `set -o pipefail` (ganz oben) ist hier VORAUSSETZUNG, nicht Beiwerk: ohne
# pipefail lieferte die Pipe den Status von `tee` — also immer 0 — und ein
# fehlgeschlagener Build liefe als Erfolg durch. Die Kontrolle dazu steht in
# tests/deploy-betrieb.test.ts.
run_logged() {
  if _status_ready; then
    "$@" 2>&1 | tee -a "$DATA_DIR/deploy.log"
  else
    "$@"
  fi
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
# Bis 08/2026 stand hier ein CPU-Check: Fehlte /proc/cpuinfo das Flag sse4_2,
# baute deploy.sh ein „LOW_CPU-Image", in dem die Bildpipeline statt sharp die
# Debian-libvips-CLI benutzte — sharps native Bibliothek hätte auf solchen CPUs
# einen unabfangbaren SIGILL ausgelöst. Die Maschine ist inzwischen eine AMD
# EPYC 7352; sie meldet alle sechs x86-64-v2-Flags, ld.so nennt zusätzlich v3
# und v4. Der Zweig war damit schon vor seiner Entfernung tot: Gebaut wurde
# ohnehin nur noch mit LOW_CPU=0, und der Entrypoint schaltete mangels
# vipsthumbnail nie auf vips um. Ein zweites Bild-Backend, das nie läuft, ist
# kein Netz, sondern unbelegter Code — deshalb ist es ganz weg.

# Persistente Build-Caches auf dem Host (NO_CACHE=1 schaltet beides ab):
#  - npm-Cache: npm ci lädt Pakete nur noch einmal herunter
#  - Turbopack-Cache (.next/cache): next build kompiliert nur Geändertes neu
#    (next.config.ts: experimental.turbopackFileSystemCacheForBuild)
# `podman build -v` blendet die Host-Verzeichnisse nur während der RUN-Schritte
# ein — sie landen NICHT im Image.
BUILD_OPTS=(--build-arg "APP_COMMIT=$COMMIT" -f Containerfile)
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
run_logged podman build "${BUILD_OPTS[@]}" --target deps -t localhost/roses-blog:cache-deps . \
  || fail "Image-Build fehlgeschlagen (Stufe: Abhängigkeiten/npm ci)."
run_logged podman build "${BUILD_OPTS[@]}" --target build -t localhost/roses-blog:cache-build . \
  || fail "Image-Build fehlgeschlagen (Stufe: App-Build/next build)."
# Rollback-Vorbereitung (A-06/B-11): das aktuell laufende :latest als :previous
# sichern, BEVOR es überschrieben wird — so kann deploy/rollback.sh es in
# Sekunden zurückrollen (samt DB-Backup aus Abschnitt 4).
#
# ── NUR, WENN :latest BEKANNT GUT IST (Befund 4 der Gegenprüfung) ──────────
#
# Bis 08/2026 wurde bei JEDEM Lauf umgetaggt. Zwei Fehlschläge hintereinander
# löschten damit den letzten guten Stand:
#
#   Deploy A (gut)  → :previous = ?,  :latest = A
#   Deploy B (rot)  → :previous = A,  :latest = B     ← A ist noch da
#   Deploy C        → :previous = B,  :latest = C     ← A ist WEG, B ist kaputt
#
# Ein Rollback hätte danach auf das kaputte B geführt. Deshalb schreibt der
# Erfolgspfad am Ende dieses Skripts die Image-ID von :latest nach
# `deploy-image-ok`; hier wird umgetaggt, wenn — und nur wenn — die ID des
# laufenden :latest genau dieser Zeuge ist. Fehlt der Zeuge oder passt er
# nicht, bleibt :previous stehen: ein alter bekannt guter Stand ist mehr wert
# als ein frischer unbekannter.
BEKANNT_GUT_DATEI="$DATA_DIR/deploy-image-ok"
if podman image exists localhost/roses-blog:latest 2>/dev/null; then
  LATEST_ID="$(podman image inspect -f '{{.Id}}' localhost/roses-blog:latest 2>/dev/null || true)"
  BEKANNT_GUT="$(cat "$BEKANNT_GUT_DATEI" 2>/dev/null || true)"
  if [[ -n "$LATEST_ID" && "$LATEST_ID" == "$BEKANNT_GUT" ]]; then
    podman tag localhost/roses-blog:latest localhost/roses-blog:previous || true
  elif podman image exists localhost/roses-blog:previous 2>/dev/null; then
    log "Behalte bisheriges :previous — das laufende :latest ist nicht als bekannt gut bezeugt"
  else
    # Erststart bzw. erster Lauf nach Einführung des Zeugen: Es gibt noch gar
    # kein :previous. Dann ist ein ungeprüftes :previous besser als keines —
    # aber es wird benannt, nicht stillschweigend gesetzt.
    log "Setze :previous erstmals (ohne Gut-Zeugnis — erster Lauf mit dieser Prüfung)"
    podman tag localhost/roses-blog:latest localhost/roses-blog:previous || true
  fi
fi
run_logged podman build "${BUILD_OPTS[@]}" -t localhost/roses-blog:latest . \
  || fail "Image-Build fehlgeschlagen (Stufe: Laufzeit-Image)."
# Ab hier gibt es ein frisches :latest aus DIESEM Stand — es enthält das
# Alarmskript mit Sicherheit. Die Wahl von oben neu treffen lassen: Beim ersten
# Ausrollen war zu diesem Zeitpunkt noch KEIN Image mit Alarmskript da, und
# ohne das Zurücksetzen bliebe es bis zum Ende des Laufs dabei — die Alarme des
# Health-Gates gingen dann verloren, obwohl längst ein taugliches Image steht.
ALARM_BILD_GEPRUEFT=0

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
  # Befund 3: `podman rm` nimmt die Protokolle mit. Wer danach nachsehen will —
  # und beim Rollback will man das —, findet nichts mehr. Deshalb ZUERST
  # vollständig auf Platte, dann erst die Kurzfassung auf den Schirm.
  DIAGNOSE="$DATA_DIR/deploy-fehlschlag-$(date +%Y%m%d-%H%M%S).log"
  podman logs roses-blog > "$DIAGNOSE" 2>&1 \
    && echo "Vollständiges Container-Protokoll: $DIAGNOSE" \
    || echo "WARNUNG: Container-Protokoll nicht lesbar."
  echo "Letzte Container-Logs:"
  podman logs --tail 40 roses-blog || true
  fail "Healthcheck fehlgeschlagen. Vollständiges Protokoll: $DIAGNOSE"
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

  # Einmaliger Befund-Hinweis (Vorfall 2026-08-14): frühere Fassungen dieses
  # Skripts hatten Backticks im unquotierten Heredoc unten. `env -u
  # INVOCATION_ID` im Erklärtext scheiterte nicht, sondern LIEF — und schrieb
  # die vollständige Prozessumgebung in die Unit-Datei. Weil deploy.sh die
  # .env vorher in die Umgebung lädt, standen dort Secrets im Klartext.
  # Gleich wird die Datei sauber überschrieben; ohne diesen Hinweis verschwände
  # der Beleg lautlos und niemand wüsste, dass etwas zu wechseln ist.
  ALTE_UNIT="$UNIT_DIR/roses-blog-deploy.service"
  if [[ -f "$ALTE_UNIT" ]] && grep -qE '^(SESSION_SECRET|ADMIN_PASSWORD|SMTP_PASS|ANTHROPIC_API_KEY|DEPLOY_GITHUB_TOKEN)=' "$ALTE_UNIT"; then
    echo "WARNUNG: Die bisherige Unit $ALTE_UNIT enthielt Secrets im Klartext"
    echo "         (Folge eines Heredoc-Fehlers in einer früheren deploy.sh)."
    echo "         Sie wird jetzt sauber überschrieben. Prüfe zusätzlich Backups"
    echo "         des Home-Verzeichnisses und wechsle die betroffenen Werte in"
    echo "         der .env, falls weitere Personen Zugriff auf diesen Host haben."
  fi

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

  # Die Vorlage ist GEQUOTET (<<'EOF'): die Shell fasst den Text nicht an.
  # Werte kommen ausschließlich über @PLATZHALTER@ herein (siehe unterhalb der
  # Vorlage). Damit ist die Fehlerklasse vom 2026-08-14 strukturell erledigt —
  # damals stand hier ein unquotiertes Heredoc, und ein `env -u INVOCATION_ID`
  # im Erklärtext wurde AUSGEFÜHRT statt geschrieben: die vollständige
  # Prozessumgebung samt SESSION_SECRET, ADMIN_PASSWORD, SMTP_PASS und
  # ANTHROPIC_API_KEY landete im Klartext in dieser Unit-Datei.
  #
  # Ein Wächter, der stattdessen den Text unquotierter Heredocs abklopft, müsste
  # die Shell nachbauen (Quoting über Zeilengrenzen, $( ) mit eigener Ebene,
  # Zeilenfortsetzungen, eval) — elf belegte Umgehungen haben gezeigt, dass das
  # nicht verlässlich gelingt. Ohne unquotiertes Heredoc gibt es nichts zu
  # umgehen.
  dienst_unit=$(cat <<'EOF'
[Unit]
Description=Roses Food Blog – Pull & Deploy (aus dem Admin-Panel angestoßen)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=@SCRIPT_DIR@
# WICHTIG: Ein systemd-User-Dienst startet mit MINIMALEM PATH — ohne
# ~/.local/bin (dort liegt z. B. ein per pip installiertes podman-compose)
# und ggf. ohne /usr/local/bin. deploy.sh bräche dann schon an der
# podman/podman-compose-Prüfung ab (Symptom: Panel meldet „Server reagiert
# nicht“, während der manuelle Aufruf im Terminal problemlos läuft). Wir
# setzen daher einen vollständigen PATH — die Standardorte plus den PATH,
# den der installierende Aufruf hatte.
Environment=HOME=@HOME@
Environment=PATH=@HOME@/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:@PATH@
#
# LEBENSDAUER DES CONTAINERS VON DER DES DIENSTES ENTKOPPELN
# (Produktionsausfall 2026-08-10, ~11 h Totalausfall — Root Cause):
# Ein oneshot-Dienst gilt nach ExecStart als beendet; systemd räumt dann seine
# Control-Group ab. Der frisch gestartete Container lag mit conmon und
# rootlessport GENAU IN DIESER cgroup und wurde mitgerissen:
#     roses-blog-deploy.service: State 'stop-sigterm' timed out. Killing.
#     Killing process … (rootlessport) with signal SIGKILL.
#     Killing process … (conmon)      with signal SIGKILL.
# 90 s nach der Erfolgsmeldung war die Seite tot, und „restart: always“ konnte
# nicht greifen, weil der Supervisor (conmon) selbst erschossen war.
# Zwei Maßnahmen, absichtlich beide — die TRAGENDE ist die erste:
#  1. „KillMode=process“. Der rekursive cgroup-Kill hängt in systemd an
#     KillMode=control-group (Default) bzw. mixed; bei „process“ signalisiert
#     systemd ausschließlich den Hauptprozess — conmon und rootlessport werden
#     nie angefasst. Wer diese Zeile wegräumt, stellt den Ausfall wieder her.
#     („mixed“ wäre SCHLIMMER als der Default: die SIGTERM-Phase fände nichts,
#     systemd eskalierte sofort zu SIGKILL, und der Container stürbe in
#     Millisekunden statt nach 90 s. „none“ ist seit systemd v249 abgekündigt.)
#  2. „env -u INVOCATION_ID“ ergänzt das strukturell: an dieser Variablen
#     erkennt podman eine umgebende Unit und überspringt dann das Verschieben
#     von conmon in eine eigene transiente Scope (libpod-conmon-<id>.scope).
#     Ohne sie verhält sich podman wie beim interaktiven Start. Das ist
#     allerdings undokumentiertes podman-Innenleben, setzt cgroup_manager=systemd
#     und einen erreichbaren Benutzer-D-Bus voraus und kann still ausbleiben —
#     deshalb Ergänzung, nicht Fundament.
# tests/deploy-betrieb.test.ts hält beide Zeilen fest.
KillMode=process
# Anfrage vor dem Lauf entfernen, damit der Path-Unit erneut auslösen kann.
ExecStartPre=-/usr/bin/rm -f @DATA_DIR@/deploy-request
ExecStart=/usr/bin/env -u INVOCATION_ID bash @SCRIPT_DIR@/deploy.sh
EOF
)
  pfad_unit=$(cat <<'EOF'
[Unit]
Description=Beobachtet Deploy-Anfragen aus dem Admin-Panel (Roses Food Blog)

[Path]
PathExists=@DATA_DIR@/deploy-request
Unit=roses-blog-deploy.service

[Install]
WantedBy=default.target
EOF
)

  # Vorlage prüfen, BEVOR eingesetzt wird: jeder @NAME@ in der Vorlage muss
  # unten auch einen Wert bekommen. Geprüft wird hier der Vorlagentext (also
  # Quelltext), nicht das Ergebnis — im Ergebnis stünde sonst womöglich ein
  # @NAME@, das aus einem WERT stammt, und die Prüfung schlüge falsch an.
  rest_vorlage="$dienst_unit$pfad_unit"
  for platz in @SCRIPT_DIR@ @DATA_DIR@ @HOME@ @PATH@; do
    rest_vorlage=${rest_vorlage//"$platz"/}
  done
  if [[ "$rest_vorlage" =~ @[A-Z_]+@ ]]; then
    fail "Unit-Vorlage enthält einen Platzhalter ohne Wert: ${BASH_REMATCH[0]}"
  fi

  dienst_unit=$(einmal_einsetzen "$dienst_unit" \
    SCRIPT_DIR "$SCRIPT_DIR" DATA_DIR "$DATA_DIR" HOME "$HOME" PATH "$PATH")
  pfad_unit=$(einmal_einsetzen "$pfad_unit" DATA_DIR "$DATA_DIR")

  printf '%s\n' "$dienst_unit" > "$UNIT_DIR/roses-blog-deploy.service"
  printf '%s\n' "$pfad_unit" > "$UNIT_DIR/roses-blog-deploy.path"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  if systemctl --user enable --now roses-blog-deploy.path >/dev/null 2>&1; then
    echo "Panel-Deploy: Watcher aktiv (roses-blog-deploy.path)."
  else
    echo "HINWEIS: Deploy-Watcher nicht aktivierbar — Panel-Aktualisierung inaktiv."
  fi

  # --- 7d. Freigabe-Marke für die Panel-Aktualisierung ------------------------
  # Der Container kann systemd nicht befragen — er sieht nur das Datenverzeichnis.
  # Deshalb hinterlegt der Host hier eine Marke, und zwar NUR nach echter
  # Verifikation des geladenen Zustands. Fehlt sie, verweigert das Panel (und der
  # GitHub-Webhook) das Auslösen. Das schließt die Lücke beim allerersten
  # Ausrollen dieser Reparatur: dort läuft auf dem Host noch die alte, tötende
  # Unit, die diese Marke nie geschrieben hat — ein Panel-Klick kann die Seite
  # also gar nicht mehr abschalten (Befund gpt-5.6-sol, PR #57, Runde 6).
  UNIT_KILLMODE="$(systemctl --user show roses-blog-deploy.service \
    --property=KillMode --value 2>/dev/null)" || UNIT_KILLMODE=""
  UNIT_RELOAD="$(systemctl --user show roses-blog-deploy.service \
    --property=NeedDaemonReload --value 2>/dev/null)" || UNIT_RELOAD=""
  if [[ "$UNIT_KILLMODE" == "process" && "$UNIT_RELOAD" == "no" ]]; then
    printf 'KillMode=%s NeedDaemonReload=%s geprueft am %s\n' \
      "$UNIT_KILLMODE" "$UNIT_RELOAD" "$(date -Is)" \
      > "$DATA_DIR/deploy-unit-ok" 2>/dev/null || true
    echo "Panel-Deploy: freigegeben (Unit verifiziert: KillMode=process)."
  else
    rm -f "$DATA_DIR/deploy-unit-ok" 2>/dev/null || true
    echo "HINWEIS: Panel-Aktualisierung bleibt GESPERRT (KillMode='${UNIT_KILLMODE:-unbekannt}',"
    echo "         NeedDaemonReload='${UNIT_RELOAD:-unbekannt}'). Deploys nur aus dem Terminal."
  fi

  # --- 7e. Wachhund gegen die Neustartschleife (Befund 5) --------------------
  # `restart: always` bleibt — nur damit startet podman-restart.service den
  # Container nach einem Rechnerneustart wieder. Die fehlende OBERGRENZE zieht
  # dieser Timer ein: alle 5 Minuten messen, und wenn der Container über
  # mehrere Beobachtungen hinweg weiter neu startet UND rot bleibt, wird er
  # gestoppt und ein Alarm verschickt. Details in deploy/wachhund.sh.
  wach_dienst=$(cat <<'EOF'
[Unit]
Description=Wachhund gegen Neustartschleifen (Roses Food Blog)

[Service]
Type=oneshot
WorkingDirectory=@SCRIPT_DIR@
Environment=HOME=@HOME@
Environment=PATH=@HOME@/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:@PATH@
# Derselbe Grund wie bei roses-blog-deploy.service: Ein oneshot-Dienst nimmt
# beim Aufräumen seiner cgroup sonst conmon und rootlessport mit — und der
# Wachhund würde genau den Ausfall auslösen, den er verhindern soll.
KillMode=process
ExecStart=/usr/bin/env -u INVOCATION_ID bash @SCRIPT_DIR@/deploy/wachhund.sh
EOF
)
  wach_timer=$(cat <<'EOF'
[Unit]
Description=Wachhund alle 5 Minuten (Roses Food Blog)

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
Unit=roses-blog-wachhund.service

[Install]
WantedBy=timers.target
EOF
)
  rest_wach="$wach_dienst$wach_timer"
  for platz in @SCRIPT_DIR@ @HOME@ @PATH@; do rest_wach=${rest_wach//"$platz"/}; done
  if [[ "$rest_wach" =~ @[A-Z_]+@ ]]; then
    fail "Wachhund-Vorlage enthält einen Platzhalter ohne Wert: ${BASH_REMATCH[0]}"
  fi
  wach_dienst=$(einmal_einsetzen "$wach_dienst" \
    SCRIPT_DIR "$SCRIPT_DIR" HOME "$HOME" PATH "$PATH")
  printf '%s\n' "$wach_dienst" > "$UNIT_DIR/roses-blog-wachhund.service"
  printf '%s\n' "$wach_timer"  > "$UNIT_DIR/roses-blog-wachhund.timer"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user enable --now roses-blog-wachhund.timer >/dev/null 2>&1 || true
  # ── NACHSEHEN, NICHT DEM RÜCKGABEWERT GLAUBEN ────────────────────────────
  #
  # Hier stand `if systemctl enable --now …; then … else HINWEIS + Cron-Zeile`,
  # und der Deploy lief in beiden Fällen grün weiter. Daran war zweierlei
  # falsch (Befund gpt-5.6-sol, PR #110, Runde 3):
  #
  #   1. Der Rückgabewert von `enable --now` ist kein Beleg dafür, dass der
  #      Timer danach LÄUFT. Gefragt wird deshalb der Zustand selbst — dieselbe
  #      Regel wie eine Sektion weiter oben bei der Panel-Freigabe: nur nach
  #      echter Verifikation.
  #   2. Die Cron-Zeile war ein VORGESCHLAGENER WORKAROUND, und der Deploy
  #      meldete Erfolg, während die einzige Obergrenze für `restart: always`
  #      schlicht fehlte — also genau die Lücke offenstand, die am 2026-08-10
  #      elf Stunden Ausfall gekostet hat. Ein grünes Deployment über einer
  #      fehlenden Sicherung ist eine Falschaussage.
  #
  # Der Zeuge macht die Sicherung ÜBERPRÜFBAR statt vorausgesetzt, genauso wie
  # `deploy-unit-ok` es für die Panel-Freigabe tut.
  # Die Unit-Dateien schreiben und den Timer starten geht nur, wo es systemd
  # gibt — deshalb steht das hier drin. Die FESTSTELLUNG, ob der Wachhund
  # wirklich verankert ist, steht bewusst außerhalb: siehe unter dem `fi`.
fi

# --- 7f. Ist der Wachhund verankert? AUSSERHALB jeder Bedingung ------------
#
# Diese eine Zeile stand bis 08/2026 im Block darüber, also hinter
# `if command -v systemctl`. Auf einer Anlage ohne systemd wurde sie damit nie
# erreicht: `wachhund_verankern` lief nicht, WACHHUND_FEHLT blieb 0, und der
# Deploy quittierte Erfolg — ohne Timer, mit unbegrenztem `restart: always`.
# Also genau der Zustand, den der Abschnitt darüber verhindern soll, nur auf
# einem anderen Weg erreicht (Befund gpt-5.6-sol, PR #110, Runde 5).
#
# Die Frage „ist die Obergrenze da?" hängt nicht davon ab, WARUM sie fehlen
# könnte. Sie wird deshalb immer gestellt. Fehlt systemctl, liefert die
# Abfrage in wachhund_verankern nichts, und das Ergebnis ist dasselbe wie bei
# einem Timer, der nicht anspringt: Der Lauf gilt nicht als erfolgreich.
wachhund_verankern

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
# --- 9c. Auslieferung am Ursprung ---------------------------------------------
# Die App liefert bewusst UNKOMPRIMIERT aus (next.config.ts: compress:false),
# damit der Reverse Proxy komprimieren kann. Ob er das tut, hat vier Wochen lang
# niemand gemessen: Die tägliche Prüfung in perf-uptime.yml lief gegen die
# öffentliche Domain und damit gegen Cloudflare, das nachkomprimierte. Am
# Ursprung liefen CSS und JavaScript derweil vollständig unkomprimiert
# (audit/11-infrastruktur-befund.md, B1/B2).
#
# WARUM DIE PRÜFUNG HIER STEHT und nicht in GitHub Actions: Von dort aus wäre
# der Ursprung nur über seine IP-Adresse messbar, und die gehört nicht in ein
# öffentliches Repository (B7). Auf dem Server ist er über 127.0.0.1 erreichbar
# — und bleibt es auch, wenn der Zugang von außen später auf die
# Cloudflare-Bereiche eingeschränkt wird.
#
# WARUM SIE HART FEHLSCHLÄGT: Ein Deployment, dessen Ergebnis falsch
# ausgeliefert wird, ist kein abgeschlossenes Deployment. Die Meldung unten
# nennt den Weg zur Behebung; unterdrückt wird hier nichts.
#
# WARUM SIE GANZ AM ENDE STEHT und nicht direkt hinter dem Healthcheck: Dort
# stand sie zuerst — und ein Fehlschlag hätte damit die Abschnitte 7 und 7c
# übersprungen. Genau die stellen bei JEDEM Lauf den Autostart sicher
# (podman-restart.service, Linger); ohne sie startet der Container nach einem
# Reboot nicht, und zwar still. Ein Kompressionsmangel hätte also die
# Reboot-Festigkeit gekappt. Hier unten sind alle Invarianten hergestellt, das
# Aufräumen ist durch und das Stabilitätsfenster bestanden; ein Fehlschlag
# kostet nur noch die Erfolgsmeldung — und die ist dann auch zu Recht weg.
# ZUERST die Voraussetzung HERSTELLEN, dann messen. Eine Prüfung, die eine
# unerfüllte Voraussetzung nur beklagt, hat nichts sichergestellt — und ein
# Handgriff, den sich jemand merken muss, wird irgendwann vergessen. Genau so
# hält es Abschnitt 7 mit dem Autostart: bei JEDEM Lauf herstellen, nicht
# einmalig einrichten.
#
# Das Schnipsel gilt für den GESAMTEN Proxy, also auch für andere Hosts darauf.
# Deshalb liegt das Einspielen in einem eigenen Skript mit Rückrollpfad: Lehnt
# nginx die Fassung ab, bleibt sie NICHT liegen — sonst käme der Proxy beim
# nächsten Neustart für alle Seiten nicht mehr hoch. Nachgestellt in
# tests/npm-snippet.test.ts.
#
# Welcher Container das ist, wird POSITIV zugeordnet, nicht geraten: Die erste
# Fassung nahm den ersten Treffer auf `:80->`/`:443->`/„openresty" — auf einem
# Host mit mehreren solchen Containern hätte das Deploy eine GLOBALE
# nginx-Konfiguration in einen fremden geschrieben. Genau diese Lage liegt hier
# vor; auf demselben Proxy laufen weitere Domains.
# npm-container-finden.sh verlangt: veröffentlicht 80/443, ist wirklich ein
# nginx, UND bedient laut /data/nginx/proxy_host/ genau diesen Namen.
# BASE_URL wird auch hier UNVERÄNDERT durchgereicht — die Zerlegung liegt in
# scripts/regime/url-teile.sh, an einer Stelle für alle.
NPM_CONTAINER=$("$SCRIPT_DIR/scripts/regime/npm-container-finden.sh" --basis "$BASE_URL") || NPM_CONTAINER=""
if [ -n "$NPM_CONTAINER" ]; then
  log "Stelle Kompression im Reverse Proxy sicher ($NPM_CONTAINER)"
  if ! "$SCRIPT_DIR/scripts/regime/npm-snippet-einspielen.sh" \
        --container "$NPM_CONTAINER" --datei "$SCRIPT_DIR/deploy/npm/http_top.conf"; then
    fail "Kompressionsschnipsel ließ sich nicht einspielen (siehe oben)."
  fi
else
  echo "  Kein eindeutig zugeordneter Proxy-Container — es wird nichts eingespielt."
  echo "  In fremde oder mehrdeutige Container zu schreiben wäre schlimmer als"
  echo "  nichts zu tun. Die Messung unten prüft trotzdem, was TATSÄCHLICH"
  echo "  ausgeliefert wird — durchgewunken wird also nichts."
fi

# BASE_URL wird UNVERÄNDERT durchgereicht. Die erste Fassung zerlegte sie in
# Bestandteile und setzte daraus „https://$HOST" wieder zusammen — und daran
# ist der erste Produktionslauf gescheitert: Steht in der .env eine URL mit nur
# einem Schrägstrich (`https:/…`), liefert die Zerlegung den Host „https", und
# die Prüfung lief gegen einen Namen, den es nicht gibt.
#
# Der Fehler war nicht die Zerlegung, sondern dass es sie gab: BASE_URL IST
# bereits eine URL. Sie auseinanderzunehmen und neu zusammenzusetzen konnte nur
# verlieren. kompression-pruefen.sh liest Schema, Name und Port selbst.
log "Prüfe Auslieferung am Ursprung ($BASE_URL über 127.0.0.1)"
if ! "$SCRIPT_DIR/scripts/regime/kompression-pruefen.sh" \
      --basis "$BASE_URL" --aufloesen 127.0.0.1 --ebene ursprung; then
  echo
  echo "Der Reverse Proxy liefert nicht so aus, wie next.config.ts es voraussetzt."
  echo "Vorlage und Einspielweg stehen im Kopf von deploy/npm/http_top.conf."
  fail "Auslieferung am Ursprung fehlerhaft (siehe Mängel oben)."
fi

# Der Zeuge für Befund 4: DIESES Image ist jetzt nachweislich gut — es hat den
# Healthcheck, den finalen Health-Gate und die Auslieferungsprüfung bestanden.
# Nur ein Image mit diesem Zeugnis darf beim nächsten Lauf zu :previous werden.
#
# Das gilt AUCH, wenn der Wachhund fehlt: Das Image ist deswegen nicht
# schlechter. Würde der Zeuge hier ausgelassen, verlöre die Rollback-Kette
# ihren einzigen bekannt guten Stand — ein zweiter Schaden aus einem ersten.
podman image inspect -f '{{.Id}}' localhost/roses-blog:latest \
  > "$DATA_DIR/deploy-image-ok" 2>/dev/null || true

# ── FEHLT DIE BETRIEBSABSICHERUNG, IST DER LAUF NICHT ERFOLGREICH ──────────
#
# Der Schnellpfad-State wird dann BEWUSST NICHT geschrieben. Stünde er da,
# meldete der nächste Lauf „Bereits aktuell" und übersprünge alles — auch den
# zweiten Versuch, den Wachhund zu installieren. Der Fehler reparierte sich
# dann nie und bliebe für immer unsichtbar.
if [[ "$WACHHUND_FEHLT" -eq 1 ]]; then
  DEPLOY_PHASE="Wachhund nicht installiert"
  ALARM_SCHON_GESENDET=1
  alarm_absetzen "⚠ Roses Blog — Deployment unvollständig (Wachhund fehlt)" \
    "Die ANWENDUNG läuft auf dem neuen Stand und ist gesund — Health-Gate und
Auslieferungsprüfung sind bestanden. Ein Rollback ist NICHT der nächste Schritt.

Unvollständig ist die Betriebsabsicherung: roses-blog-wachhund.timer ist nicht
aktiv. Damit hat 'restart: always' keine Obergrenze mehr — das ist genau die
Lage, die am 2026-08-10 elf Stunden Ausfall verursacht hat.

Nächster Schritt auf dem Server:
  systemctl --user status roses-blog-wachhund.timer
  systemctl --user enable --now roses-blog-wachhund.timer
Danach ./deploy.sh erneut laufen lassen."
  fail "Wachhund-Timer nicht aktiv — Betriebsabsicherung fehlt (Anwendung läuft, kein Rollback nötig)."
fi

# Erst NACH bestandenem Health-Gate UND vollständiger Absicherung:
# Schnellpfad-State festhalten + Erfolg markieren.
printf '%s %s\n' "$COMMIT" "$ENV_HASH" > "$STATE_FILE" 2>/dev/null || true
DEPLOY_STATUS_RESULT="erfolgreich"   # EXIT-Trap schreibt deploy-status.json
log "Deployment erfolgreich (Dauer: ${SECONDS}s)"
echo "Health:   OK (http://127.0.0.1:$PORT/health)"
podman ps --filter name=roses-blog --format "Container: {{.Names}} ({{.Status}})"

}

main "$@"
