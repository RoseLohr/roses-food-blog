/**
 * Was die Bearbeiten-Seite dem Rezept-Editor über das GESPEICHERTE Rezept
 * sagt, neben den Anfangswerten des Formulars (editor-data.ts) — und was sie
 * mit `?zwischenstand=1` ausliefert. Gegen die echte Datenbank.
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
 *
 * Und was der Editor zeigt, wenn ihm gesagt wird, dass sein Inhalt aus einem
 * Zwischenstand stammt: den Hinweis darüber und die vorgemerkten Namen.
 *
 * Die Seite selbst wird gerendert wie auf dem Server. Gemessen wird das HTML,
 * das der Browser bekäme, also die ganze Kette: Zeile → Ablage →
 * `erlaubteVerweise` → `editorAusDaten` → Anfangswerte und vorgemerkte Namen
 * im Editor. In EINEM Fall steht ein Spion an der Stelle der Ablage: Sie
 * liefert nie, was dort gemessen wird. Was erst im Browser geschieht
 * (Speichern, mit und ohne Fehler), wird im nächsten Schritt gemessen.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

// Die Seite fragt nach der Sitzung, bevor sie etwas lädt; die ist hier nicht das Thema.
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ id: 1 }) }));

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

const ENTITAETEN: Record<string, string> = { "&quot;": '"', "&#x27;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };
const klartext = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&quot;|&#x27;|&lt;|&gt;|&amp;/g, (e) => ENTITAETEN[e]);

/** Was im ausgelieferten HTML steht: die Eingabefelder (je Feld die Attribute) und die Hinweise. */
function gelesen(html: string) {
  const eingaben = [...html.matchAll(/<input\b([^>]*)>/g)].map(([, attribute]) =>
    Object.fromEntries([...attribute.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, wert]) => [name, klartext(wert ?? "")])),
  );
  return {
    wert: (name: string) => eingaben.filter((e) => e.name === name && e.type !== "checkbox").map((e) => e.value),
    angehakt: (name: string) => eingaben.filter((e) => e.name === name && e.type === "checkbox" && "checked" in e).map((e) => e.value),
    hinweise: [...html.matchAll(/<div role="status"[^>]*>(.*?)<\/div>/g)].map(([, inhalt]) => klartext(inhalt)),
  };
}

describe("ein Editor, dessen Inhalt aus einem Zwischenstand stammt", () => {
  it("zeigt den Hinweis mit Tag und Uhrzeit der Sicherung und trägt die vorgemerkten Namen im Formular — ohne die Angaben nichts davon", async () => {
    const { buildEditorProps } = await editorDaten();
    const { RecipeEditor } = await import("@/app/admin/(protected)/rezepte/recipe-editor");
    const props = (await buildEditorProps(entwurf))!;

    const ohne = gelesen(renderToStaticMarkup(createElement(RecipeEditor, props)));
    expect(ohne.hinweise).toEqual([]);
    expect(ohne.wert("kategorien__neu")).toEqual([]);

    const mit = gelesen(
      renderToStaticMarkup(
        createElement(RecipeEditor, {
          ...props,
          taxonomiePending: { kategorien: ["Eintopf"] },
          zwischenstandWiederhergestellt: { zeit: "13.10.2026 um 18:41" },
        }),
      ),
    );
    // Tag UND Uhrzeit: Eine Zeile kann über 30 Tage alt sein.
    expect(mit.hinweise).toEqual(["Zwischenstand vom 13.10.2026 um 18:41 wiederhergestellt — noch nicht gespeichert."]);
    expect(mit.wert("kategorien__neu")).toEqual(["Eintopf"]);
    // Beides sagt nichts über die Felder: Die kommen weiter aus den Anfangswerten.
    expect(mit.wert("titel")).toEqual(["Noch nicht fertig"]);
  });
});

/** Vor Wochen gesichert: Der Hinweis muss DIESEN Tag nennen, eine Uhrzeit allein läse sich wie heute. */
const GESICHERT_AM = new Date(2026, 9, 13, 18, 41);

