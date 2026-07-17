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
- **Prozess-/Crash-Recovery** bleibt automatisch über `restart: always` +
  Container-Healthcheck (`/health`) + `deploy.sh`-Healthcheck.

## Ehrliche Grenze (Residual)
Der Alert ist die **automatische Reaktion** auf Degradation; eine vollautomatische
*Selbstheilung* fachlicher Fehler (über Neustart hinaus) gibt es nicht — für einen
Solo-Blog verhältnismäßig. Tripwire: der Selbst-Monitor selbst schlägt an, wenn er
ausfiele (fehlende health-Events), und der Alert-Pfad ist per Integrationstest
(`tests/observability.integration.test.ts`) gedeckt.

## Ratchet (S11)
- Fehlerbudget/Verfügbarkeitsziel dürfen nur strenger werden (Env, Decision Record).
- Alert-Pfad-Test darf nicht rot werden.
