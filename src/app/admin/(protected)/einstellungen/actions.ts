"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getBaseUrl } from "@/lib/base-url";
import { renderEmail, sendEmail } from "@/lib/mailer";
import { setSettings, type SettingKey } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.settings;

function back(message: string): never {
  redirect(`/admin/einstellungen?meldung=${encodeURIComponent(message)}`);
}

export async function saveSettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const str = (k: string) => String(formData.get(k) ?? "").trim();

  const values: Partial<Record<SettingKey, string>> = {
    smtp_host: str("smtp_host"),
    smtp_port: str("smtp_port"),
    smtp_user: str("smtp_user"),
    smtp_from: str("smtp_from"),
    email_rate: str("email_rate"),
    deploy_repo: str("deploy_repo"),
    deploy_branch: str("deploy_branch"),
  };
  // Passwort / API-Schlüssel nur überschreiben, wenn ein neuer Wert eingegeben wurde.
  const pass = str("smtp_pass");
  if (pass) values.smtp_pass = pass;
  const aiKey = str("anthropic_api_key");
  if (aiKey) values.anthropic_api_key = aiKey;

  setSettings(values);
  back(d.saved);
}

export async function sendTestEmailAction(): Promise<void> {
  const admin = await requireAdmin();
  let message: string;
  try {
    const email = renderEmail({
      markdown:
        "Dies ist eine **Testmail** von Roses Food Blog.\n\nWenn du sie erhältst, ist der SMTP-Versand korrekt eingerichtet.",
      unsubscribeUrl: getBaseUrl(),
    });
    await sendEmail({
      to: admin.email,
      subject: "Testmail – Roses Food Blog",
      html: email.html,
      text: email.text,
    });
    message = `${d.testSent} ${admin.email}`;
  } catch (err) {
    message = `${d.testFailed} ${err instanceof Error ? err.message : ""}`;
  }
  back(message);
}
