/**
 * A-34 (getesteter, selbst-feuernder Kill-Switch) + B-28 (Auto-Remediation) +
 * B-07 (Token-Nutzung loggen — nur Zähler, kein Inhalt).
 *
 * Das KI-Feature ist admin-only und nicht-konsequent, aber es soll sich bei einer
 * Störung SELBST anhalten können, ohne wachenden Menschen: häufen sich KI-Fehler
 * im Fenster, kippt der Schalter automatisch auf „aus". Der Admin kann ihn im
 * Panel/Env wieder einschalten.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSetting, setSettings } from "@/lib/settings";
import { logJson, recordOpsEvent } from "@/lib/observability";

const AI_ERROR_HALT_THRESHOLD = Number(process.env.AI_ERROR_HALT || 5);
const AI_ERROR_WINDOW_MIN = Number(process.env.AI_ERROR_WINDOW_MIN || 10);

/** Ist das KI-Feature aktiv? Env `AI_DISABLED=1` oder Setting `ai_enabled=off` schaltet es hart ab. */
export function aiFeatureEnabled(): boolean {
  if (process.env.AI_DISABLED === "1") return false;
  return getSetting("ai_enabled") !== "off";
}

/** Kill-Switch bewusst auslösen (Admin oder Auto-Halt). Idempotent. */
export function haltAiFeature(reason: string): void {
  try {
    setSettings({ ai_enabled: "off" });
  } catch {
    /* Kill-Switch darf nie werfen */
  }
  logJson("error", "ai_halted", { reason });
  recordOpsEvent({ kind: "alert", route: "ai", detail: `KI-Feature angehalten: ${reason}` });
}

/** Anzahl KI-Fehler im Fenster (route beginnt mit "ai"). */
function recentAiErrors(): number {
  const since = new Date(Date.now() - AI_ERROR_WINDOW_MIN * 60_000);
  try {
    const row = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.opsEvent)
      .where(
        and(
          eq(schema.opsEvent.kind, "error"),
          gte(schema.opsEvent.createdAt, since),
          sql`${schema.opsEvent.route} LIKE 'ai%'`,
        ),
      )
      .get();
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Einen KI-Fehler verbuchen und bei Budget-Überschreitung das Feature
 * automatisch anhalten (der Kill-Switch feuert sich selbst). Liefert true, wenn
 * angehalten wurde.
 */
export function recordAiErrorAndMaybeHalt(detail: string): boolean {
  recordOpsEvent({ kind: "error", route: "ai/recipe", detail: detail.slice(0, 200) });
  if (recentAiErrors() >= AI_ERROR_HALT_THRESHOLD) {
    haltAiFeature(`≥${AI_ERROR_HALT_THRESHOLD} Fehler in ${AI_ERROR_WINDOW_MIN} min`);
    return true;
  }
  return false;
}

/** Token-Nutzung eines KI-Laufs verbuchen — nur Zähler, KEIN Inhalt (B-07/Datenschutz). */
export function recordAiUsage(usage: { input_tokens?: number; output_tokens?: number } | null | undefined): void {
  const i = usage?.input_tokens ?? 0;
  const o = usage?.output_tokens ?? 0;
  recordOpsEvent({ kind: "request", route: "ai/recipe", detail: `tokens in=${i} out=${o}` });
}
