/**
 * Willkommensschritt nach der Bestätigung: angebotene Interessen sind auf
 * Reisen/Rezepte beschränkt, und updateContactProfile ergänzt Name & Interessen
 * eines aktiven Kontakts über seinen Abmelde-Token (nicht angebotene Interessen
 * wie „Backen" werden verworfen).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let tokenAktiv: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-profile-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });

  const { db, schema } = await import("@/db");
  await db
    .insert(schema.interest)
    .values([{ name: "Reisen" }, { name: "Rezepte" }, { name: "Backen" }]);

  tokenAktiv = "a".repeat(48);
  await db.insert(schema.contact).values({
    email: "aktiv@example.de",
    status: "aktiv",
    signupAt: new Date(),
    consentAt: new Date(),
    unsubscribeToken: tokenAktiv,
    createdAt: new Date(),
  });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Willkommensschritt / Profil-Ergänzung", () => {
  it("bietet nur Reisen und Rezepte als Interessen an", async () => {
    const { getOfferedInterests } = await import("@/lib/newsletter");
    const offered = await getOfferedInterests();
    expect(offered.map((o) => o.name)).toEqual(["Reisen", "Rezepte"]);
  });

  it("ergänzt Name & Interessen und verwirft nicht angebotene", async () => {
    const { updateContactProfile, getOfferedInterests } = await import(
      "@/lib/newsletter"
    );
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const offered = await getOfferedInterests();
    const reisen = offered.find((o) => o.name === "Reisen")!;
    const [backen] = await db
      .select()
      .from(schema.interest)
      .where(eq(schema.interest.name, "Backen"));

    const ok = await updateContactProfile(tokenAktiv, {
      firstName: "Rosa",
      lastName: "Lohr",
      // „Backen" (nicht angeboten) muss serverseitig verworfen werden
      interestIds: [reisen.id, backen.id],
    });
    expect(ok).toBe(true);

    const [c] = await db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.unsubscribeToken, tokenAktiv));
    expect(c.firstName).toBe("Rosa");
    expect(c.lastName).toBe("Lohr");

    const assigned = await db
      .select()
      .from(schema.contactInterest)
      .where(eq(schema.contactInterest.contactId, c.id));
    expect(assigned.map((a) => a.interestId)).toEqual([reisen.id]);
  });

  it("lehnt ungültige Token und nicht-aktive Kontakte ab", async () => {
    const { updateContactProfile } = await import("@/lib/newsletter");
    // falsches Format
    expect(await updateContactProfile("zu-kurz", { firstName: "", lastName: "", interestIds: [] })).toBe(false);
    // gültiges Format, aber kein Kontakt
    expect(
      await updateContactProfile("b".repeat(48), {
        firstName: "",
        lastName: "",
        interestIds: [],
      }),
    ).toBe(false);
  });
});
