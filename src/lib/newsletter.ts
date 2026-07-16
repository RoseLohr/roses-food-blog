/**
 * Newsletter-Kern (Double-Opt-in, DSGVO):
 * Anmeldung → Status "unbestaetigt" + Bestätigungsmail mit Token →
 * Klick → "aktiv" (consentAt gespeichert, Quelle/Interessen zugeordnet,
 * Willkommenssequenz geplant). Abmeldung per One-Click-Token.
 */
import crypto from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getBaseUrl } from "./base-url";
import { recordContactActivity } from "./email-queue";
import { renderEmail, sendEmail } from "./mailer";
import { scheduleSequencesForContact } from "./sequences";
import { t } from "@/i18n/de";

const dict = t();

function token(): string {
  return crypto.randomBytes(24).toString("hex");
}

export const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  firstName: z.string().trim().max(100).default(""),
  lastName: z.string().trim().max(100).default(""),
  interestIds: z.array(z.number().int().positive()).default([]),
  source: z.string().trim().max(200).default(""),
  consent: z.literal(true),
});

export type SubscribeInput = z.infer<typeof subscribeSchema>;

export type SubscribeResult =
  | { ok: true }
  | { ok: false; error: "ungueltig" | "mailfehler" };

export function confirmUrl(confirmToken: string): string {
  return `${getBaseUrl()}/newsletter/bestaetigen/${confirmToken}`;
}

export function unsubscribeUrl(unsubToken: string): string {
  return `${getBaseUrl()}/newsletter/abmelden/${unsubToken}`;
}

async function sendConfirmationMail(contact: {
  email: string;
  firstName: string;
  lastName: string;
  confirmToken: string;
  unsubscribeToken: string;
}): Promise<void> {
  const markdown = dict.newsletter.confirmMailBody(
    confirmUrl(contact.confirmToken),
  );
  const rendered = renderEmail({
    markdown,
    firstName: contact.firstName,
    lastName: contact.lastName,
    unsubscribeUrl: unsubscribeUrl(contact.unsubscribeToken),
  });
  await sendEmail({
    to: contact.email,
    subject: dict.newsletter.confirmMailSubject,
    html: rendered.html,
    text: rendered.text,
    unsubscribeUrl: unsubscribeUrl(contact.unsubscribeToken),
  });
}

/**
 * Anmeldung verarbeiten. Verhält sich bei bereits aktiven Kontakten
 * nach außen identisch (kein E-Mail-Enumeration-Leck).
 */
export async function subscribeContact(
  input: SubscribeInput,
): Promise<SubscribeResult> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(schema.contact)
    .where(eq(schema.contact.email, input.email));

  let contactId: number;
  let confirmToken: string;
  let unsubToken: string;

  if (existing) {
    if (existing.status === "aktiv") {
      // Bereits aktiv: nichts tun, nach außen Erfolg melden
      return { ok: true };
    }
    confirmToken = token();
    unsubToken = existing.unsubscribeToken;
    await db
      .update(schema.contact)
      .set({
        firstName: input.firstName || existing.firstName,
        lastName: input.lastName || existing.lastName,
        status: "unbestaetigt",
        source: input.source || existing.source,
        signupAt: now,
        confirmToken,
        anonymizedAt: null,
      })
      .where(eq(schema.contact.id, existing.id));
    contactId = existing.id;
  } else {
    confirmToken = token();
    unsubToken = token();
    const [created] = await db
      .insert(schema.contact)
      .values({
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        status: "unbestaetigt",
        source: input.source,
        signupAt: now,
        confirmToken,
        unsubscribeToken: unsubToken,
        createdAt: now,
      })
      .returning();
    contactId = created.id;
  }

  // Interessen zuordnen (ersetzen) — nur wenn welche mitgeschickt wurden.
  // Die schlanke Box übermittelt keine Interessen mehr (die kommen erst im
  // Willkommensschritt); ohne diese Bedingung würde eine Wiederanmeldung die
  // zuvor gewählten Interessen eines Kontakts löschen.
  if (input.interestIds.length) {
    await db
      .delete(schema.contactInterest)
      .where(eq(schema.contactInterest.contactId, contactId));
    const valid = await db
      .select({ id: schema.interest.id })
      .from(schema.interest)
      .where(inArray(schema.interest.id, input.interestIds));
    if (valid.length) {
      await db.insert(schema.contactInterest).values(
        valid.map((i) => ({ contactId, interestId: i.id })),
      );
    }
  }

  await recordContactActivity(contactId, "anmeldung", input.source);

  try {
    await sendConfirmationMail({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      confirmToken,
      unsubscribeToken: unsubToken,
    });
  } catch (err) {
    console.error("[newsletter] Bestätigungsmail fehlgeschlagen:", err);
    return { ok: false, error: "mailfehler" };
  }
  return { ok: true };
}

export type ConfirmOutcome = "bestaetigt" | "bereits_aktiv" | "ungueltig";

/** Kontaktdaten für den optionalen Willkommensschritt nach der Bestätigung. */
export interface ConfirmProfile {
  /** Schlüssel, mit dem der Willkommensschritt den Kontakt ergänzt. */
  unsubscribeToken: string;
  firstName: string;
  lastName: string;
  interestIds: number[];
}

