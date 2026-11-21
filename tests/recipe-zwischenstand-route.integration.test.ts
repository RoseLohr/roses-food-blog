/**
 * Der Route-Handler der Sicherung (/api/admin/rezepte/zwischenstand) — die
 * dünne Schicht zwischen Editor und Ablage, gegen die echte Datenbank.
 *
 * Warum ein Route-Handler und keine Server-Action, steht in der Route selbst;
 * HIER wird gemessen, was der Editor von ihm erwartet: Jede Antwort ist ein
 * Urteil über die Anfrage, auch die abgelaufene Sitzung (401, kein Redirect);
 * eine Störung der Ablage dagegen wird geworfen. Für Sichern (POST) und
 * Verwerfen (DELETE).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";
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
/** Der Stand einer Zeile, die ein Test selbst in die Tabelle legt — und eine Kennung, die keine Zeile trägt. */
const STAND = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const FREMDER_STAND = "5b0c7f1e-9a3d-4c2b-8e6f-1a2b3c4d5e6f";
const PFAD = "http://localhost/api/admin/rezepte/zwischenstand";
/**
 * Drei Stunden her: Die Uhrzeit einer so gelegten Zeile ist zu keiner Tageszeit die der Anfrage.
 * Eine FESTE Uhrzeit träfe die echte Uhr des Laufs einmal am Tag auf die Minute; eine Antwort mit
 * der Uhrzeit der Anfrage statt der Zeile fiele dann nicht auf.
 */
const FRUEHER = new Date(Date.now() - 3 * 60 * 60 * 1000);
let adminId: number;

beforeAll(async () => {
  adminId = (await adminAnlegen()).id;
});

function formular(felder: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  return fd;
}

async function sichern(fd: FormData): Promise<Response> {
  const { POST } = await import("@/app/api/admin/rezepte/zwischenstand/route");
  return POST(new Request(PFAD, { method: "POST", body: fd }));
}

async function verwerfen(fd: FormData | null): Promise<Response> {
  const { DELETE } = await import("@/app/api/admin/rezepte/zwischenstand/route");
  return DELETE(new Request(PFAD, { method: "DELETE", body: fd ?? undefined }));
}

/** Eine Zeile unmittelbar in die Tabelle, mit der Uhrzeit von FRUEHER. */
async function lege(schluessel: string, stand = STAND, formularText = '{"titel":["Entwurf"]}'): Promise<void> {
  const { db, schema } = await import("@/db");
  const { rezeptnummerAus } = await import("@/lib/recipe-zwischenstand");
  db.insert(schema.rezeptZwischenstand)
    .values({ schluessel, recipeId: rezeptnummerAus(schluessel), formular: formularText, stand, gesichertAm: FRUEHER })
    .run();
}

async function zeile(schluessel: string) {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  return db.select().from(schema.rezeptZwischenstand).where(eq(schema.rezeptZwischenstand.schluessel, schluessel)).get();
}

