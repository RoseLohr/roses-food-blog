/**
 * Der Route-Handler der Sicherung (/api/admin/rezepte/zwischenstand) — die
 * dünne Schicht zwischen Editor und Ablage, gegen die echte Datenbank.
 *
 * Warum ein Route-Handler und keine Server-Action, steht in der Route selbst;
 * HIER wird gemessen, was der Editor von ihm erwartet: Jede Antwort ist ein
 * Urteil über die Anfrage, auch die abgelaufene Sitzung (401, kein Redirect);
 * eine Störung der Ablage dagegen wird geworfen.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { frischeDb } from "./helfer/frische-db";
import { alsUhrzeit } from "@/lib/zeitpunkt";

// Auth und Herkunft des Route-Handlers umschaltbar stubben — mit vi.hoisted,
// weil vi.mock über die Importe gehoben wird.
const schalter = vi.hoisted(() => ({
  admin: { id: 1, email: "e2e@rose.de" } as { id: number; email: string } | null,
  gleicheHerkunft: true,
  /** Mit welchem Anlass die Sitzung gefragt wurde — und OB überhaupt. */
  anlaesse: [] as string[],
}));
vi.mock("@/lib/auth", () => ({
  getCurrentAdmin: async (anlass: string) => {
    schalter.anlaesse.push(anlass);
    return schalter.admin;
  },
}));
vi.mock("@/lib/csrf", () => ({
  isSameOriginRequest: () => schalter.gleicheHerkunft,
}));

frischeDb("zwischenstand-route");

/** Je Test ein eigener Schlüssel: Kein Test braucht die Zeile eines anderen, jeder läuft auch einzeln. */
const neu = (nr: number) => `neu:7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b${String(nr).padStart(4, "0")}`;
const PFAD = "http://localhost/api/admin/rezepte/zwischenstand";
function formular(felder: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  return fd;
}

async function sichern(fd: FormData): Promise<Response> {
  const { POST } = await import("@/app/api/admin/rezepte/zwischenstand/route");
  return POST(new Request(PFAD, { method: "POST", body: fd }));
}

async function zeile(schluessel: string) {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  return db.select().from(schema.rezeptZwischenstand).where(eq(schema.rezeptZwischenstand.schluessel, schluessel)).get();
}

