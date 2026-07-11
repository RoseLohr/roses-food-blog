"use server";

import { subscribeContact, subscribeSchema } from "@/lib/newsletter";
import { rateLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/request";
import { t } from "@/i18n/de";

const dict = t();

export interface NewsletterFormState {
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
