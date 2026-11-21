/**
 * Wege, die ein gespeichertes Rezept ändern, OHNE sein Änderungsdatum zu
 * schreiben: Zutaten zusammenführen, eine Zutat umbenennen, einen
 * Taxonomie-Eintrag löschen. Sie lassen den Zwischenstand des Rezepts stehen.
 *
 * Das ist die Entscheidung, nicht ein Versehen (CLAUDE.md, „Nach dem Alter
 * einer Zeile fragt beim Anbieten niemand"): Abgeräumt wird, wo das
 * Änderungsdatum geschrieben wird, also beim Speichern. Schreibt einer dieser
 * Wege das Datum eines Tages mit, wird der Test rot, und wer ihn anfasst,
 * liest die Regel: dann in derselben Transaktion abräumen.
 *
 * Und was mit der stehengebliebenen Zeile danach gilt: Die gelöschte
 * Taxonomie kommt beim Wiederherstellen nicht zurück; der Zutatenname ist
 * Text und wird erst beim Speichern gedeutet — die zusammengeführte Zutat
 * entsteht dabei neu.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

// Die drei Wege sind Server-Actions hinter `requireAdmin` und enden mit einer Umleitung.
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ id: 1 }) }));

frischeDb("zwischenstand-nebenwege");

const GESPEICHERT_AM = new Date("2026-10-23T10:00:00.000Z");
/** Was ein Editor mit diesem Rezept im Formular trüge: die Zutat als Text, der Schritt in seiner Form. */
const ABSCHNITTE = JSON.stringify([
  { name: "", ingredients: [{ name: "Möhre", amount: "3", unit: "Stück", note: "" }], steps: [{ text: "Kochen.", imageId: null }] },
]);
let adminId: number;
let rezeptId: number;
let kategorieId: number;

beforeAll(async () => {
  const { findOrCreateTaxonomy } = await import("@/lib/taxonomies");
  const { saveRecipeFromForm } = await import("@/lib/recipe-save");
  adminId = (await adminAnlegen()).id;
  kategorieId = (await findOrCreateTaxonomy("kategorie", "Suppen")).id;
  const fd = new FormData();
  fd.set("titel", "Möhrensuppe");
  fd.set("portionen", "4");
  fd.set("status", "entwurf");
  fd.append("kategorien", String(kategorieId));
  fd.set("abschnitte", ABSCHNITTE);
  fd.set("notizen", "[]");
  const gespeichert = await saveRecipeFromForm(fd, adminId, GESPEICHERT_AM);
  if (!("recipeId" in gespeichert)) throw new Error("Rezept nicht angelegt");
  rezeptId = gespeichert.recipeId;
});

function formular(felder: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  return fd;
}

async function zutatId(name: string): Promise<number> {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const zeile = db.select({ id: schema.ingredient.id }).from(schema.ingredient).where(eq(schema.ingredient.name, name)).get();
  if (!zeile) throw new Error(`Zutat ${name} fehlt`);
  return zeile.id;
}

/** Alle Zutaten, die es gibt — nicht nur die am Rezept. */
async function zutatenliste(): Promise<string[]> {
  const { db, schema } = await import("@/db");
  const { asc } = await import("drizzle-orm");
  return (await db.select({ name: schema.ingredient.name }).from(schema.ingredient).orderBy(asc(schema.ingredient.name))).map((z) => z.name);
}

/** Was am Rezept hängt — und wann es zuletzt gespeichert wurde. */
async function rezept(): Promise<{ zutaten: string[]; kategorien: number[]; geaendertAm: Date }> {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const zutaten = db
    .select({ name: schema.ingredient.name })
    .from(schema.recipeIngredient)
    .innerJoin(schema.recipeSection, eq(schema.recipeSection.id, schema.recipeIngredient.sectionId))
    .innerJoin(schema.ingredient, eq(schema.ingredient.id, schema.recipeIngredient.ingredientId))
    .where(eq(schema.recipeSection.recipeId, rezeptId))
    .all()
    .map((z) => z.name);
  const kategorien = db
    .select({ id: schema.recipeTaxonomy.taxonomyId })
    .from(schema.recipeTaxonomy)
    .where(eq(schema.recipeTaxonomy.recipeId, rezeptId))
    .all()
    .map((k) => k.id);
  const zeile = db.select({ updatedAt: schema.recipe.updatedAt }).from(schema.recipe).where(eq(schema.recipe.id, rezeptId)).get();
  if (!zeile) throw new Error("Rezept fehlt");
  return { zutaten, kategorien, geaendertAm: zeile.updatedAt };
}

