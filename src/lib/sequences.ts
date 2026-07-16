/**
 * Automatische Sequenzen (z. B. Willkommensserie): Beim Double-Opt-in wird
 * jeder Schritt aktiver Sequenzen als sequence_log (geplant, dueAt) angelegt;
 * der Cron reiht fällige Schritte in die Mail-Queue ein. Pausierte Sequenzen
 * (active = false) versenden nicht — geplante Schritte warten.
 */
import { and, asc, eq, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { enqueueEmail } from "./email-queue";
import { renderEmail } from "./mailer";
import { getBaseUrl } from "./base-url";

/** Nach Bestätigung: alle Schritte aktiver Sequenzen für den Kontakt planen. */
export async function scheduleSequencesForContact(
  contactId: number,
  now = new Date(),
): Promise<number> {
  const steps = await db
    .select({
      stepId: schema.sequenceStep.id,
      delayHours: schema.sequenceStep.delayHours,
      sortOrder: schema.sequenceStep.sortOrder,
      sequenceId: schema.sequence.id,
    })
    .from(schema.sequenceStep)
    .innerJoin(schema.sequence, eq(schema.sequenceStep.sequenceId, schema.sequence.id))
    .orderBy(asc(schema.sequence.id), asc(schema.sequenceStep.sortOrder));

  // Einschreibung je Sequenz festhalten (sequence_enrollment) — macht
  // nachvollziehbar, wer wann in welche Sequenz aufgenommen wurde.
  const sequenceIds = [...new Set(steps.map((s) => s.sequenceId))];
  for (const sequenceId of sequenceIds) {
    await db
      .insert(schema.sequenceEnrollment)
      .values({ sequenceId, contactId, enrolledAt: now })
      .onConflictDoNothing();
  }

  // Verzögerungen kumulieren sich je Sequenz (Schritt n nach Schritt n-1)
  let planned = 0;
  const cumulative = new Map<number, number>();
  for (const step of steps) {
    const offset = (cumulative.get(step.sequenceId) ?? 0) + step.delayHours;
    cumulative.set(step.sequenceId, offset);
    await db
      .insert(schema.sequenceLog)
      .values({
        sequenceStepId: step.stepId,
        contactId,
        dueAt: new Date(now.getTime() + offset * 60 * 60 * 1000),
        status: "geplant",
      })
      .onConflictDoNothing();
    planned++;
  }
  return planned;
}

/** Cron: fällige geplante Schritte aktiver Sequenzen in die Queue legen. */
export async function enqueueDueSequenceSteps(now = new Date()): Promise<number> {
  const due = await db
    .select({
      logId: schema.sequenceLog.id,
      stepId: schema.sequenceStep.id,
      subject: schema.sequenceStep.subject,
      content: schema.sequenceStep.content,
      sequenceActive: schema.sequence.active,
      contactId: schema.contact.id,
      email: schema.contact.email,
      firstName: schema.contact.firstName,
      lastName: schema.contact.lastName,
      contactStatus: schema.contact.status,
      unsubscribeToken: schema.contact.unsubscribeToken,
    })
    .from(schema.sequenceLog)
    .innerJoin(
      schema.sequenceStep,
      eq(schema.sequenceLog.sequenceStepId, schema.sequenceStep.id),
    )
    .innerJoin(schema.sequence, eq(schema.sequenceStep.sequenceId, schema.sequence.id))
    .innerJoin(schema.contact, eq(schema.sequenceLog.contactId, schema.contact.id))
    .where(
      and(
        eq(schema.sequenceLog.status, "geplant"),
        lte(schema.sequenceLog.dueAt, now),
      ),
    );

  let enqueued = 0;
  for (const row of due) {
    // Pausierte Sequenz: geplant lassen (läuft nach Reaktivierung weiter)
    if (!row.sequenceActive) continue;
    // Abgemeldete/gelöschte Kontakte: Schritt abbrechen
    if (row.contactStatus !== "aktiv") {
      await db
        .update(schema.sequenceLog)
        .set({ status: "abgebrochen" })
        .where(eq(schema.sequenceLog.id, row.logId));
      continue;
    }

    const unsubscribeUrl = `${getBaseUrl()}/newsletter/abmelden/${row.unsubscribeToken}`;
    const rendered = renderEmail({
      markdown: row.content,
      firstName: row.firstName,
      lastName: row.lastName,
      unsubscribeUrl,
    });
    await enqueueEmail({
      toEmail: row.email,
      subject: row.subject,
      html: rendered.html,
      textBody: rendered.text,
      contactId: row.contactId,
      sequenceLogId: row.logId,
      unsubscribeUrl,
    });
    // Doppel-Einreihung verhindern; "versendet" wird erst nach echtem Versand
    // durch die Mail-Queue gesetzt.
    await db
      .update(schema.sequenceLog)
      .set({ status: "eingereiht" })
      .where(eq(schema.sequenceLog.id, row.logId));
    enqueued++;
  }
  return enqueued;
}
