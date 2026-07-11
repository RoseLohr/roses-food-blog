/**
 * Integrationstest: kompletter Double-Opt-in-Flow (Akzeptanzkriterium 6)
 * mit gemocktem SMTP-Transport. Anmeldung → unbestätigt + Bestätigungsmail →
 * Klick → aktiv (Quelle, Interesse, Einwilligungszeitpunkt, Sequenzplanung) →
 * One-Click-Abmeldung.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
const sentMails: Array<{ to: string; subject: string; html: string; text: string }> = [];

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-news-"));
  process.env.DATA_DIR = tmp;
  process.env.BASE_URL = "https://blog.example.de";
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });

  const { setTransporterForTesting } = await import("@/lib/mailer");
  setTransporterForTesting({
    sendMail: async (opts: any) => {
      sentMails.push({
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      return { messageId: "test" };
    },
  } as never);

  // Interesse + aktive Willkommenssequenz anlegen
  const { db, schema } = await import("@/db");
  await db.insert(schema.interest).values([{ name: "Rezepte" }, { name: "Reisen" }]);
  const [seq] = await db
    .insert(schema.sequence)
    .values({ name: "Willkommen", active: true, createdAt: new Date() })
    .returning();
  await db.insert(schema.sequenceStep).values([
    {
      sequenceId: seq.id,
      sortOrder: 0,
      delayHours: 0,
      subject: "Willkommen!",
      content: "Hallo {{vorname}}!",
    },
    {
      sequenceId: seq.id,
      sortOrder: 1,
      delayHours: 72,
      subject: "Tipps",
      content: "Noch mehr Tipps.",
    },
  ]);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Double-Opt-in-Flow", () => {
  it("Anmeldung speichert unbestätigt und sendet Bestätigungsmail", async () => {
    const { subscribeContact } = await import("@/lib/newsletter");
    const { db, schema } = await import("@/db");

    const result = await subscribeContact({
      email: "lena@example.de",
      firstName: "Lena",
      lastName: "Muster",
      interestIds: [1],
      source: "Rezeptseite: linsen-bolognese",
      consent: true,
    });
    expect(result.ok).toBe(true);

    const [contact] = await db.select().from(schema.contact);
    expect(contact.status).toBe("unbestaetigt");
    expect(contact.consentAt).toBeNull();
    expect(contact.source).toBe("Rezeptseite: linsen-bolognese");
    expect(contact.confirmToken).toHaveLength(48);

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].to).toBe("lena@example.de");
    expect(sentMails[0].html).toContain(contact.confirmToken!);
    // Jede Mail enthält Abmeldelink (Akzeptanzkriterium 13)
    expect(sentMails[0].html).toContain(
      `/newsletter/abmelden/${contact.unsubscribeToken}`,
    );
    expect(sentMails[0].text).toContain("abmelden");
  });

  it("Bestätigung aktiviert den Kontakt und plant die Willkommenssequenz", async () => {
    const { confirmContact } = await import("@/lib/newsletter");
    const { db, schema } = await import("@/db");

    const [before] = await db.select().from(schema.contact);
    const result = await confirmContact(before.confirmToken!);
    expect(result).toBe("bestaetigt");

    const [after] = await db.select().from(schema.contact);
    expect(after.status).toBe("aktiv");
    expect(after.consentAt).not.toBeNull();
    expect(after.confirmToken).toBeNull();

    // Interesse zugeordnet
    const interests = await db.select().from(schema.contactInterest);
    expect(interests).toEqual([{ contactId: after.id, interestId: 1 }]);

    // Sequenzschritte geplant
    const logs = await db.select().from(schema.sequenceLog);
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.status === "geplant")).toBe(true);

    // Ungültiger Token
    expect(await confirmContact("f".repeat(48))).toBe("ungueltig");
    expect(await confirmContact("zu-kurz")).toBe("ungueltig");
  });

  it("fällige Sequenzschritte werden eingereiht und versendet", async () => {
    const { enqueueDueSequenceSteps } = await import("@/lib/sequences");
    const { processEmailQueue } = await import("@/lib/email-queue");
    const { db, schema } = await import("@/db");

    const enqueued = await enqueueDueSequenceSteps();
    expect(enqueued).toBe(1); // nur Schritt mit delay 0 ist fällig

    const before = sentMails.length;
    const { sent } = await processEmailQueue();
    expect(sent).toBe(1);
    expect(sentMails[before].subject).toBe("Willkommen!");
    expect(sentMails[before].html).toContain("Lena");

    const logs = await db.select().from(schema.sequenceLog);
    expect(logs.find((l) => l.status === "versendet")).toBeTruthy();

    // Kein Doppelversand
    expect(await enqueueDueSequenceSteps()).toBe(0);

    // "letzter Kontakt" aktualisiert
    const [contact] = await db.select().from(schema.contact);
    expect(contact.lastContactAt).not.toBeNull();
  });

  it("One-Click-Abmeldung setzt Status und stoppt Sequenzen", async () => {
    const { unsubscribeContact } = await import("@/lib/newsletter");
    const { enqueueDueSequenceSteps } = await import("@/lib/sequences");
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const [contact] = await db.select().from(schema.contact);
    expect(await unsubscribeContact(contact.unsubscribeToken)).toBe("abgemeldet");

    const [after] = await db.select().from(schema.contact);
    expect(after.status).toBe("abgemeldet");

    // Zweiter Schritt fällig machen → wird abgebrochen statt versendet
    await db
      .update(schema.sequenceLog)
      .set({ dueAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sequenceLog.status, "geplant"));
    expect(await enqueueDueSequenceSteps()).toBe(0);
    const cancelled = await db.select().from(schema.sequenceLog);
    expect(cancelled.some((l) => l.status === "abgebrochen")).toBe(true);

    expect(await unsubscribeContact("f".repeat(48))).toBe("ungueltig");
  });

  it("bereits aktive Kontakte werden nicht doppelt angelegt", async () => {
    const { subscribeContact } = await import("@/lib/newsletter");
    const { db, schema } = await import("@/db");

    // Wiederanmeldung nach Abmeldung → wieder unbestätigt + neue Mail
    const mailsBefore = sentMails.length;
    const result = await subscribeContact({
      email: "lena@example.de",
      firstName: "",
      lastName: "",
      interestIds: [2],
      source: "Footer",
      consent: true,
    });
    expect(result.ok).toBe(true);
    const contacts = await db.select().from(schema.contact);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].status).toBe("unbestaetigt");
    expect(contacts[0].firstName).toBe("Lena"); // bestehender Name bleibt
    expect(sentMails.length).toBe(mailsBefore + 1);
  });
});
