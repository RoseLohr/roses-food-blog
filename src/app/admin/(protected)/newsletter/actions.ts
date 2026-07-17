"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { setSettings } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();

/**
 * Schaltet die Newsletter-Anmeldebox im Frontend sichtbar/unsichtbar.
 * Gespeichert als Einstellung „newsletter_visible" ("1"/"0").
 */
export async function saveNewsletterDisplayAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  const visible = formData.get("sichtbar") === "ja";
  setSettings({ newsletter_visible: visible ? "1" : "0" });
  redirect(
    `/admin/newsletter?meldung=${encodeURIComponent(
      dict.admin.newsletterDisplay.saved,
    )}`,
  );
}