async function rezeptAnlegen(titel: string): Promise<number> {
  const { saveRecipeFromForm } = await import("@/lib/recipe-save");
  const res = await saveRecipeFromForm(
    formular({ titel, portionen: "4", status: "entwurf", abschnitte: "[]", notizen: "[]" }),
    adminId,
  );
  if (!("recipeId" in res)) throw new Error("Rezept nicht angelegt");
  return res.recipeId;
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

  it("ein Stand, den die Zeile nicht trägt: 409 fehler=fremd — die Zeile bleibt, wie sie ist", async () => {
    const schluessel = neu(5);
    await lege(schluessel);
    const vorher = await zeile(schluessel);
    expect(alsUhrzeit(FRUEHER)).not.toBe(alsUhrzeit(new Date()));
    for (const stand of [FREMDER_STAND, undefined]) {
      const felder: Record<string, string> = { zwischenstandSchluessel: schluessel, titel: "Anderer Tab" };
      if (stand) felder.zwischenstandStand = stand;
      const res = await sichern(formular(felder));
      expect(res.status, String(stand)).toBe(409);
      // Stand und Uhrzeit der Antwort sind die der ZEILE, nicht die der Anfrage.
      expect(await res.json(), String(stand)).toEqual({ fehler: "fremd", zeit: alsUhrzeit(FRUEHER), stand: STAND });
    }
    expect(await zeile(schluessel)).toEqual(vorher);
  });

  it("kein Formular, kein brauchbarer Schlüssel oder — ohne genannten Stand — ein Rezept, das es nicht gibt: 400 fehler=ungueltig", async () => {
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

    // Der Fremdschlüssel sagt nein: Das ist ein Urteil über die Eingabe, kein 500.
    const keinRezept = await sichern(formular({ id: "999999", titel: "Dieses Rezept gab es nie" }));
    expect(keinRezept.status).toBe(400);
    expect(await keinRezept.json()).toEqual({ fehler: "ungueltig" });
    // Mit einem genannten Stand kommt es nicht bis zum Fremdschlüssel: Ohne Zeile ist das Urteil
    // schon „weg". Erst die Folgesicherung ohne Stand ist „ungueltig" — die von eben.
    const mitStand = await sichern(formular({ id: "999999", titel: "Dieses Rezept gab es nie", zwischenstandStand: FREMDER_STAND }));
    expect(mitStand.status).toBe(409);
    expect(await mitStand.json()).toEqual({ fehler: "weg" });
    expect(await zeile("rezept:999999")).toBeUndefined();
  });

  it("ein Formular, das sich nicht laden ließe: 400 fehler=ungueltig — nichts wird abgelegt, und eine Zeile bleibt, wie sie ist", async () => {
    // Quittierte der Handler es, läge eine Zeile da, die nie angeboten wird, und ihr Schreiber hielte
    // einen Stand, den sonst niemand kennt. Dieselbe Regel wie beim Anbieten (istLadbar).
    const schluessel = "neu:2f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c";
    const nichtLadbar: Record<string, string>[] = [
      { abschnitte: "{kein json" },
      { abschnitte: '[{"name":1}]' },
      // Das alte Format der Schritte (reiner Text) nimmt der Speicherweg noch an. Der Zwischenstand
      // ist hier strenger als das Speichern; der Editor schickt es nie.
      { abschnitte: '[{"name":"","ingredients":[],"steps":["Rühren."]}]' },
      { notizen: '[{"text":5}]' },
      { notizen: "null" },
    ];
    for (const felder of nichtLadbar) {
      const fall = JSON.stringify(felder);
      const res = await sichern(formular({ zwischenstandSchluessel: schluessel, titel: "x", ...felder }));
      expect(res.status, fall).toBe(400);
      expect(await res.json(), fall).toEqual({ fehler: "ungueltig" });
      expect(await zeile(schluessel), fall).toBeUndefined();
    }
    // Auch mit dem Stand einer bestehenden Zeile: Sie bleibt mit Stand und Inhalt.
    const bestehend = neu(6);
    await lege(bestehend);
    const vorher = await zeile(bestehend);
    const ueber = await sichern(
      formular({ zwischenstandSchluessel: bestehend, titel: "x", abschnitte: "{kein json", zwischenstandStand: STAND }),
    );
    expect(ueber.status).toBe(400);
    expect(await zeile(bestehend)).toEqual(vorher);

    // Gegenprobe: Was 200 bekommt, lädt die Ablage — mit genau dem quittierten Stand.
    const { zwischenstandLaden } = await import("@/lib/recipe-zwischenstand-store");
    const gut = await sichern(
      formular({
        zwischenstandSchluessel: schluessel,
        titel: "x",
        abschnitte: '[{"name":"","ingredients":[],"steps":[{"text":"Rühren.","imageId":null}]}]',
        notizen: "[]",
      }),
    );
    expect(gut.status).toBe(200);
    const { stand } = (await gut.json()) as { stand: string };
    expect((await zwischenstandLaden(schluessel))?.stand).toBe(stand);
  });

  it("ein Stand, der keine Kennung ist, ist KEINER: ohne Zeile wird angelegt — fortgesetzt wird nur mit einer Kennung", async () => {
    // Der Stand ist Nutzereingabe (standAus). Reichte der Handler ihn roh an die Ablage, wäre jeder
    // nichtleere Text ein genannter Stand: ohne Zeile „weg" statt einer Sicherung.
    for (const [i, stand] of ["abc", FREMDER_STAND.toUpperCase(), ` ${FREMDER_STAND}`].entries()) {
      const schluessel = `neu:1e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7${i}`;
      const res = await sichern(formular({ zwischenstandSchluessel: schluessel, titel: "x", zwischenstandStand: stand }));
      expect(res.status, stand).toBe(200);
      expect(await zeile(schluessel), stand).toBeDefined();
    }
    // Gegenprobe: dieselbe Lage mit einer Kennung — nichts angelegt.
    const schluessel = "neu:1e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a79";
    const res = await sichern(formular({ zwischenstandSchluessel: schluessel, titel: "x", zwischenstandStand: FREMDER_STAND }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ fehler: "weg" });
    expect(await zeile(schluessel)).toBeUndefined();
  });

  it("eine Störung der Ablage ist kein Urteil über die Eingabe: Sie wird geworfen, nicht als ungültige Eingabe gemeldet", async () => {
    // Ein Trigger lässt das Schreiben scheitern, wie eine volle Platte es täte. Als 400 gemeldet,
    // gälte das als Fehler des Redakteurs und erreichte das Fehlerbudget nie. Der Code des Triggers
    // beginnt wie der des Fremdschlüssels: Ein Vergleich nur am Anfang fiele hier auf.
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    const schluessel = "neu:9c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
    db.run(sql`CREATE TEMP TRIGGER zwischenstand_stoerung BEFORE INSERT ON rezept_zwischenstand BEGIN SELECT RAISE(ABORT, 'Störung'); END`);
    try {
      await expect(sichern(formular({ zwischenstandSchluessel: schluessel, titel: "x" }))).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_TRIGGER" });
    } finally {
      db.run(sql`DROP TRIGGER zwischenstand_stoerung`);
    }
    expect(await zeile(schluessel)).toBeUndefined();
  });

  it("ein BESTEHENDES Rezept: gesichert unter seiner Nummer — und nach dem Speichern ist die Zeile „weg“", async () => {
    const id = await rezeptAnlegen("Bestehend");
    const schluessel = `rezept:${id}`;
    const erst = await sichern(formular({ id: String(id), titel: "Getippt" }));
    expect(erst.status).toBe(200);
    const { stand } = (await erst.json()) as { stand: string };
    expect(await zeile(schluessel)).toMatchObject({ recipeId: id, stand });

    // Speichern räumt ab; eine Sicherung, die danach noch mit dem alten Stand ankommt, legt nichts an.
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    await saveRecipeFromForm(formular({ id: String(id), titel: "Gespeichert", portionen: "4", status: "entwurf", abschnitte: "[]", notizen: "[]" }), adminId);
    const spaet = await sichern(formular({ id: String(id), titel: "Getippt", zwischenstandStand: stand }));
    expect(spaet.status).toBe(409);
    expect(await spaet.json()).toEqual({ fehler: "weg" });
    expect(await zeile(schluessel)).toBeUndefined();
  });
});

