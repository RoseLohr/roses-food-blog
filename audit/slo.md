# A-24 / B-03 — SLO, Observability & automatischer Alert

## Observability (B-03)
- **Logs-Säule:** strukturierte JSON-Zeilen (`logJson`) nach stdout — in
  `podman logs roses-blog` maschinell abfragbar (Feld `event`, `route`, `message`).
- **Golden Signals (Fehler/Latenz/Health):** Tabelle `ops_event` (kein Personen-
  bezug). Jeder Server-Request-Fehler wird über den Next-`onRequestError`-Hook
  strukturiert erfasst — die Datengrundlage des Fehlerbudgets.

## SLO (A-24)
- **Verfügbarkeitsziel:** 99,5 % (Ausgangswert; per Env nachschärfbar).
- **Fehlerbudget:** höchstens `OPS_ERROR_BUDGET` (Standard 10) Server-Fehler je
  `OPS_WINDOW_MIN` (Standard 15) Minuten.
- **Health:** DB erreichbar (`SELECT 1`).

## Automatische Erkennung → Aktion (A-24 / B-28), ohne wachenden Menschen
- Der **Selbst-Monitor** läuft alle 5 min im App-Scheduler (`checkSloAndAlert`).
- Bei **Verletzung** (DB-Ausfall ODER Fehlerbudget verbraucht) sendet er
  **automatisch eine E-Mail** über die vorhandenen **SMTP-Einstellungen**
  (`sendEmail`) an `ALERT_EMAIL` → `ADMIN_EMAIL` → `smtp_from`.
- **Cooldown** `OPS_ALERT_COOLDOWN_MIN` (Standard 60 min) verhindert Alarm-Spam
  (über `ops_event kind='alert'`).
- **Prozess-/Crash-Recovery** über `restart: always`. Der Container-Healthcheck
  ist reine SICHTBARKEIT (`podman ps`) und löst *keine* Wiederherstellung aus:
  podman startet bei „unhealthy" nichts neu, solange `--health-on-failure`
  nicht gesetzt ist, und das ist mit dem compose-Provider nicht ausdrückbar.
  Der `deploy.sh`-Healthcheck wirkt ausschließlich während eines Deployments.

## Ehrliche Grenze (Residual) — korrigiert nach dem Ausfall 2026-08-10
Der Alert ist die **automatische Reaktion** auf Degradation; eine vollautomatische
*Selbstheilung* fachlicher Fehler (über Neustart hinaus) gibt es nicht — für einen
Solo-Blog verhältnismäßig. Der Alert-Pfad ist per Integrationstest
(`tests/observability.integration.test.ts`) gedeckt.

**Bekannte Lücke, ausdrücklich nicht geschlossen (Stand 2026-08-10):** Bei einem
TOTALAUSFALL der Anwendung meldet sich niemand. `checkSloAndAlert` läuft als
node-cron IM App-Prozess und verschickt aus derselben Instanz — ist der Container
tot, gibt es keinen Tick und keine Mail. Verschärfend: der Monitor bewertet
Fehler aus `ops_event`; bei null eingehenden Requests brennt das Fehlerbudget
*langsamer* als im Normalbetrieb, ein 502 ist für ihn also per Konstruktion
unsichtbar. Ein Wächter außerhalb des Containers existiert nicht:
`podman-restart.service` ist ein oneshot-Boot-Starter und läuft nach dem Boot nie
wieder; `deploy/roses-blog.service` ist ebenfalls oneshot ohne `Restart=` und wird
von `deploy.sh` gar nicht installiert; `scripts/regime/` enthält keine
Verfügbarkeitsprüfung. Belegt am 2026-08-10: die Seite war elf Stunden nicht
erreichbar, ohne dass ein einziger Alarm auslöste.

**Frühere Falschaussage, hiermit widerrufen:** An dieser Stelle stand ein
Tripwire („der Selbst-Monitor schlägt an, wenn er ausfiele — fehlende
health-Events"). Den gibt es nicht: zu `kind: "health"` existiert ausschließlich
der Schreiber (`src/lib/observability.ts`), kein Leser. Ein Prozess kann seine
eigene Abwesenheit grundsätzlich nicht melden; die Lücke ist nur von außen
schließbar (externer Uptime-Wächter oder systemd-Timer auf dem Host). Solange das
nicht entschieden ist, gilt sie als offenes Residual und NICHT als gedeckt.

## Ratchet (S11)
- Fehlerbudget/Verfügbarkeitsziel dürfen nur strenger werden (Env, Decision Record).
- Alert-Pfad-Test darf nicht rot werden.
