/**
 * Der Route-Handler der Sicherung (/api/admin/rezepte/zwischenstand) — die
 * dünne Schicht zwischen Editor und Ablage, gegen die echte Datenbank.
 *
 * Warum ein Route-Handler und keine Server-Action, steht in der Route selbst;
 * HIER wird gemessen, was der Editor von ihm erwartet: eine abgelaufene
 * Sitzung ist eine ANTWORT (401, `fehler: "sitzung"`), kein Redirect; der
 * bekannte Stand wird aus den Daten genommen und nicht abgelegt; ein Schlüssel
 * auf ein Rezept, das es nicht gibt, ist „ungültig" und kein 500.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { frischeDb } from "./helfer/frische-db";

// Auth und Herkunft des Route-Handlers umschaltbar stubben — mit vi.hoisted,
// weil vi.mock über die Importe gehoben wird.
const schalter = vi.hoisted(() => ({
  admin: { id: 1, email: "e2e@rose.de" } as { id: number; email: string } | null,
  gleicheHerkunft: true,
}));
vi.mock("@/lib/auth", () => ({
  getCurrentAdmin: async () => schalter.admin,
}));
vi.mock("@/lib/csrf", () => ({
  isSameOriginRequest: () => schalter.gleicheHerkunft,
}));

frischeDb("zwischenstand-route");

const NEU = "neu:7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function formular(felder: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  return fd;
}

async function sichern(fd: FormData): Promise<Response> {
  const { POST } = await import("@/app/api/admin/rezepte/zwischenstand/route");
  return POST(new Request("http://localhost/api/admin/rezepte/zwischenstand", { method: "POST", body: fd }));
}

async function zeile(schluessel: string) {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  return db.select().from(schema.rezeptZwischenstand).where(eq(schema.rezeptZwischenstand.schluessel, schluessel)).get();
}

describe("Sicherung über den Route-Handler", () => {
  it("der Pfad des Editors zeigt auf diesen Handler und liegt unter dem Proxy", async () => {
    const { ZWISCHENSTAND_PFAD } = await import("@/lib/recipe-zwischenstand");
    // Unter /api/admin: Der Proxy erneuert dort das Cookie, getCurrentAdmin
    // lässt die Zeile gleiten — dieselben Auslöser für beide Hälften.
    expect(ZWISCHENSTAND_PFAD.startsWith("/api/admin/")).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "src/app", ZWISCHENSTAND_PFAD, "route.ts"))).toBe(true);
  });

  it("ohne Sitzung: 401 mit fehler=sitzung als Antwort — und keine Zeile", async () => {
    schalter.admin = null;
    try {
      const res = await sichern(formular({ zwischenstandSchluessel: NEU, titel: "Ohne Sitzung" }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ fehler: "sitzung" });
      expect(await zeile(NEU)).toBeUndefined();
    } finally {
      schalter.admin = { id: 1, email: "e2e@rose.de" };
    }
  });

  it("fremde Herkunft: 403, noch vor der Sitzungsprüfung", async () => {
    schalter.gleicheHerkunft = false;
    try {
      const res = await sichern(formular({ zwischenstandSchluessel: NEU, titel: "Fremd" }));
      expect(res.status).toBe(403);
      expect(await zeile(NEU)).toBeUndefined();
    } finally {
      schalter.gleicheHerkunft = true;
    }
  });

  it("sichert das rohe Formular ohne den bekannten Stand und antwortet mit Uhrzeit und Stand", async () => {
    const res = await sichern(formular({ zwischenstandSchluessel: NEU, titel: "Erster Wurf", zwischenstandStand: "0" }));
    expect(res.status).toBe(200);
    const antwort = (await res.json()) as { gesichert: string; stand: number };
    expect(antwort.gesichert).toMatch(/^\d{2}:\d{2}$/);
    const abgelegt = await zeile(NEU);
    expect(abgelegt).toBeDefined();
    expect(abgelegt!.updatedAt.getTime()).toBe(antwort.stand);
    // Der Stand ist Steuerinformation des Editors, kein Formularfeld.
    expect(JSON.parse(abgelegt!.formular)).toEqual({ zwischenstandSchluessel: [NEU], titel: ["Erster Wurf"] });

    // Mit dem zurückgegebenen Stand: überschreibt.
    const zweite = await sichern(
      formular({ zwischenstandSchluessel: NEU, titel: "Zweiter Wurf", zwischenstandStand: String(antwort.stand) }),
    );
    expect(zweite.status).toBe(200);
    expect(JSON.parse((await zeile(NEU))!.formular).titel).toEqual(["Zweiter Wurf"]);
  });

  it("ein älterer bekannter Stand: 409 fehler=fremd — die Zeile bleibt, wie sie ist", async () => {
    const vorher = await zeile(NEU);
    expect(vorher).toBeDefined();
    const res = await sichern(formular({ zwischenstandSchluessel: NEU, titel: "Anderer Tab", zwischenstandStand: "0" }));
    expect(res.status).toBe(409);
    const antwort = (await res.json()) as { fehler: string; zeit: string; stand: number };
    expect(antwort.fehler).toBe("fremd");
    expect(antwort.zeit).toMatch(/^\d{2}:\d{2}$/);
    expect(antwort.stand).toBe(vorher!.updatedAt.getTime());
    expect((await zeile(NEU))!.formular).toBe(vorher!.formular);
  });

  it("ohne brauchbaren Schlüssel oder mit einem Rezept, das es nicht gibt: 400 fehler=ungueltig", async () => {
    const ohne = await sichern(formular({ titel: "Kein Schlüssel" }));
    expect(ohne.status).toBe(400);
    expect(await ohne.json()).toEqual({ fehler: "ungueltig" });

    // Der Fremdschlüssel sagt nein — sichtbar, nicht als 500.
    const weg = await sichern(formular({ id: "999999", titel: "Gelöschtes Rezept" }));
    expect(weg.status).toBe(400);
    expect(await weg.json()).toEqual({ fehler: "ungueltig" });
    expect(await zeile("rezept:999999")).toBeUndefined();
  });

  it("kein Formular im Körper: 400, kein Absturz", async () => {
    const { POST } = await import("@/app/api/admin/rezepte/zwischenstand/route");
    const res = await POST(
      new Request("http://localhost/api/admin/rezepte/zwischenstand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(400);
  });
});