/** Die Zeile des Rezepts: über die Ablage gesichert — oder roh, für das, was die Ablage nie schriebe. */
async function zeile(rezeptId: number, inhalt: Record<string, string[]> | string | null): Promise<void> {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { zwischenstandSichern } = await import("@/lib/recipe-zwischenstand-store");
  const { schluesselFuerRezept } = await import("@/lib/recipe-zwischenstand");
  const zeilen = schema.rezeptZwischenstand;
  const schluessel = schluesselFuerRezept(rezeptId);
  db.delete(zeilen).where(eq(zeilen.schluessel, schluessel)).run();
  if (typeof inhalt === "string") {
    const stand = "5b0c7f1e-9a3d-4c2b-8e6f-1a2b3c4d5e6f";
    db.insert(zeilen).values({ schluessel, recipeId: rezeptId, formular: inhalt, stand, gesichertAm: GESICHERT_AM }).run();
  } else if (inhalt) {
    await zwischenstandSichern({ schluessel, daten: inhalt, jetzt: GESICHERT_AM, bekannterStand: null });
  }
}

/** Die Seite, wie der Server sie ausliefert: Überschrift, Eingabefelder, Hinweise und der Link nach vorn. */
async function seite(rezeptId: number, suchparameter: Record<string, string | string[]> = {}) {
  const { default: Seite } = await import("@/app/admin/(protected)/rezepte/[id]/page");
  const html = renderToStaticMarkup(
    await Seite({ params: Promise.resolve({ id: String(rezeptId) }), searchParams: Promise.resolve(suchparameter) }),
  );
  return {
    ...gelesen(html),
    ueberschrift: klartext(html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1] ?? ""),
    oeffentlich: html.match(/<a [^>]*href="([^"]*)"[^>]*>Öffentliche Seite ansehen<\/a>/)?.[1] ?? null,
  };
}

