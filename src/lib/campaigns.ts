/**
 * Kampagnenversand: Testversand an Admin, Versand an ein Segment mit
 * Versandprotokoll je Kontakt (campaign_log) über die Mail-Queue.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { enqueueEmail } from "./email-queue";
import { renderEmail } from "./mailer";
import { unsubscribeUrl } from "./newsletter";
import { activeContactsForSegment } from "./segments";
import { getBaseUrl } from "./base-url";

export type SendCampaignResult =
  | { ok: true; recipients: number }
  | { ok: false; error: "nicht_gefunden" | "kein_segment" | "bereits_versendet" | "keine_empfaenger" };

/** Testversand: Kampagneninhalt an die Admin-Adresse (ohne Protokoll). */
export async function sendCampaignTest(
  campaignId: number,
  adminEmail: string,
): Promise<boolean> {
  const [campaign] = await db
    .select()
    .from(schema.campaign)
    .where(eq(schema.campaign.id, campaignId));
  if (!campaign) return false;

  const rendered = renderEmail({
    markdown: campaign.content,
    firstName: "Test",
    lastName: "Empfängerin",
    unsubscribeUrl: `${getBaseUrl()}/newsletter/abgemeldet`,
  });
  await enqueueEmail({
    toEmail: adminEmail,
    subject: `[TEST] ${campaign.subject}`,
    html: rendered.html,
    textBody: rendered.text,
  });
  return true;
}

/** Versand an alle aktiven Kontakte des Zielsegments. */
export async function sendCampaign(campaignId: number): Promise<SendCampaignResult> {
  const [campaign] = await db
    .select()
    .from(schema.campaign)
    .where(eq(schema.campaign.id, campaignId));
  if (!campaign) return { ok: false, error: "nicht_gefunden" };
  if (campaign.status !== "entwurf") return { ok: false, error: "bereits_versendet" };
  if (!campaign.segmentId) return { ok: false, error: "kein_segment" };

  const recipients = await activeContactsForSegment(campaign.segmentId);
  if (recipients.length === 0) return { ok: false, error: "keine_empfaenger" };

  await db
    .update(schema.campaign)
    .set({
      status: "laeuft",
      sentAt: new Date(),
      recipientCount: recipients.length,
    })
    .where(eq(schema.campaign.id, campaignId));

  for (const contact of recipients) {
    await db
      .insert(schema.campaignLog)
      .values({ campaignId, contactId: contact.id, status: "eingereiht" })
      .onConflictDoNothing();
    const rendered = renderEmail({
      markdown: campaign.content,
      firstName: contact.firstName,
      lastName: contact.lastName,
      unsubscribeUrl: unsubscribeUrl(contact.unsubscribeToken),
    });
    await enqueueEmail({
      toEmail: contact.email,
      subject: campaign.subject,
      html: rendered.html,
      textBody: rendered.text,
      contactId: contact.id,
      campaignId,
    });
  }
  return { ok: true, recipients: recipients.length };
}
