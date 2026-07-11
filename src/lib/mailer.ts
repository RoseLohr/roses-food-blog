/**
 * SMTP-Versand (Nodemailer), Konfiguration ausschließlich über .env (A2).
 * Baut aus Markdown-Inhalten eine responsive HTML-Mail + Textversion;
 * jede Mail enthält Abmeldelink und Absenderangaben (Akzeptanzkriterium 13).
 */
import nodemailer, { type Transporter } from "nodemailer";
import { renderMarkdown } from "./markdown";
import { getBaseUrl } from "./base-url";
import { t } from "@/i18n/de";

const dict = t();

let transporter: Transporter | null = null;

export function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

/** Nur für Tests: Transport ersetzen. */
export function setTransporterForTesting(tp: Transporter | null): void {
  transporter = tp;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/**
 * Markdown → responsive HTML-Mail + Textversion.
 * {{vorname}} / {{nachname}} werden ersetzt; der Abmelde-Footer ist Pflicht.
 */
export function renderEmail(options: {
  markdown: string;
  firstName?: string;
  lastName?: string;
  unsubscribeUrl: string;
}): RenderedEmail {
  const filled = options.markdown
    .replaceAll("{{vorname}}", options.firstName ?? "")
    .replaceAll("{{nachname}}", options.lastName ?? "")
    .replace(/[ \t]+\n/g, "\n");

  const bodyHtml = renderMarkdown(filled);
  const footerHtml = `
    <hr style="border:none;border-top:1px solid #e5ddd1;margin:24px 0;">
    <p style="font-size:12px;color:#8a8378;line-height:1.6;">
      ${dict.email.footerSender}: ${dict.site.name} · <a href="${getBaseUrl()}" style="color:#b0413e;">${getBaseUrl()}</a><br>
      ${process.env.SMTP_FROM ?? ""}<br>
      <a href="${options.unsubscribeUrl}" style="color:#8a8378;">${dict.email.unsubscribe}</a>
    </p>`;

  const html = `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#faf6f0;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:Georgia,'Times New Roman',serif;color:#2d2a26;font-size:16px;line-height:1.6;">
    <div style="background:#ffffff;border-radius:12px;padding:32px 24px;">
      ${bodyHtml}
      ${footerHtml}
    </div>
  </div>
</body>
</html>`;

  const text = `${filled}\n\n--\n${dict.site.name} · ${getBaseUrl()}\n${dict.email.unsubscribe}: ${options.unsubscribeUrl}`;

  return { html, text };
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string;
}): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    headers: options.unsubscribeUrl
      ? {
          "List-Unsubscribe": `<${options.unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : undefined,
  });
}
