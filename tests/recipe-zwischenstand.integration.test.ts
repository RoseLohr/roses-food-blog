/**
 * Der Zwischenstand gegen die echte Datenbank: was die Tabelle selbst zusagt
 * (ein Schlüssel je Zeile, die Rezeptnummer hängt am Schlüssel, Cascade,
 * Fremdschlüssel).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("zwischenstand");

// Mit Millisekunden: Eine Zeitspalte in Sekunden fiele sonst nicht auf.
const NOW = new Date("2026-10-23T10:00:00.123Z");
const NEU = "neu:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const STAND = "5b0c7f1e-9a3d-4c2b-8e6f-1a2b3c4d5e6f";
let adminId: number;

beforeAll(async () => {
  adminId = (await adminAnlegen()).id;
});

function rezeptFormular(titel: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("titel", titel);
  fd.set("portionen", "4");
  fd.set("status", "entwurf");
  fd.set("abschnitte", JSON.stringify([{ name: "", ingredients: [], steps: ["Rühren."] }]));
  fd.set("notizen", "[]");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

/** Eine Zeile unmittelbar in die Tabelle — für alles, was die Tabelle selbst zusagt. */
async function lege(schluessel: string, recipeId: number | null): Promise<void> {
  const { db, schema } = await import("@/db");
  db.insert(schema.rezeptZwischenstand)
    .values({ schluessel, recipeId, formular: '{"titel":["Entwurf"]}', stand: STAND, gesichertAm: NOW })
    .run();
}

async function loesche(): Promise<void> {
  const { db, schema } = await import("@/db");
  db.delete(schema.rezeptZwischenstand).run();
}

async function schluesselDerZeilen(): Promise<string[]> {
  const { db, schema } = await import("@/db");
  return db
    .select({ schluessel: schema.rezeptZwischenstand.schluessel })
    .from(schema.rezeptZwischenstand)
    .all()
    .map((z) => z.schluessel)
    .sort();
}

describe("Tabelle rezept_zwischenstand", () => {
  it("hält höchstens eine Zeile je Schlüssel", async () => {
    await lege(NEU, null);
    await expect(lege(NEU, null)).rejects.toThrow();
    expect(await schluesselDerZeilen()).toEqual([NEU]);
    await loesche();
  });

  it("bindet die Rezeptnummer an den Schlüssel — der zweite Wert daneben kann nicht abweichen", async () => {
    // `recipe_id` gibt es für die Cascade. Wiche sie vom Schlüssel ab, hinge die Zeile am falschen
    // Rezept oder an keinem: Sie überlebte das Löschen ihres Rezepts oder verschwände mit einem fremden.
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const eins = await saveRecipeFromForm(rezeptFormular("Eins"), adminId, NOW);
    const zwei = await saveRecipeFromForm(rezeptFormular("Zwei"), adminId, NOW);
    if (!("recipeId" in eins) || !("recipeId" in zwei)) throw new Error("Rezept nicht angelegt");
    const abweichend: Array<[string, number | null]> = [
      [`rezept:${eins.recipeId}`, null],
      [`rezept:${eins.recipeId}`, zwei.recipeId],
      [`rezept:0${eins.recipeId}`, eins.recipeId],
      [NEU, eins.recipeId],
      ["quatsch", null],
      ["NEU:GROSS", null],
      ["", null],
    ];
    for (const [schluessel, recipeId] of abweichend) {
      await expect(lege(schluessel, recipeId), `${schluessel} / ${recipeId}`).rejects.toThrow(/CHECK/);
    }
    expect(await schluesselDerZeilen()).toEqual([]);
    // Die beiden Formen, die es gibt:
    await lege(`rezept:${eins.recipeId}`, eins.recipeId);
    await lege(NEU, null);
    expect(await schluesselDerZeilen()).toEqual([NEU, `rezept:${eins.recipeId}`].sort());
    await loesche();
  });

  it("hängt am Rezept: wird das Rezept gelöscht, verschwindet die Zeile per Cascade — und nur seine", async () => {
    const { saveRecipeFromForm, deleteRecipeById } = await import("@/lib/recipe-save");
    const res = await saveRecipeFromForm(rezeptFormular("Cascade-Rezept"), adminId, NOW);
    if (!("recipeId" in res)) throw new Error("Rezept nicht angelegt");
    await lege(`rezept:${res.recipeId}`, res.recipeId);
    await lege(NEU, null);
    expect(await schluesselDerZeilen()).toEqual([NEU, `rezept:${res.recipeId}`].sort());
    await deleteRecipeById(res.recipeId);
    expect(await schluesselDerZeilen()).toEqual([NEU]);
    await loesche();
  });

  it("verweist nur auf Rezepte, die es gibt — ein erfundenes bekommt keine Zeile", async () => {
    await expect(lege("rezept:999999", 999999)).rejects.toThrow(/FOREIGN KEY/);
    expect(await schluesselDerZeilen()).toEqual([]);
  });
});
