"use server";

import {
  profileSchema,
  subscribeContact,
  subscribeSchema,
  updateContactProfile,
} from "@/lib/newsletter";
import { rateLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/request";
import { t } from "@/i18n/de";

const dict = t();

export interface NewsletterFormState {
  success?: string;
  error?: string;
}

export interface ProfileFormState {
  success?: string;
  error?: string;
}

export async function subscribeAction(
  _prev: NewsletterFormState,
  formData: FormData,
): Promise<NewsletterFormState> {
  const ip = await getClientIp();
  if (!rateLimit(`newsletter:${ip}`, 5, 15 * 60 * 1000).ok) {
    return { error: dict.common.tooManyRequests };
  }

  const parsed = subscribeSchema.safeParse({
    email: formData.get("email"),
    firstName: formData.get("vorname") ?? "",
    lastName: formData.get("nachname") ?? "",
    interestIds: formData.getAll("interessen").map((v) => Number(v)),
    source: formData.get("quelle") ?? "",
    consent: formData.get("einwilligung") === "ja",
  });
  if (!parsed.success) return { error: dict.newsletter.errorInvalid };

  const result = await subscribeContact(parsed.data);
  if (!result.ok) {
    return {
      error:
        result.error === "mailfehler"
          ? dict.newsletter.errorMail
          : dict.newsletter.errorInvalid,
    };
  }
  return { success: dict.newsletter.successMessage };
}

/**
 * Willkommensschritt nach der Bestätigung: ergänzt optional Name & Interessen.
 * Kontakt wird über seinen Abmelde-Token identifiziert (versteckt im Formular).
 */
export async function saveProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const ip = await getClientIp();
  if (!rateLimit(`profile:${ip}`, 10, 15 * 60 * 1000).ok) {
    return { error: dict.common.tooManyRequests };
  }

  const token = String(formData.get("token") ?? "");
  const parsed = profileSchema.safeParse({
    firstName: formData.get("vorname") ?? "",
    lastName: formData.get("nachname") ?? "",
    interestIds: formData
      .getAll("interessen")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0),
  });
  if (!parsed.success) return { error: dict.common.error };

  const ok = await updateContactProfile(token, parsed.data);
  if (!ok) return { error: dict.common.error };
  return { success: dict.newsletter.welcomeSaved };
}
