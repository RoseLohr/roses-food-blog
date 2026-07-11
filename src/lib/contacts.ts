/**
 * Kontakt-Werkzeuge: CSV-Export und DSGVO-Anonymisierung.
 */
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
  // Wartende Mails an den Kontakt verwerfen
  await db
    .delete(schema.emailQueue)
    .where(eq(schema.emailQueue.contactId, contactId));
  await db
    .update(schema.sequenceLog)
    .set({ status: "abgebrochen" })
    .where(
      and(
        eq(schema.sequenceLog.contactId, contactId),
        inArray(schema.sequenceLog.status, ["geplant", "eingereiht"]),
      ),
    );

  return true;
}
