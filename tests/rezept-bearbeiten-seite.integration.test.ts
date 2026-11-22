/**
 * Was die Bearbeiten-Seite dem Rezept-Editor über das GESPEICHERTE Rezept
 * sagt, neben den Anfangswerten des Formulars (editor-data.ts) — gegen die
 * echte Datenbank.
 *
 * Zwei Angaben, die ein wiederhergestellter Zwischenstand braucht und nicht
 * selbst mitbringen darf:
 *  1. Worauf er verweisen darf (`erlaubteVerweise`): die Bilder und
 *     Taxonomien, die der Editor gerade zur Auswahl hat. Gemessen wird die
 *     ganze Kette bis `editorAusDaten` — liefert sie nichts, verliert
 *     Wiederherstellen still Titelbild, Schrittbilder und Häkchen.
 *  2. Wo die öffentliche Seite steht (`oeffentlicheSeite`). Die Anfangswerte
 *     taugen dafür nicht mehr, sobald sie aus einem Zwischenstand stammen:
 *     Slug und Status darin sind getippt, nicht gespeichert.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("rezept-bearbeiten-seite");

/** Feld des Formulars → Art der Taxonomie. */
const FELDER = {
  kategorien: "kategorie",
  schlagwoerter: "schlagwort",
  ernaehrungsformen: "ernaehrungsform",
  kuechen: "kueche",
  geraete: "geraet",
} as const;
type Feld = keyof typeof FELDER;
const felder = Object.keys(FELDER) as Feld[];

let veroeffentlicht: number;
let entwurf: number;
let bild: number;
let geloeschtesBild: number;
let taxonomie: Record<Feld, number>;
let geloeschteTaxonomie: number;

async function bildAnlegen(name: string): Promise<number> {
  const { db, schema } = await import("@/db");
  const [zeile] = await db
    .insert(schema.mediaImage)
    .values({ fileKey: name, originalName: `${name}.jpg`, altText: name, width: 1600, height: 900, sizeBytes: 1000, createdAt: new Date() })
    .returning();
  await db.insert(schema.mediaVariant).values([
    { imageId: zeile.id, width: 320 },
    { imageId: zeile.id, width: 1280 },
  ]);
  return zeile.id;
}

async function rezeptAnlegen(adminId: number, titel: string, status: string): Promise<number> {
  const { saveRecipeFromForm } = await import("@/lib/recipe-save");
  const fd = new FormData();
  fd.set("titel", titel);
  fd.set("portionen", "4");
  fd.set("status", status);
  fd.set("abschnitte", JSON.stringify([{ name: "", ingredients: [], steps: ["Kochen."] }]));
  fd.set("notizen", "[]");
  const gespeichert = await saveRecipeFromForm(fd, adminId);
  if (!("recipeId" in gespeichert)) throw new Error("Rezept nicht angelegt");
  return gespeichert.recipeId;
}

beforeAll(async () => {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { findOrCreateTaxonomy } = await import("@/lib/taxonomies");
  const admin = await adminAnlegen();
  veroeffentlicht = await rezeptAnlegen(admin.id, "Linsensuppe", "veroeffentlicht");
  entwurf = await rezeptAnlegen(admin.id, "Noch nicht fertig", "entwurf");
  bild = await bildAnlegen("vorhanden");
  geloeschtesBild = await bildAnlegen("geloescht");
  await db.delete(schema.mediaImage).where(eq(schema.mediaImage.id, geloeschtesBild));
  const angelegt = await Promise.all(felder.map((feld) => findOrCreateTaxonomy(FELDER[feld], `Eintrag ${feld}`)));
  taxonomie = Object.fromEntries(felder.map((feld, i) => [feld, angelegt[i].id])) as Record<Feld, number>;
  geloeschteTaxonomie = (await findOrCreateTaxonomy("kategorie", "Gelöscht")).id;
  await db.delete(schema.taxonomy).where(eq(schema.taxonomy.id, geloeschteTaxonomie));
});

async function editorDaten() {
  return import("@/app/admin/(protected)/rezepte/editor-data");
}