describe("Verwerfen über den Route-Handler", () => {
  it("fremde Herkunft: 403, die Sitzung wird nicht gefragt — ohne Sitzung: 401, der Körper wird nicht gelesen; die Zeile bleibt", async () => {
    // Mit dem RICHTIGEN Stand geschickt: Ohne ihn bliebe die Zeile auch dann, wenn der Handler
    // weder Herkunft noch Sitzung prüfte — als „fremd".
    const schluessel = neu(21);
    await lege(schluessel);
    const mitStand = () => formular({ schluessel, zwischenstandStand: STAND });
    schalter.gleicheHerkunft = false;
    schalter.admin = null;
    schalter.anlaesse.length = 0;
    try {
      const fremd = await verwerfen(mitStand());
      expect(fremd.status).toBe(403);
      expect(await fremd.json()).toEqual({ fehler: "herkunft" });
      expect(schalter.anlaesse).toEqual([]);

      schalter.gleicheHerkunft = true;
      const { DELETE } = await import("@/app/api/admin/rezepte/zwischenstand/route");
      const anfrage = new Request(PFAD, { method: "DELETE", body: mitStand() });
      const ohne = await DELETE(anfrage);
      expect(ohne.status).toBe(401);
      expect(ohne.headers.get("location")).toBeNull();
      expect(await ohne.json()).toEqual({ fehler: "sitzung" });
      expect(anfrage.bodyUsed).toBe(false);
      expect(schalter.anlaesse).toEqual(["admin-anfrage"]);
    } finally {
      schalter.gleicheHerkunft = true;
      schalter.admin = { id: 1, email: "e2e@rose.de" };
    }
    expect(await zeile(schluessel)).toMatchObject({ stand: STAND });
  });

  it("kein Formular oder ein Schlüssel, der keiner ist: 400 fehler=ungueltig — nichts wird gelöscht", async () => {
    const { DELETE } = await import("@/app/api/admin/rezepte/zwischenstand/route");
    const schluessel = neu(22);
    await lege(schluessel);
    const fehler = console.error;
    console.error = () => undefined;
    try {
      const keinFormular = await DELETE(new Request(PFAD, { method: "DELETE", body: "{}", headers: { "content-type": "application/json" } }));
      expect(keinFormular.status).toBe(400);
      expect(await keinFormular.json()).toEqual({ fehler: "ungueltig" });
    } finally {
      console.error = fehler;
    }
    const keine: Record<string, string>[] = [
      { zwischenstandStand: STAND },
      { schluessel: "", zwischenstandStand: STAND },
      { schluessel: "neu:kein-uuid", zwischenstandStand: STAND },
      { schluessel: "rezept:0", zwischenstandStand: STAND },
      { schluessel: ` ${schluessel}`, zwischenstandStand: STAND },
      // Verworfen wird über das Feld `schluessel`. Die Felder, mit denen das FORMULAR seine Zeile
      // nennt, zählen hier nicht: Wer verwirft, schickt kein Formular.
      { zwischenstandSchluessel: schluessel, zwischenstandStand: STAND },
    ];
    for (const felder of keine) {
      const res = await verwerfen(formular(felder));
      expect(res.status, JSON.stringify(felder)).toBe(400);
      expect(await res.json(), JSON.stringify(felder)).toEqual({ fehler: "ungueltig" });
    }
    expect(await zeile(schluessel)).toMatchObject({ stand: STAND });
  });

  it("ein Stand, den die Zeile nicht trägt, keiner oder einer, der keine Kennung ist: 409 fehler=fremd mit Uhrzeit und Stand der ZEILE — sie bleibt", async () => {
    const schluessel = neu(23);
    await lege(schluessel);
    expect(alsUhrzeit(FRUEHER)).not.toBe(alsUhrzeit(new Date()));
    for (const stand of [FREMDER_STAND, undefined, "abc", STAND.toUpperCase(), ` ${STAND}`]) {
      const felder: Record<string, string> = { schluessel };
      if (stand !== undefined) felder.zwischenstandStand = stand;
      const res = await verwerfen(formular(felder));
      expect(res.status, String(stand)).toBe(409);
      expect(await res.json(), String(stand)).toEqual({ fehler: "fremd", zeit: alsUhrzeit(FRUEHER), stand: STAND });
    }
    expect(await zeile(schluessel)).toMatchObject({ stand: STAND, gesichertAm: FRUEHER });
  });

  it("eine Störung der Ablage wird geworfen, nicht als Antwort ausgegeben — die Zeile bleibt", async () => {
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    const schluessel = neu(24);
    await lege(schluessel);
    db.run(sql`CREATE TEMP TRIGGER zwischenstand_stoerung BEFORE DELETE ON rezept_zwischenstand BEGIN SELECT RAISE(ABORT, 'Störung'); END`);
    try {
      await expect(verwerfen(formular({ schluessel, zwischenstandStand: STAND }))).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_TRIGGER" });
    } finally {
      db.run(sql`DROP TRIGGER zwischenstand_stoerung`);
    }
    expect(await zeile(schluessel)).toMatchObject({ stand: STAND });
  });

  it("löscht genau diese Zeile und antwortet „verworfen“ — auch beim zweiten Mal, wenn es sie nicht mehr gibt", async () => {
    const schluessel = neu(25);
    const nachbar = neu(26);
    await lege(schluessel);
    await lege(nachbar);
    for (const mal of [1, 2]) {
      const res = await verwerfen(formular({ schluessel, zwischenstandStand: STAND }));
      expect(res.status, String(mal)).toBe(200);
      expect(await res.json(), String(mal)).toEqual({ verworfen: true });
      expect(await zeile(schluessel), String(mal)).toBeUndefined();
    }
    // Ohne Zeile ist auch ohne Stand nichts falsch: Verwerfen ist idempotent.
    const ohneStand = await verwerfen(formular({ schluessel }));
    expect(ohneStand.status).toBe(200);
    expect(await ohneStand.json()).toEqual({ verworfen: true });
    // Die Nachbarzeile bleibt.
    expect(await zeile(nachbar)).toMatchObject({ stand: STAND });
  });

  it("eine Zeile, die sich nicht laden lässt, kennt niemand: Sie wird ohne Stand verworfen", async () => {
    const schluessel = neu(27);
    await lege(schluessel, STAND, "{kein json");
    const res = await verwerfen(formular({ schluessel }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verworfen: true });
    expect(await zeile(schluessel)).toBeUndefined();
  });

  it("ein BESTEHENDES Rezept: gesichert unter seiner Nummer, verworfen unter seinem Schlüssel", async () => {
    const id = await rezeptAnlegen("Zum Verwerfen");
    const schluessel = `rezept:${id}`;
    const gesichert = await sichern(formular({ id: String(id), titel: "Getippt" }));
    const { stand } = (await gesichert.json()) as { stand: string };
    expect(await zeile(schluessel)).toMatchObject({ recipeId: id, stand });
    const res = await verwerfen(formular({ schluessel, zwischenstandStand: stand }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verworfen: true });
    expect(await zeile(schluessel)).toBeUndefined();
  });
});
