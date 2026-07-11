"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { sendCampaign, sendCampaignTest } from "@/lib/campaigns";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.campaigns;

export async function saveCampaignAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const subject = String(formData.get("betreff") ?? "").trim();
  const content = String(formData.get("inhalt") ?? "").trim();
  const segmentId = formData.get("segment") ? Number(formData.get("segment")) : null;
  if (!subject) {
    redirect(`/admin/kampagnen?meldung=${encodeURIComponent(dict.common.error)}`);
  }

  let campaignId: number;
  if (id) {
    await db
      .update(schema.campaign)
      .set({ subject, content, segmentId })
      .where(eq(schema.campaign.id, id));
    campaignId = id;
  } else {
    const [created] = await db
      .insert(schema.campaign)
      .values({ subject, content, segmentId, createdAt: new Date() })
      .returning();
    campaignId = created.id;
  }
  redirect(
    `/admin/kampagnen/${campaignId}?meldung=${encodeURIComponent(d.saved)}`,
  );
}

export async function deleteCampaignAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    await db.delete(schema.campaign).where(eq(schema.campaign.id, id));
  }
  redirect(`/admin/kampagnen?meldung=${encodeURIComponent(d.deleted)}`);
}

export async function sendTestAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    await sendCampaignTest(id, admin.email);
  }
  redirect(`/admin/kampagnen/${id}?meldung=${encodeURIComponent(d.testSent)}`);
}

export async function sendCampaignAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) redirect("/admin/kampagnen");

  const result = await sendCampaign(id);
  const message = result.ok
    ? d.sendStarted(result.recipients)
    : result.error === "kein_segment"
      ? d.needsSegment
      : result.error === "bereits_versendet"
        ? d.alreadySent
        : result.error === "keine_empfaenger"
          ? d.noRecipients
          : dict.common.error;
  redirect(`/admin/kampagnen/${id}?meldung=${encodeURIComponent(message)}`);
}
