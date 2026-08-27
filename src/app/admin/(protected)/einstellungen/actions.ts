"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getBaseUrl } from "@/lib/base-url";
import { renderEmail, sendEmail } from "@/lib/mailer";
import {
  clearAnthropicApiKey,
  removeSettings,
  setSettings,
  type SettingKey,
} from "@/lib/settings";
import { enableAiFeature, haltAiFeature } from "@/lib/ai-guard";
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
    // Marke: leere Namensteile fallen im Frontend auf den Standard zurück;
    // leeres Logo-Feld (Auswahl entfernt) löscht das Bild-Logo.
    site_title_accent: str("site_title_accent"),
    site_title_word: str("site_title_word"),
    site_logo_image_id: str("site_logo_image_id"),
    nachtmodus: str("nachtmodus"),
  };
  // Nachtmodus-Standort: Ein leeres Feld ENTFERNT den Eintrag, statt ihn leer
  // zu schreiben. „Leer" und „gar nicht gesetzt" bedeuten hier dasselbe (beides
  // ergibt den Vorgabe-Standort) — eine leere Zeile wäre also eine Zeile ohne
  // Auskunft. Sie legte sich bei JEDEM Speichern neu an, auch wenn der Nutzer
  // die Felder nie angefasst hat, und die E2E-Zustandsprüfung meldete das
  // zu Recht als Rückstand.
  const leer: SettingKey[] = [];
  for (const k of ["nachtmodus_breite", "nachtmodus_laenge"] as const) {
    const wert = str(k);
    if (wert) values[k] = wert;
    else leer.push(k);
  }
  removeSettings(leer);
  // Passwort / API-Schlüssel / Token nur überschreiben, wenn ein neuer Wert eingegeben wurde.
  const pass = str("smtp_pass");
  if (pass) values.smtp_pass = pass;
  const aiKey = str("anthropic_api_key");
  if (aiKey) values.anthropic_api_key = aiKey;
  const deployToken = str("deploy_github_token");
  if (deployToken) values.deploy_github_token = deployToken;

  // Der KI-Kill-Switch wird hier BEWUSST NICHT angefasst — siehe
  // setAiEnabledAction/haltAiAction.
  setSettings(values);
  // Das LAYOUT muss neu gerechnet werden, nicht nur die Seite: Der Nachtmodus
  // wird dort entschieden. Nach einer Server-Action navigiert Next
  // clientseitig und behält das Layout-Segment — ohne diese Zeile stellte man
  // „dunkel" ein, landete auf einer hellen Seite und hielte die Einstellung
  // für kaputt. Sie greift erst beim harten Neuladen. Gemessen in
  // tests/e2e/nachtmodus.spec.ts.
  revalidatePath("/admin", "layout");
  back(d.saved);
}

/**
 * KI-Assistent einschalten bzw. abschalten — bewusst als eigene Aktionen,
 * nicht als Feld im Speichern-Formular (Befund gpt-5.6-sol, PR #61).
 *
 * Ein Kästchen trägt den Zustand vom Zeitpunkt des Seitenaufbaus. Feuert der
 * Auto-Halt, während die Seite offen liegt, würde das nächste Speichern
 * irgendeiner unbeteiligten Einstellung den veralteten Wert „an" zurück-
 * schreiben und den fail-closed Schalter ohne Absicht wieder öffnen. Als
 * eigene Aktion gibt es diesen Lese-Schreib-Abstand nicht: es wird nur
 * geschaltet, wenn genau das angeklickt wurde.
 */
export async function enableAiAction(): Promise<void> {
  await requireAdmin();
  enableAiFeature();
  back(d.aiTurnedOn);
}

export async function haltAiAction(): Promise<void> {
  await requireAdmin();
  haltAiFeature("im Panel abgeschaltet");
  back(d.aiTurnedOff);
}

/**
 * Entfernt den im Panel gespeicherten Anthropic-Schlüssel.
 *
 * Bewusst eine EIGENE Aktion statt eines Kästchens im Speichern-Formular: das
 * Schlüsselfeld behält nach dem Speichern seinen getippten Inhalt (unkontrol-
 * liertes Feld, Client-Navigation). Ein Kästchen hätte also mal gelöscht und
 * mal nicht — je nachdem, ob noch Text im Feld stand. Diese Aktion sieht das
 * Feld gar nicht erst an.
 */
export async function clearAiKeyAction(): Promise<void> {
  await requireAdmin();
  clearAnthropicApiKey();
  back(d.aiKeyDeleted);
}

export async function sendTestEmailAction(): Promise<void> {
  const admin = await requireAdmin();
  let message: string;
  try {
    const email = renderEmail({
      markdown:
        "Dies ist eine **Testmail** von Rose’s Gourmet Compass.\n\nWenn du sie erhältst, ist der SMTP-Versand korrekt eingerichtet.",
      unsubscribeUrl: getBaseUrl(),
    });
    await sendEmail({
      to: admin.email,
      subject: "Testmail – Rose’s Gourmet Compass",
      html: email.html,
      text: email.text,
    });
    message = `${d.testSent} ${admin.email}`;
  } catch (err) {
    message = `${d.testFailed} ${err instanceof Error ? err.message : ""}`;
  }
  back(message);
}
