/**
 * E-Mail-Warteschlange (Annahme B6): Massenversand (Kampagnen, Sequenzen)
 * läuft über die Tabelle email_queue; der Cron verarbeitet minütlich mit
 * Ratenbegrenzung EMAIL_RATE_PER_MINUTE. Fehlversuche werden bis zu
 * 3-mal mit Verzögerung wiederholt. Jede Zeile adressiert ihre Logzeile
 * direkt per FK (campaign_log_id / sequence_log_id); beide null =
 * Systemmail (z. B. Double-Opt-in-Bestätigung).
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
  campaignLogId?: number | null;
  sequenceLogId?: number | null;
  /** Abmelde-Link — wird als List-Unsubscribe-Header mitgesendet. */
  unsubscribeUrl?: string;
  scheduledAt?: Date;
}

export async function enqueueEmail(mail: EnqueueEmail): Promise<void> {
  await db.insert(schema.emailQueue).values({
    toEmail: mail.toEmail,
    subject: mail.subject,
    html: mail.html,
    textBody: mail.textBody,
    contactId: mail.contactId ?? null,
    campaignLogId: mail.campaignLogId ?? null,
    sequenceLogId: mail.sequenceLogId ?? null,
    unsubscribeUrl: mail.unsubscribeUrl ?? "",
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
        unsubscribeUrl: mail.unsubscribeUrl || undefined,
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
  if (mail.campaignLogId != null) {
    await db
      .update(schema.campaignLog)
      .set({ status: "versendet", sentAt: now })
      .where(eq(schema.campaignLog.id, mail.campaignLogId));
    if (mail.contactId != null) {
      await recordContactActivity(mail.contactId, "kampagne", mail.subject);
    }
    // Kampagne abschließen, wenn nichts mehr aussteht
    const [log] = await db
      .select({ campaignId: schema.campaignLog.campaignId })
      .from(schema.campaignLog)
      .where(eq(schema.campaignLog.id, mail.campaignLogId));
    if (log) {
      const [open] = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(schema.campaignLog)
        .where(
          and(
            eq(schema.campaignLog.campaignId, log.campaignId),
            eq(schema.campaignLog.status, "eingereiht"),
          ),
        );
      if (open.n === 0) {
        await db
          .update(schema.campaign)
          .set({ status: "versendet" })
          .where(eq(schema.campaign.id, log.campaignId));
      }
    }
  }
  if (mail.sequenceLogId != null) {
    await db
      .update(schema.sequenceLog)
      .set({ status: "versendet", sentAt: now })
      .where(eq(schema.sequenceLog.id, mail.sequenceLogId));
    if (mail.contactId != null) {
      await recordContactActivity(mail.contactId, "sequenzmail", mail.subject);
    }
  }
}

async function afterQueuedMailFailed(mail: QueuedMail): Promise<void> {
  if (mail.campaignLogId != null) {
    await db
      .update(schema.campaignLog)
      .set({ status: "fehlgeschlagen", error: mail.lastError })
      .where(eq(schema.campaignLog.id, mail.campaignLogId));
  }
  if (mail.sequenceLogId != null) {
    await db
      .update(schema.sequenceLog)
      .set({ status: "fehlgeschlagen" })
      .where(eq(schema.sequenceLog.id, mail.sequenceLogId));
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
