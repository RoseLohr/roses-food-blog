/**
 * B-03 / A-24 — Observability + SLO + automatischer Alert.
 *
 * Für einen Solo-Blog verhältnismäßig statt schwergewichtig:
 *  - `logJson`  : eine strukturierte JSON-Zeile nach stdout (maschinen-abfragbar
 *                 in `podman logs`). Das ist die „Logs"-Säule.
 *  - `recordOpsEvent` : Golden-Signal-Persistenz in `ops_event` (Fehler, Health,
 *                 Alerts) — best effort, wirft NIE (Observability darf die App
 *                 nie killen).
 *  - `checkSloAndAlert` : der Selbst-Monitor. Prüft DB-Health + Fehlerbudget im
 *                 Fenster und schickt bei Verletzung EINEN E-Mail-Alert über die
 *                 vorhandenen SMTP-Einstellungen (mit Cooldown, kein Spam).
 *                 Das ist „Detection → automatische Aktion" ohne wachenden Menschen.
 *
 * SLO (Standard, per Env übersteuerbar): höchstens OPS_ERROR_BUDGET Server-Fehler
 * je OPS_WINDOW_MIN Minuten; sonst brennt das Budget → Alert.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSetting } from "@/lib/settings";

export const SLO = {
  windowMin: Number(process.env.OPS_WINDOW_MIN || 15),
  errorBudget: Number(process.env.OPS_ERROR_BUDGET || 10),
  alertCooldownMin: Number(process.env.OPS_ALERT_COOLDOWN_MIN || 60),
  availabilityTarget: 0.995,
};

/** Strukturierte JSON-Logzeile (Logs-Säule). Nie personenbezogen. */
export function logJson(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    // Zeitstempel bewusst als ISO für Menschen + maschinelle Sortierung.
    const line = JSON.stringify({ level, event, ...fields });
    if (level === "error") console.error(line);
    else console.log(line);
  } catch {
    /* Logging darf nie werfen */
  }
}

/** Golden-Signal-Ereignis persistieren (best effort). */
export function recordOpsEvent(e: {
  kind: "error" | "request" | "health" | "alert";
  route?: string | null;
  status?: number | null;
  durationMs?: number | null;
  detail?: string | null;
}): void {
  try {
    db.insert(schema.opsEvent)
      .values({
        kind: e.kind,
        route: e.route ?? null,
        status: e.status ?? null,
        durationMs: e.durationMs ?? null,
        detail: e.detail ? e.detail.slice(0, 500) : null,
        createdAt: new Date(),
      })
      .run();
  } catch {
    /* Observability darf die App nie killen */
  }
}

/** Anzahl Ereignisse einer Art im Zeitfenster (Minuten). */
function countSince(kind: "error" | "alert", minutes: number): number {
  const since = new Date(Date.now() - minutes * 60_000);
  try {
    const row = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.opsEvent)
      .where(
        and(eq(schema.opsEvent.kind, kind), gte(schema.opsEvent.createdAt, since)),
      )
      .get();
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/** DB erreichbar? (Health-Signal). */
function dbHealthy(): boolean {
  try {
    db.run(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

/** Empfänger des Alarms: ALERT_EMAIL → ADMIN_EMAIL → smtp_from. */
function alertRecipient(): string {
  return (
    process.env.ALERT_EMAIL ||
    process.env.ADMIN_EMAIL ||
    getSetting("smtp_from") ||
    process.env.SMTP_FROM ||
    ""
  );
}

function smtpConfigured(): boolean {
  return Boolean(getSetting("smtp_host") || process.env.SMTP_HOST);
}

export interface SloStatus {
  healthy: boolean;
  errorCount: number;
  breach: boolean;
  alerted: boolean;
  reason: string;
}

/**
 * Selbst-Monitor: prüft Health + Fehlerbudget, alarmiert bei Verletzung.
 * `deps` erlaubt Tests, den Mailer zu injizieren (kein echtes SMTP nötig).
 */
export async function checkSloAndAlert(deps?: {
  sendAlert?: (to: string, subject: string, body: string) => Promise<void>;
  now?: number;
}): Promise<SloStatus> {
  const healthy = dbHealthy();
  const errorCount = countSince("error", SLO.windowMin);
  const budgetBurned = errorCount >= SLO.errorBudget;
  const breach = !healthy || budgetBurned;

  recordOpsEvent({ kind: "health", status: healthy ? 1 : 0, detail: `errors/${SLO.windowMin}min=${errorCount}` });

  const reason = !healthy
    ? "Datenbank nicht erreichbar"
    : budgetBurned
      ? `Fehlerbudget verbraucht: ${errorCount} Server-Fehler in ${SLO.windowMin} min (Budget ${SLO.errorBudget})`
      : "ok";

  let alerted = false;
  if (breach) {
    logJson("error", "slo_breach", { healthy, errorCount, window_min: SLO.windowMin });
    const recentlyAlerted = countSince("alert", SLO.alertCooldownMin) > 0;
    if (!recentlyAlerted) {
      const to = alertRecipient();
      if (to && smtpConfigured()) {
        const subject = `⚠ Roses Blog — Betriebsalarm: ${reason}`;
        const body =
          `Der Selbst-Monitor hat eine SLO-Verletzung erkannt:\n\n` +
          `Grund: ${reason}\n` +
          `Health (DB): ${healthy ? "ok" : "AUSFALL"}\n` +
          `Server-Fehler (${SLO.windowMin} min): ${errorCount} / Budget ${SLO.errorBudget}\n\n` +
          `Bitte Logs prüfen (podman logs roses-blog). Weitere Alarme sind für ` +
          `${SLO.alertCooldownMin} min unterdrückt (Cooldown).`;
        try {
          const send = deps?.sendAlert ?? defaultSendAlert;
          await send(to, subject, body);
          alerted = true;
          recordOpsEvent({ kind: "alert", detail: reason });
        } catch (err) {
          logJson("error", "alert_send_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        logJson("warn", "alert_skipped_no_smtp", { to_present: Boolean(to) });
      }
    }
  }

  return { healthy, errorCount, breach, alerted, reason };
}

/** Realer Alert-Versand über den vorhandenen Mailer (SMTP). */
async function defaultSendAlert(to: string, subject: string, body: string): Promise<void> {
  const { sendEmail } = await import("@/lib/mailer");
  const html = `<pre style="font-family:ui-monospace,monospace;font-size:14px;white-space:pre-wrap">${body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</pre>`;
  await sendEmail({ to, subject, html, text: body });
}
