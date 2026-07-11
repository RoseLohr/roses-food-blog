/**
 * Integrationstest CRM: Segmentregeln, Kampagnenversand mit Protokoll,
 * CSV-Export und Anonymisierung.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
const sentMails: Array<{ to: string; subject: string; html: string }> = [];

async function makeContact(email: string, status: string, interestIds: number[]) {
  const { db, schema } = await import("@/db");
  const crypto = await import("node:crypto");
  const [c] = await db
    .insert(schema.contact)
    .values({
      email,
      firstName: "Test",
      lastName: "Person",
      status: status as "aktiv",
      signupAt: new Date(),
      consentAt: status === "aktiv" ? new Date() : null,
      unsubscribeToken: crypto.randomBytes(24).toString("hex"),
      createdAt: new Date(),
    })
    .returning();
  if (interestIds.length) {
    await db
      .insert(schema.contactInterest)
      .values(interestIds.map((i) => ({ contactId: c.id, interestId: i })));
  }
  return c;
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-crm-"));
  process.env.DATA_DIR = tmp;
  process.env.BASE_URL = "https://blog.example.de";
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });

  const { setTransporterForTesting } = await import("@/lib/mailer");
  setTransporterForTesting({
    sendMail: async (opts: any) => {
      sentMails.push({ to: opts.to, subject: opts.subject, html: opts.html });
      return { messageId: "test" };
    },
  } as never);

  const { db, schema } = await import("@/db");
  await db.insert(schema.interest).values([{ name: "Rezepte" }, { name: "Reisen" }]);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Segmente", () => {
  it("regelbasiert (Interessen) plus manuelle Zuordnung", async () => {
    const { db, schema } = await import("@/db");
    const { contactIdsForSegment, activeContactsForSegment } = await import(
      "@/lib/segments"
    );

    const anna = await makeContact("anna@example.de", "aktiv", [1]);
    const ben = await makeContact("ben@example.de", "aktiv", [2]);
    const carla = await makeContact("carla@example.de", "aktiv", []);
    const dora = await makeContact("dora@example.de", "unbestaetigt", [1]);

    const [segment] = await db
      .insert(schema.segment)
      .values({
        name: "Rezepte-Fans",
        ruleInterestIds: JSON.stringify([1]),
        createdAt: new Date(),
      })
      .returning();
    // Carla manuell zuordnen
    await db
      .insert(schema.contactSegment)
      .values({ contactId: carla.id, segmentId: segment.id });

    const ids = await contactIdsForSegment(segment.id);
    expect(ids.sort()).toEqual([anna.id, carla.id, dora.id].sort());
    expect(ids).not.toContain(ben.id);

    // Versand nur an aktive
    const active = await activeContactsForSegment(segment.id);
    expect(active.map((c) => c.email).sort()).toEqual([
      "anna@example.de",
      "carla@example.de",
    ]);
  });
});

describe("Kampagnen", () => {
  it("versendet an Segment mit Protokoll und aktualisiert letzten Kontakt", async () => {
    const { db, schema } = await import("@/db");
    const { sendCampaign, sendCampaignTest } = await import("@/lib/campaigns");
    const { processEmailQueue } = await import("@/lib/email-queue");
    const { eq } = await import("drizzle-orm");

    const [segment] = await db.select().from(schema.segment);
    const [campaign] = await db
      .insert(schema.campaign)
      .values({
        subject: "Neue Sommerrezepte",
        content: "Hallo {{vorname}}, es gibt Neues!",
        segmentId: segment.id,
        createdAt: new Date(),
      })
      .returning();

    // Testversand
    expect(await sendCampaignTest(campaign.id, "admin@example.de")).toBe(true);

    const result = await sendCampaign(campaign.id);
    expect(result).toEqual({ ok: true, recipients: 2 });

    // Doppelversand verhindert
    expect((await sendCampaign(campaign.id)) as any).toEqual({
      ok: false,
      error: "bereits_versendet",
    });

    const { sent } = await processEmailQueue();
    expect(sent).toBe(3); // Test + 2 Empfänger
    expect(sentMails.some((m) => m.subject === "[TEST] Neue Sommerrezepte")).toBe(true);
    expect(
      sentMails.filter((m) => m.subject === "Neue Sommerrezepte"),
    ).toHaveLength(2);
    // Personalisierung + Abmeldelink
    const anyMail = sentMails.find((m) => m.subject === "Neue Sommerrezepte")!;
    expect(anyMail.html).toContain("Test");
    expect(anyMail.html).toContain("/newsletter/abmelden/");

    const logs = await db
      .select()
      .from(schema.campaignLog)
      .where(eq(schema.campaignLog.campaignId, campaign.id));
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.status === "versendet")).toBe(true);

    const [updatedCampaign] = await db
      .select()
      .from(schema.campaign)
      .where(eq(schema.campaign.id, campaign.id));
    expect(updatedCampaign.status).toBe("versendet");
    expect(updatedCampaign.recipientCount).toBe(2);

    const [anna] = await db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.email, "anna@example.de"));
    expect(anna.lastContactAt).not.toBeNull();
  });
});

describe("Export & Anonymisierung", () => {
  it("erzeugt CSV mit Interessen", async () => {
    const { contactsToCsv } = await import("@/lib/contacts");
    const csv = contactsToCsv([
      {
        email: "anna@example.de",
        firstName: "Anna",
        lastName: 'Test "Quote"',
        status: "aktiv",
        source: "Footer",
        signupAt: new Date("2026-01-01T10:00:00Z"),
        consentAt: new Date("2026-01-01T10:05:00Z"),
        lastContactAt: null,
        interests: "Rezepte, Reisen",
      },
    ]);
    expect(csv).toContain("E-Mail;Vorname");
    expect(csv).toContain('"anna@example.de";"Anna";"Test ""Quote"""');
    expect(csv).toContain('"Rezepte, Reisen"');
  });

  it("anonymisiert Kontakte unwiderruflich", async () => {
    const { db, schema } = await import("@/db");
    const { anonymizeContact } = await import("@/lib/contacts");
    const { eq } = await import("drizzle-orm");

    const [anna] = await db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.email, "anna@example.de"));
    expect(await anonymizeContact(anna.id)).toBe(true);

    const [after] = await db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.id, anna.id));
    expect(after.email).toBe(`anonymisiert-${anna.id}@geloescht.invalid`);
    expect(after.firstName).toBe("");
    expect(after.status).toBe("abgemeldet");
    expect(after.anonymizedAt).not.toBeNull();

    const interests = await db
      .select()
      .from(schema.contactInterest)
      .where(eq(schema.contactInterest.contactId, anna.id));
    expect(interests).toHaveLength(0);

    const activities = await db
      .select()
      .from(schema.contactActivity)
      .where(eq(schema.contactActivity.contactId, anna.id));
    expect(activities.every((a) => a.detail === "")).toBe(true);
  });
});