describe("Nebenwege am gespeicherten Rezept", () => {
  it("Zutaten zusammenführen, umbenennen und eine Taxonomie löschen ändern das Rezept — nicht sein Änderungsdatum, und die Zeile bleibt; wer sie danach wiederherstellt und speichert, legt die alte Zutat neu an", async () => {
    const { zwischenstandSichern, zwischenstandLaden } = await import("@/lib/recipe-zwischenstand-store");
    const { schluesselFuerRezept, editorAusDaten } = await import("@/lib/recipe-zwischenstand");
    const { buildEditorProps } = await import("@/app/admin/(protected)/rezepte/editor-data");
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const zutaten = await import("@/app/admin/(protected)/zutaten/actions");
    const taxonomien = await import("@/app/admin/(protected)/taxonomien/actions");

    const schluessel = schluesselFuerRezept(rezeptId);
    const gesichert = await zwischenstandSichern({
      schluessel,
      daten: { titel: ["Getippt, noch nicht gespeichert"], kategorien: [String(kategorieId)], abschnitte: [ABSCHNITTE], notizen: ["[]"] },
      jetzt: new Date(GESPEICHERT_AM.getTime() + 60_000),
      bekannterStand: null,
    });
    if (gesichert.ergebnis !== "gesichert") throw new Error("nicht gesichert");
    const steht = async () => (await zwischenstandLaden(schluessel))?.stand;
    expect(await rezept()).toEqual({ zutaten: ["Möhre"], kategorien: [kategorieId], geaendertAm: GESPEICHERT_AM });

    // 1. Zusammenführen: „Möhre" geht in „Karotte" auf.
    await expect(zutaten.createIngredientAction(formular({ name: "Karotte" }))).rejects.toThrow("NEXT_REDIRECT");
    await expect(
      zutaten.mergeIngredientsAction(formular({ sourceId: String(await zutatId("Möhre")), targetId: String(await zutatId("Karotte")) })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(await rezept()).toEqual({ zutaten: ["Karotte"], kategorien: [kategorieId], geaendertAm: GESPEICHERT_AM });
    expect(await steht()).toBe(gesichert.stand);

    // 2. Umbenennen.
    await expect(
      zutaten.updateIngredientAction(formular({ id: String(await zutatId("Karotte")), name: "Gelbe Rübe", imageId: "" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(await rezept()).toEqual({ zutaten: ["Gelbe Rübe"], kategorien: [kategorieId], geaendertAm: GESPEICHERT_AM });
    expect(await steht()).toBe(gesichert.stand);

    // 3. Die Kategorie löschen.
    await expect(taxonomien.deleteTaxonomyEntryAction(formular({ typ: "kategorie", id: String(kategorieId) }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await rezept()).toEqual({ zutaten: ["Gelbe Rübe"], kategorien: [], geaendertAm: GESPEICHERT_AM });
    expect(await steht()).toBe(gesichert.stand);

    // Was dann gilt. Die Zeile trägt weiter, was getippt war: die gelöschte Kategorie und den alten Zutatennamen.
    const zeile = await zwischenstandLaden(schluessel);
    const editor = await buildEditorProps(rezeptId);
    if (!zeile || !editor) throw new Error("Zeile oder Editor fehlt");
    expect(zeile.daten.kategorien).toEqual([String(kategorieId)]);
    const wieder = editorAusDaten(zeile.daten, editor.initial, {
      bildIds: [],
      taxonomieIds: { kategorien: editor.taxonomies.kategorien.map((k) => k.id) },
    });
    if (!wieder) throw new Error("Die Zeile lässt sich nicht übersetzen");
    // Die gelöschte Kategorie kommt nicht zurück: Der Editor hat sie nicht mehr zur Auswahl. Geprüft
    // am Wiederherstellen selbst — das Speichern filterte sie auch, seine Zusicherung allein bliebe grün.
    expect(wieder.initial.taxonomySelections).toEqual({ kategorien: [] });
    // Der Zutatenname ist Text und kommt zurück, wie er getippt war. Umbenannt wurde nur die Zutat.
    expect(wieder.initial.sections.flatMap((a) => a.ingredients.map((z) => z.name))).toEqual(["Möhre"]);
    expect(await zutatenliste()).toEqual(["Gelbe Rübe"]);

    // Erst das Speichern deutet den Namen: Die zusammengeführte Zutat entsteht neu, und das Rezept hängt wieder an ihr.
    const fd = new FormData();
    fd.set("id", String(rezeptId));
    fd.set("titel", wieder.initial.title);
    fd.set("portionen", String(wieder.initial.servings));
    fd.set("status", wieder.initial.status);
    for (const id of wieder.initial.taxonomySelections.kategorien) fd.append("kategorien", String(id));
    fd.set("abschnitte", JSON.stringify(wieder.initial.sections));
    fd.set("notizen", JSON.stringify(wieder.initial.notes));
    const spaeter = new Date(GESPEICHERT_AM.getTime() + 120_000);
    expect(await saveRecipeFromForm(fd, adminId, spaeter)).toEqual({ recipeId: rezeptId });
    expect(await rezept()).toEqual({ zutaten: ["Möhre"], kategorien: [], geaendertAm: spaeter });
    expect(await zutatenliste()).toEqual(["Gelbe Rübe", "Möhre"]);
  });
});
