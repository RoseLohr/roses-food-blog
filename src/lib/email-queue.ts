/**
 * E-Mail-Warteschlange (Annahme B6): Massenversand (Kampagnen, Sequenzen)
 * läuft über die Tabelle email_queue; der Cron verarbeitet minütlich mit
 * Ratenbegrenzung EMAIL_RATE_PER_MINUTE. Fehlversuche werden bis zu
 * 3-mal mit Verzögerung wiederholt.
 */
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { sendEmail } from "./mailer";
import { getEmailRatePerMinute } from "./settings";

const MAX_ATTEMPTS = 3;

export interface EnqueueEmail {
  toEmail: string;
  subject: string;
  html: string;
  textBody: string;
  contactId?: number | null;
  campaignId?: number | null;
  sequenceStepId?: number | null;
  scheduledAt?: Date;
}

export async function enqueueEmail(mail: EnqueueEmail): Promise<void> {
  await db.insert(schema.emailQueue).values({
    toEmail: mail.toEmail,
    subject: mail.subject,
    html: mail.html,
    textBody: mail.textBody,
    contactId: mail.contactId ?? null,
    campaignId: mail.campaignId ?? null,
    sequenceStepId: mail.sequenceStepId ?? null,
    status: "wartend",
    scheduledAt: mail.scheduledAt ?? new Date(),
    createdAt: new Date(),
  });
}

/** Verarbeitet fällige Mails (Rate: EMAIL_RATE_PER_MINUTE je Lauf). */
export async function processEmailQueue(): Promise<{
  sent: number;
  failed: number;
}> {
  const rate = getEmailRatePerMinute();
  const now = new Date();

  const due = await db
    .select()
    .from(schema.emailQueue)
    .where(
      and(
        eq(schema.emailQueue.status, "wartend"),
        lte(schema.emailQueue.scheduledAt, now),
      ),
    )
    .orderBy(asc(schema.emailQueue.scheduledAt))
    .limit(rate);

  let sent = 0;
  let failed = 0;

  for (const mail of due) {
    try {
      await sendEmail({
        to: mail.toEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.textBody,
      });
      await db
        .update(schema.emailQueue)
        .set({ status: "versendet", sentAt: new Date(), attempts: mail.attempts + 1 })
        .where(eq(schema.emailQueue.id, mail.id));
      sent++;
      await afterQueuedMailSent(mail);
    } catch (err) {
      failed++;
      const attempts = mail.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db
        .update(schema.emailQueue)
        .set({
          status: giveUp ? "fehlgeschlagen" : "wartend",
          attempts,
          lastError: err instanceof Error ? err.message.slice(0, 500) : "unbekannt",
          // Wiederholung mit Verzögerung (15 Minuten je Versuch)
          scheduledAt: giveUp
            ? mail.scheduledAt
            : new Date(Date.now() + attempts * 15 * 60 * 1000),
        })
        .where(eq(schema.emailQueue.id, mail.id));
      if (giveUp) await afterQueuedMailFailed(mail);
    }
  }
  return { sent, failed };
}

type QueuedMail = typeof schema.emailQueue.$inferSelect;

/** Versandprotokolle und „letzter Kontakt" nach erfolgreichem Versand pflegen. */
async function afterQueuedMailSent(mail: QueuedMail): Promise<void> {
  const now = new Date();
  if (mail.campaignId && mail.contactId) {
    await db
      .update(schema.campaignLog)
      .set({ status: "versendet", sentAt: now })
      .where(
        and(
          eq(schema.campaignLog.campaignId, mail.campaignId),
          eq(schema.campaignLog.contactId, mail.contactId),
        ),
      );
    await recordContactActivity(mail.contactId, "kampagne", mail.subject);
    // Kampagne abschließen, wenn nichts mehr aussteht
    const [open] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(schema.campaignLog)
      .where(
        and(
          eq(schema.campaignLog.campaignId, mail.campaignId),
          eq(schema.campaignLog.status, "eingereiht"),
        ),
      );
    if (open.n === 0) {
      await db
        .update(schema.campaign)
        .set({ status: "versendet" })
        .where(eq(schema.campaign.id, mail.campaignId));
    }
  }
  if (mail.sequenceStepId && mail.contactId) {
    await db
      .update(schema.sequenceLog)
      .set({ status: "versendet", sentAt: now })
      .where(
        and(
          eq(schema.sequenceLog.sequenceStepId, mail.sequenceStepId),
          eq(schema.sequenceLog.contactId, mail.contactId),
        ),
      );
    await recordContactActivity(mail.contactId, "sequenzmail", mail.subject);
  }
}

async function afterQueuedMailFailed(mail: QueuedMail): Promise<void> {
  if (mail.campaignId && mail.contactId) {
    await db
      .update(schema.campaignLog)
      .set({ status: "fehlgeschlagen", error: mail.lastError })
      .where(
        and(
          eq(schema.campaignLog.campaignId, mail.campaignId),
          eq(schema.campaignLog.contactId, mail.contactId),
        ),
      );
  }
  if (mail.sequenceStepId && mail.contactId) {
    await db
      .update(schema.sequenceLog)
      .set({ status: "fehlgeschlagen" })
      .where(
        and(
          eq(schema.sequenceLog.sequenceStepId, mail.sequenceStepId),
          eq(schema.sequenceLog.contactId, mail.contactId),
        ),
      );
  }
}

/** Aktivität protokollieren und „letzter Kontakt" aktualisieren (B13). */
export async function recordContactActivity(
  contactId: number,
  type: "anmeldung" | "bestaetigung" | "kampagne" | "sequenzmail" | "abmeldung" | "notiz",
  detail = "",
): Promise<void> {
  const now = new Date();
  await db.insert(schema.contactActivity).values({
    contactId,
    type,
    detail: detail.slice(0, 500),
    createdAt: now,
  });
  await db
    .update(schema.contact)
    .set({ lastContactAt: now })
    .where(eq(schema.contact.id, contactId));
}