describe("Sicherung über den Route-Handler", () => {
  it("der Pfad des Editors zeigt auf diesen Handler und liegt unter dem Proxy", async () => {
    const { ZWISCHENSTAND_PFAD } = await import("@/lib/recipe-zwischenstand");
    expect(ZWISCHENSTAND_PFAD.startsWith("/api/admin/")).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "src/app", ZWISCHENSTAND_PFAD, "route.ts"))).toBe(true);
  });

  it("fremde Herkunft: 403, noch vor der Sitzungsprüfung — die Sitzung wird gar nicht erst gefragt", async () => {
    // Die Frage nach der Sitzung lässt deren Zeile gleiten. Eine fremde Herkunft darf das nicht auslösen;
    // und ohne Sitzung UND mit fremder Herkunft ist die Antwort 403, nicht 401.
    const schluessel = neu(1);
    schalter.gleicheHerkunft = false;
    schalter.admin = null;
    schalter.anlaesse.length = 0;
    try {
      const res = await sichern(formular({ zwischenstandSchluessel: schluessel, titel: "Fremd" }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ fehler: "herkunft" });
      expect(schalter.anlaesse).toEqual([]);
      expect(await zeile(schluessel)).toBeUndefined();
    } finally {
      schalter.gleicheHerkunft = true;
      schalter.admin = { id: 1, email: "e2e@rose.de" };
    }
  });

  it("ohne Sitzung: 401 mit fehler=sitzung als Antwort, keine Zeile — und der Körper zählt nicht, auch kein unbrauchbarer", async () => {
    // Eine ANTWORT, kein Redirect: Der Editor bleibt stehen und kann es sagen. Und die Sitzung wird
    // gefragt, bevor der Körper gelesen wird: Ohne sie ist auch ein unbrauchbarer Körper 401, nicht 400.
    const { POST } = await import("@/app/api/admin/rezepte/zwischenstand/route");
    const schluessel = neu(2);
    schalter.admin = null;
    schalter.anlaesse.length = 0;
    try {
      const res = await sichern(formular({ zwischenstandSchluessel: schluessel, titel: "Ohne Sitzung" }));
      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.json()).toEqual({ fehler: "sitzung" });
      const anfrage = new Request(PFAD, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      const unbrauchbar = await POST(anfrage);
      expect(unbrauchbar.status).toBe(401);
      expect(anfrage.bodyUsed).toBe(false);
      // Gefragt wird mit dem Anlass, der die Sitzung gleiten lässt — wie alles unter /api/admin.
      expect(schalter.anlaesse).toEqual(["admin-anfrage", "admin-anfrage"]);
      expect(await zeile(schluessel)).toBeUndefined();
    } finally {
      schalter.admin = { id: 1, email: "e2e@rose.de" };
    }
  });

  it("sichert das rohe Formular ohne den bekannten Stand und antwortet mit Uhrzeit und Stand", async () => {
    const schluessel = neu(3);
    const felder = { zwischenstandSchluessel: schluessel, titel: "  Suppe  ", portionen: "abc", abschnitte: "[]", notizen: "[]" };
    const erst = await sichern(formular(felder));
    expect(erst.status).toBe(200);
    const a = (await erst.json()) as { gesichert: string; stand: string };
    const z1 = await zeile(schluessel);
    expect(a).toEqual({ gesichert: alsUhrzeit(z1!.gesichertAm), stand: z1!.stand });
    // Roh: nichts getrimmt, nichts gedeutet — und der Schlüssel bleibt Teil des Formulars.
    expect(JSON.parse(z1!.formular)).toEqual(Object.fromEntries(Object.entries(felder).map(([k, v]) => [k, [v]])));

    // Die Folgesicherung nennt den Stand. Er hängt an der Anfrage und wird nicht mit abgelegt:
    // Sonst änderte jede Sicherung den Fingerabdruck des Formulars.
    const dann = await sichern(formular({ ...felder, titel: "Suppe", zwischenstandStand: a.stand }));
    expect(dann.status).toBe(200);
    const b = (await dann.json()) as { gesichert: string; stand: string };
    const z2 = await zeile(schluessel);
    expect(b.stand).toBe(z2!.stand);
    expect(b.stand).not.toBe(a.stand);
    expect(JSON.parse(z2!.formular)).toEqual({ ...JSON.parse(z1!.formular), titel: ["Suppe"] });
  });

  it("die Zeile trägt die Uhr des Servers im Augenblick der Anfrage — bei jeder Sicherung neu", async () => {
    // Der Handler ist die einzige Stelle, an der die Uhr in die Sicherung kommt. Der Vergleich mit
    // der ANTWORT sagt darüber nichts: Antwort und Zeile stammen aus demselben Wert, und eine
    // falsche Uhr stünde in beiden. Deshalb hier die Uhr des Tests, und ZWEI Zeitpunkte: Mit einem
    // bliebe eine Uhr grün, die der Handler nur einmal liest (beim Laden des Moduls).
    const schluessel = neu(4);
    const t1 = new Date("2026-03-04T05:06:07.008Z");
    const t2 = new Date(t1.getTime() + 3 * 60 * 1000);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(t1);
      const erst = await sichern(formular({ zwischenstandSchluessel: schluessel, titel: "Erste" }));
      const a = (await erst.json()) as { gesichert: string; stand: string };
      expect((await zeile(schluessel))!.gesichertAm).toEqual(t1);
      expect(a.gesichert).toBe(alsUhrzeit(t1));

      vi.setSystemTime(t2);
      const dann = await sichern(formular({ zwischenstandSchluessel: schluessel, titel: "Zweite", zwischenstandStand: a.stand }));
      const b = (await dann.json()) as { gesichert: string };
      expect((await zeile(schluessel))!.gesichertAm).toEqual(t2);
      expect(b.gesichert).toBe(alsUhrzeit(t2));
      expect(alsUhrzeit(t2)).not.toBe(alsUhrzeit(t1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("kein Formular oder kein brauchbarer Schlüssel: 400 fehler=ungueltig", async () => {
    const { POST } = await import("@/app/api/admin/rezepte/zwischenstand/route");
    const fehler = console.error;
    console.error = () => undefined;
    try {
      const keinFormular = await POST(new Request(PFAD, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
      expect(keinFormular.status).toBe(400);
      expect(await keinFormular.json()).toEqual({ fehler: "ungueltig" });
    } finally {
      console.error = fehler;
    }

    const ohneSchluessel: Record<string, string>[] = [{ titel: "Kein Schlüssel" }, { zwischenstandSchluessel: "neu:kein-uuid", titel: "x" }, { id: "0", titel: "x" }];
    for (const felder of ohneSchluessel) {
      const ohne = await sichern(formular(felder));
      expect(ohne.status, JSON.stringify(felder)).toBe(400);
      expect(await ohne.json(), JSON.stringify(felder)).toEqual({ fehler: "ungueltig" });
    }
  });
});
