/**
 * C-04 — Erasure end-to-end gegen echtes SQLite (Kanarien-Subjekt).
 *
 * Ein Löschbegehren muss WIRKLICH löschen — über ALLE abgeleiteten Stores, nicht
 * nur die Kontakt-Zeile. Der Test sät eine eindeutige Kanarien-Adresse in jeden
 * personenbezogenen Store, ruft anonymizeContact und behauptet: **kein PII-Rest**.
 *
 * Der Kanarien-Datensatz „email_queue ohne contactId" (Testversand) ist die
 * Regression, die die Härtung schließt: der alte Pfad löschte nur per contactId
 * und ließ diese Zeile stehen — rot vorher, grün nachher.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
const CANARY = "kanarie-loeschtest@example.invalid";

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-erasure-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Erasure (anonymizeContact) — kein PII-Rest über alle Stores", () => {
  it("entfernt die Kanarien-Adresse aus jedem abgeleiteten Store", async () => {
    const { db, schema } = await import("@/db");
    const { anonymizeContact } = await import("@/lib/contacts");
    const { eq, or } = await import("drizzle-orm");

    // --- Fixtures: Kanarien-Subjekt in jeden Store säen ---
    const [interest] = await db.insert(schema.interest).values({ name: "Kanarien-Interesse" }).returning();
    const [tag] = await db.insert(schema.contactTag).values({ name: "Kanarien-Tag" }).returning();
    const [segment] = await db.insert(schema.segment).values({ name: "Kanarien-Segment", createdAt: new Date() }).returning();

    const [contact] = await db
      .insert(schema.contact)
      .values({
        email: CANARY,
        firstName: "Kanarie",
        lastName: "Löschtest",
        source: `Rezeptseite: ${CANARY}`,
        notes: `Notiz mit ${CANARY}`,
        status: "aktiv",
        signupAt: new Date(),
        consentAt: new Date(),
        unsubscribeToken: "unsub-canary-token",
        confirmToken: "confirm-canary-token",
        createdAt: new Date(),
      })
      .returning();
    const cid = contact.id;

    await db.insert(schema.contactInterest).values({ contactId: cid, interestId: interest.id });
    await db.insert(schema.contactTagAssign).values({ contactId: cid, tagId: tag.id });
    await db.insert(schema.contactSegment).values({ contactId: cid, segmentId: segment.id });
    await db.insert(schema.contactActivity).values({ contactId: cid, type: "anmeldung", detail: `Anmeldung von ${CANARY}`, createdAt: new Date() });

    // email_queue: MIT contactId …
    await db.insert(schema.emailQueue).values({
      toEmail: CANARY, subject: "Willkommen", html: `<p>${CANARY}</p>`, textBody: CANARY,
      contactId: cid, status: "wartend", scheduledAt: new Date(), createdAt: new Date(),
    });
    // … UND OHNE contactId (Testversand) — die Regression, die die Härtung schließt.
    await db.insert(schema.emailQueue).values({
      toEmail: CANARY, subject: "Testversand", html: `<p>${CANARY}</p>`, textBody: CANARY,
      contactId: null, status: "wartend", scheduledAt: new Date(), createdAt: new Date(),
    });
    // … UND Body-eingebettete PII bei ABWEICHENDEM Empfänger (Admin-Benachrichtigung
    // „Neue Anmeldung: <adresse>") — die Adresse steckt im Rumpf, nicht im to_email
    // (der Bypass, den der adversariale Verifier fand).
    await db.insert(schema.emailQueue).values({
      toEmail: "admin@rosesfood.example", subject: `Neue Anmeldung: ${CANARY}`,
      html: `<p>Neuer Kontakt: ${CANARY}</p>`, textBody: `Neuer Kontakt: ${CANARY}`,
      contactId: null, status: "wartend", scheduledAt: new Date(), createdAt: new Date(),
    });

    const [campaign] = await db
      .insert(schema.campaign)
      .values({ subject: "Kanarien-Kampagne", createdAt: new Date() })
      .returning();
    await db.insert(schema.campaignLog).values({
      campaignId: campaign.id, contactId: cid, status: "fehlgeschlagen", error: `SMTP-Fehler für ${CANARY}`,
    });

    // --- Erasure ---
    const ok = await anonymizeContact(cid);
    expect(ok).toBe(true);

    // --- Assertions: kein PII-Rest ---
    const [c] = await db.select().from(schema.contact).where(eq(schema.contact.id, cid));
    expect(c.email).not.toBe(CANARY);
    expect(c.firstName).toBe("");
    expect(c.lastName).toBe("");
    expect(c.notes).toBe("");
    expect(c.source).toBe("");
    expect(c.anonymizedAt).not.toBeNull();

    const ci = await db.select().from(schema.contactInterest).where(eq(schema.contactInterest.contactId, cid));
    const ct = await db.select().from(schema.contactTagAssign).where(eq(schema.contactTagAssign.contactId, cid));
    const cs = await db.select().from(schema.contactSegment).where(eq(schema.contactSegment.contactId, cid));
    expect(ci).toHaveLength(0);
    expect(ct).toHaveLength(0);
    expect(cs).toHaveLength(0);

    const ca = await db.select().from(schema.contactActivity).where(eq(schema.contactActivity.contactId, cid));
    for (const row of ca) expect(row.detail).toBe("");

    // email_queue: BEIDE Zeilen (mit + ohne contactId) müssen weg sein.
    const eqRows = await db
      .select()
      .from(schema.emailQueue)
      .where(or(eq(schema.emailQueue.contactId, cid), eq(schema.emailQueue.toEmail, CANARY)));
    expect(eqRows).toHaveLength(0);

    const cl = await db.select().from(schema.campaignLog).where(eq(schema.campaignLog.contactId, cid));
    for (const row of cl) expect(row.error).toBe("");

    // Globaler Kanarien-Scan: die Adresse darf in KEINEM PII-Store mehr vorkommen.
    const hay = JSON.stringify([
      await db.select().from(schema.contact),
      await db.select().from(schema.emailQueue),
      await db.select().from(schema.campaignLog),
      await db.select().from(schema.contactActivity),
    ]);
    expect(hay).not.toContain(CANARY);
  });
});