describe("Bearbeiten-Seite mit ?zwischenstand=1", () => {
  it("legt den Zwischenstand in den Editor — mit Titelbild, Schrittbild, Häkchen und vorgemerkten Namen, soweit es sie noch gibt", async () => {
    const schritte = [
      { text: "Mit Foto.", imageId: bild },
      { text: "Das Foto ist gelöscht.", imageId: geloeschtesBild },
    ];
    await zeile(entwurf, {
      titel: ["Aus dem Zwischenstand"],
      titelbild: [String(bild)],
      kategorien: [String(taxonomie.kategorien), String(geloeschteTaxonomie)],
      kategorien__neu: ["Eintopf"],
      abschnitte: [JSON.stringify([{ name: "", ingredients: [], steps: schritte }])],
      notizen: ["[]"],
    });

    const s = await seite(entwurf, { zwischenstand: "1" });
    expect(s.wert("titel")).toEqual(["Aus dem Zwischenstand"]);
    expect(s.wert("titelbild")).toEqual([String(bild)]);
    expect(s.angehakt("kategorien")).toEqual([String(taxonomie.kategorien)]);
    expect(s.wert("kategorien__neu")).toEqual(["Eintopf"]);
    expect(JSON.parse(s.wert("abschnitte")[0])[0].steps).toEqual([schritte[0], { ...schritte[1], imageId: null }]);
    // Der Hinweis nennt Tag UND Uhrzeit der Sicherung, nicht den Augenblick des Öffnens.
    expect(s.hinweise).toEqual(["Zwischenstand vom 13.10.2026 um 18:41 wiederhergestellt — noch nicht gespeichert."]);

    // Gegenprobe: Ohne den Parameter steht das gespeicherte Rezept im Editor, ohne Hinweis. Und es
    // zählt der WERT, nicht die Anwesenheit: Nur genau `1` stellt wieder her — nicht `0`, nicht der
    // leere Wert (`?zwischenstand`), nicht `1` zweimal (Next liefert dann eine Liste).
    const andere: Record<string, string | string[]>[] = [{}, { zwischenstand: "0" }, { zwischenstand: "" }, { zwischenstand: ["1", "1"] }];
    for (const suchparameter of andere) {
      const fall = JSON.stringify(suchparameter);
      const ohne = await seite(entwurf, suchparameter);
      expect(ohne.wert("titel"), fall).toEqual(["Noch nicht fertig"]);
      expect(ohne.wert("titelbild"), fall).toEqual([]);
      expect(ohne.angehakt("kategorien"), fall).toEqual([]);
      expect(ohne.hinweise, fall).toEqual([]);
    }
  });

  it("ohne Zeile, und mit einer, die sich nicht laden lässt, bleibt es beim gespeicherten Rezept — ohne Hinweis", async () => {
    const fehler = console.error;
    console.error = () => undefined;
    try {
      for (const inhalt of [null, "null", '{"titel":["Unbrauchbar"],"abschnitte":["{kein json"],"notizen":["[]"]}']) {
        await zeile(entwurf, inhalt);
        const s = await seite(entwurf, { zwischenstand: "1" });
        expect(s.wert("titel"), String(inhalt)).toEqual(["Noch nicht fertig"]);
        expect(s.hinweise, String(inhalt)).toEqual([]);
      }
    } finally {
      console.error = fehler;
    }
  });

  it("liefert die Ablage doch ein Formular, das sich nicht übersetzen lässt, stellt die SEITE es nicht wieder her", async () => {
    // Die echte Ablage liefert das nicht (Fall darüber: Sie bietet die Zeile gar nicht an). Ihr Typ
    // lässt es zu, und die Seite verlässt sich nicht darauf. Deshalb hier, und nur hier, eine
    // Ablage, die es doch tut: Gemessen wird der Zweig der Seite.
    const ablage = await import("@/lib/recipe-zwischenstand-store");
    const { schluesselFuerRezept } = await import("@/lib/recipe-zwischenstand");
    await zeile(entwurf, null);
    const laden = vi.spyOn(ablage, "zwischenstandLaden").mockResolvedValue({
      schluessel: schluesselFuerRezept(entwurf),
      recipeId: entwurf,
      daten: { titel: ["Unbrauchbar"], abschnitte: ["{kein json"], notizen: ["[]"] },
      stand: "5b0c7f1e-9a3d-4c2b-8e6f-1a2b3c4d5e6f",
      gesichertAm: GESICHERT_AM,
    });
    try {
      const s = await seite(entwurf, { zwischenstand: "1" });
      // Die Seite hat wirklich DIESE Ablage gefragt — sonst mäße der Fall dasselbe wie der darüber.
      expect(laden.mock.calls).toEqual([[schluesselFuerRezept(entwurf)]]);
      expect(s.wert("titel")).toEqual(["Noch nicht fertig"]);
      expect(s.hinweise).toEqual([]);
    } finally {
      laden.mockRestore();
    }
  });

  it("Überschrift und Link zur öffentlichen Seite bleiben die des GESPEICHERTEN Rezepts — Titel, Slug und Status im Zwischenstand sind nur getippt", async () => {
    await zeile(veroeffentlicht, { titel: ["Linsensuppe, neu"], slug: ["noch-nie-gespeichert"], status: ["entwurf"] });
    const mit = await seite(veroeffentlicht, { zwischenstand: "1" });
    expect(mit.wert("titel")).toEqual(["Linsensuppe, neu"]);
    expect(mit.wert("slug")).toEqual(["noch-nie-gespeichert"]);
    expect(mit.ueberschrift).toBe("Rezept bearbeiten: Linsensuppe");
    expect(mit.oeffentlich).toBe("/rezepte/linsensuppe");

    await zeile(entwurf, { titel: ["Fast fertig"], slug: ["noch-nie-gespeichert"], status: ["veroeffentlicht"] });
    const ohne = await seite(entwurf, { zwischenstand: "1" });
    expect(ohne.wert("titel")).toEqual(["Fast fertig"]);
    expect(ohne.ueberschrift).toBe("Rezept bearbeiten: Noch nicht fertig");
    expect(ohne.oeffentlich).toBeNull();
  });
});