export interface ConfirmResult {
  outcome: ConfirmOutcome;
  /** nur bei „bestaetigt" gesetzt (frisch bestätigter Kontakt) */
  profile?: ConfirmProfile;
}

/** Double-Opt-in-Bestätigung: Token → Status "aktiv", Einwilligung speichern. */
export async function confirmContact(confirmToken: string): Promise<ConfirmResult> {
  if (!/^[a-f0-9]{48}$/.test(confirmToken)) return { outcome: "ungueltig" };
  const [contact] = await db
    .select()
    .from(schema.contact)
    .where(eq(schema.contact.confirmToken, confirmToken));
  if (!contact) return { outcome: "ungueltig" };
  if (contact.status === "aktiv") return { outcome: "bereits_aktiv" };

  await db
    .update(schema.contact)
    .set({
      status: "aktiv",
      consentAt: new Date(),
      confirmToken: null,
    })
    .where(eq(schema.contact.id, contact.id));
  await recordContactActivity(contact.id, "bestaetigung");
  await scheduleSequencesForContact(contact.id);

  const rows = await db
    .select({ interestId: schema.contactInterest.interestId })
    .from(schema.contactInterest)
    .where(eq(schema.contactInterest.contactId, contact.id));
  return {
    outcome: "bestaetigt",
    profile: {
      unsubscribeToken: contact.unsubscribeToken,
      firstName: contact.firstName,
      lastName: contact.lastName,
      interestIds: rows.map((r) => r.interestId),
    },
  };
}

/**
 * Im Anmeldefluss angebotene Interessen. Bewusst auf die beiden inhaltlichen
 * Säulen des Blogs beschränkt (Reisen, Rezepte) — weitere Interessen bleiben
 * fürs CRM nutzbar, werden Leser:innen aber nicht zur Auswahl gestellt.
 */
export const OFFERED_INTEREST_NAMES = ["Reisen", "Rezepte"];

export async function getOfferedInterests(): Promise<
  Array<{ id: number; name: string }>
> {
  const all = await db
    .select({ id: schema.interest.id, name: schema.interest.name })
    .from(schema.interest)
    .orderBy(asc(schema.interest.name));
  const allow = new Set(OFFERED_INTEREST_NAMES.map((n) => n.toLowerCase()));
  return all.filter((i) => allow.has(i.name.toLowerCase()));
}

export const profileSchema = z.object({
  firstName: z.string().trim().max(100).default(""),
  lastName: z.string().trim().max(100).default(""),
  interestIds: z.array(z.number().int().positive()).default([]),
});
export type ProfileInput = z.infer<typeof profileSchema>;

/**
 * Optionaler Willkommensschritt: ergänzt Name & Interessen eines bereits
 * bestätigten Kontakts, identifiziert über seinen Abmelde-Token (dieselbe
 * Berechtigung wie der Link in jeder E-Mail). Interessen werden auf die im
 * Anmeldefluss angebotenen beschränkt. Gibt false zurück, wenn der Token nicht
 * passt oder der Kontakt nicht aktiv ist.
 */
export async function updateContactProfile(
  unsubToken: string,
  input: ProfileInput,
): Promise<boolean> {
  if (!/^[a-f0-9]{48}$/.test(unsubToken)) return false;
  const [contact] = await db
    .select()
    .from(schema.contact)
    .where(eq(schema.contact.unsubscribeToken, unsubToken));
  if (!contact || contact.status !== "aktiv") return false;

  const offered = await getOfferedInterests();
  const offeredIds = new Set(offered.map((o) => o.id));
  const interestIds = [...new Set(input.interestIds)].filter((id) =>
    offeredIds.has(id),
  );

  await db
    .update(schema.contact)
    .set({
      firstName: input.firstName || contact.firstName,
      lastName: input.lastName || contact.lastName,
    })
    .where(eq(schema.contact.id, contact.id));

  // Angebotene Interessen ersetzen; etwaige nicht angebotene bleiben unberührt.
  if (offeredIds.size) {
    await db
      .delete(schema.contactInterest)
      .where(
        and(
          eq(schema.contactInterest.contactId, contact.id),
          inArray(schema.contactInterest.interestId, [...offeredIds]),
        ),
      );
  }
  if (interestIds.length) {
    await db.insert(schema.contactInterest).values(
      interestIds.map((interestId) => ({ contactId: contact.id, interestId })),
    );
  }
  return true;
}

export type UnsubscribeResult = "abgemeldet" | "ungueltig";

/** One-Click-Abmeldung über den Token aus jeder Mail. */
export async function unsubscribeContact(
  unsubToken: string,
): Promise<UnsubscribeResult> {
  if (!/^[a-f0-9]{48}$/.test(unsubToken)) return "ungueltig";
  const [contact] = await db
    .select()
    .from(schema.contact)
    .where(eq(schema.contact.unsubscribeToken, unsubToken));
  if (!contact) return "ungueltig";

  if (contact.status !== "abgemeldet") {
    await db
      .update(schema.contact)
      .set({ status: "abgemeldet" })
      .where(eq(schema.contact.id, contact.id));
    await recordContactActivity(contact.id, "abmeldung");
  }
  return "abgemeldet";
}