describe("erlaubteVerweise — worauf ein wiederhergestellter Zwischenstand verweisen darf", () => {
  it("lässt durch, was der Editor zur Auswahl hat: je Feld die eigenen Taxonomien, und nur Bilder, die es gibt", async () => {
    const { buildEditorProps, erlaubteVerweise } = await editorDaten();
    const { editorAusDaten } = await import("@/lib/recipe-zwischenstand");
    const props = (await buildEditorProps(entwurf))!;

    // Je Feld drei Häkchen: der eigene Eintrag, ein gelöschter — und der Eintrag eines ANDEREN
    // Feldes. Der gehört nicht hierher, auch wenn es ihn gibt.
    const haekchen = Object.fromEntries(
      felder.map((feld, i) => [
        feld,
        [taxonomie[feld], geloeschteTaxonomie, taxonomie[felder[(i + 1) % felder.length]]].map(String),
      ]),
    );
    const schritte = [
      { text: "Mit Foto.", imageId: bild },
      { text: "Das Foto ist gelöscht.", imageId: geloeschtesBild },
    ];
    const daten = {
      ...haekchen,
      titelbild: [String(bild)],
      abschnitte: [JSON.stringify([{ name: "", ingredients: [], steps: schritte }])],
    };

    const editor = editorAusDaten(daten, props.initial, erlaubteVerweise(props))!.initial;
    expect(editor.heroImageId).toBe(bild);
    expect(editor.sections[0].steps.map((s) => s.imageId)).toEqual([bild, null]);
    expect(editor.taxonomySelections).toEqual(Object.fromEntries(felder.map((feld) => [feld, [taxonomie[feld]]])));
    // Ein gelöschtes Bild kehrt auch als Titelbild nicht zurück.
    const ohneBild = editorAusDaten({ titelbild: [String(geloeschtesBild)] }, props.initial, erlaubteVerweise(props))!.initial;
    expect(ohneBild.heroImageId).toBeNull();
  });
});

describe("oeffentlicheSeite — die Adresse des GESPEICHERTEN Rezepts", () => {
  it("gibt es nur für ein veröffentlichtes Rezept — nicht für einen Entwurf, nicht für ein neues", async () => {
    const { buildEditorProps } = await editorDaten();
    expect((await buildEditorProps(veroeffentlicht))!.oeffentlicheSeite).toBe("/rezepte/linsensuppe");
    expect((await buildEditorProps(entwurf))!.oeffentlicheSeite).toBeNull();
    expect((await buildEditorProps(null))!.oeffentlicheSeite).toBeNull();
  });

  it("der Editor zeigt den Link aus dieser Angabe — nicht aus Slug und Status im Formular", async () => {
    const { buildEditorProps } = await editorDaten();
    const { RecipeEditor } = await import("@/app/admin/(protected)/rezepte/recipe-editor");
    const link = (html: string) => html.match(/<a [^>]*href="(\/rezepte\/[^"]*)"[^>]*>Öffentliche Seite ansehen<\/a>/)?.[1] ?? null;

    // Veröffentlicht, im Formular steht aber ein anderer Slug und „Entwurf": Der Link bleibt, wo
    // die Seite wirklich steht.
    const mit = (await buildEditorProps(veroeffentlicht))!;
    const getippt = { ...mit.initial, slug: "noch-nie-gespeichert", status: "entwurf" };
    expect(link(renderToStaticMarkup(createElement(RecipeEditor, mit)))).toBe("/rezepte/linsensuppe");
    expect(link(renderToStaticMarkup(createElement(RecipeEditor, { ...mit, initial: getippt })))).toBe("/rezepte/linsensuppe");

    // Entwurf, im Formular steht „veröffentlicht": kein Link auf eine Seite, die es nicht gibt.
    const ohne = (await buildEditorProps(entwurf))!;
    const vorgegriffen = { ...ohne.initial, slug: "noch-nie-gespeichert", status: "veroeffentlicht" };
    expect(link(renderToStaticMarkup(createElement(RecipeEditor, { ...ohne, initial: vorgegriffen })))).toBeNull();
  });
});
