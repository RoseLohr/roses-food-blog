/**
 * Kontakt-Werkzeuge: CSV-Export und DSGVO-Anonymisierung.
 */
import crypto from "node:crypto";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export function contactsToCsv(
  rows: Array<{
    email: string;
    firstName: string;
    lastName: string;
    status: string;
    source: string;
    signupAt: Date;
    consentAt: Date | null;
    lastContactAt: Date | null;
    interests: string;
  }>,
): string {
  const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const header = [
    "E-Mail",
    "Vorname",
    "Nachname",
    "Status",
    "Quelle",
    "Anmeldung",
    "Einwilligung",
    "Letzter Kontakt",
    "Interessen",
  ].join(";");
  const lines = rows.map((r) =>
    [
      esc(r.email),
      esc(r.firstName),
      esc(r.lastName),
      esc(r.status),
      esc(r.source),
      r.signupAt.toISOString(),
      r.consentAt?.toISOString() ?? "",
      r.lastContactAt?.toISOString() ?? "",
      esc(r.interests),
    ].join(";"),
  );
  // BOM für Excel-Kompatibilität
  return "﻿" + [header, ...lines].join("\r\n");
}

/**
 * DSGVO-Anonymisierung: personenbezogene Daten entfernen, Statistik-Zeile
 * bleibt (anonymisiert) erhalten. Unwiderruflich.
 */
export async function anonymizeContact(contactId: number): Promise<boolean> {
  const [contact] = await db
    .select()
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId));
  if (!contact) return false;

  const now = new Date();
  const priorEmail = contact.email;
  await db
    .update(schema.contact)
    .set({
      email: `anonymisiert-${contactId}@geloescht.invalid`,
      firstName: "",
      lastName: "",
      source: "",
      notes: "",
      status: "abgemeldet",
      confirmToken: null,
      unsubscribeToken: crypto.randomBytes(24).toString("hex"),
      anonymizedAt: now,
    })
    .where(eq(schema.contact.id, contactId));

  await db
    .delete(schema.contactInterest)
    .where(eq(schema.contactInterest.contactId, contactId));
  await db
    .delete(schema.contactTagAssign)
    .where(eq(schema.contactTagAssign.contactId, contactId));
  await db
    .delete(schema.contactSegment)
    .where(eq(schema.contactSegment.contactId, contactId));
  // Aktivitätsdetails leeren (Typen/Zeitpunkte bleiben für Statistik)
  await db
    .update(schema.contactActivity)
    .set({ detail: "" })
    .where(eq(schema.contactActivity.contactId, contactId));
  // Mails an den Kontakt verwerfen — per contactId UND per gerenderter
  // Empfängeradresse (to_email), damit auch nicht-verknüpfte Queue-Zeilen
  // (z. B. Testversand ohne contactId) keinen PII-Rest hinterlassen.
  await db
    .delete(schema.emailQueue)
    .where(
      or(
        eq(schema.emailQueue.contactId, contactId),
        eq(schema.emailQueue.toEmail, priorEmail),
      ),
    );
  // Body-eingebettete PII: eine Mail an einen ANDEREN Empfänger (z. B. Admin-
  // Benachrichtigung „Neue Anmeldung: <adresse>") trägt die Adresse im
  // subject/html/textBody, nicht im to_email — die Löschung oben trifft sie nicht.
  // Solche Restvorkommen in-place redigieren.
  const placeholder = `anonymisiert-${contactId}@geloescht.invalid`;
  await db
    .update(schema.emailQueue)
    .set({
      subject: sql`replace(${schema.emailQueue.subject}, ${priorEmail}, ${placeholder})`,
      html: sql`replace(${schema.emailQueue.html}, ${priorEmail}, ${placeholder})`,
      textBody: sql`replace(${schema.emailQueue.textBody}, ${priorEmail}, ${placeholder})`,
    })
    .where(
      or(
        like(schema.emailQueue.subject, `%${priorEmail}%`),
        like(schema.emailQueue.html, `%${priorEmail}%`),
        like(schema.emailQueue.textBody, `%${priorEmail}%`),
      ),
    );
  await db
    .update(schema.sequenceLog)
    .set({ status: "abgebrochen" })
    .where(
      and(
        eq(schema.sequenceLog.contactId, contactId),
        inArray(schema.sequenceLog.status, ["geplant", "eingereiht"]),
      ),
    );
  // Versandprotokoll-Fehlertexte könnten die Adresse enthalten (SMTP-Fehler) —
  // für den Kontakt leeren; Zähl-/Zeitstatistik (contactId-FK, sentAt) bleibt.
  await db
    .update(schema.campaignLog)
    .set({ error: "" })
    .where(eq(schema.campaignLog.contactId, contactId));

  return true;
}
