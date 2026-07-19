/**
 * Integrationstest Rezept-CRUD: Anlegen, Bearbeiten und Löschen über die
 * Formular-Kernlogik (saveRecipeFromForm) gegen eine echte SQLite-DB.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let adminId: number;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-crud-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
  const { db, schema } = await import("@/db");
  const [admin] = await db
    .insert(schema.adminUser)
    .values({
      email: "rose@example.de",
      passwordHash: "x",
      name: "Rose",
      createdAt: new Date(),
    })
    .returning();
  adminId = admin.id;
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function recipeForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("titel", "Käsespätzle");
  fd.set("teaser", "Deftig und schnell.");
  fd.set("vorbereitung", "15");
  fd.set("kochzeit", "20");
  fd.set("portionen", "4");
  fd.set("schwierigkeit", "mittel");
  fd.set("kcal", "650");
  fd.set("status", "entwurf");
  fd.set(
    "abschnitte",
    JSON.stringify([
      {
        name: "",
        ingredients: [
          { name: "Spätzle", amount: "500", unit: "g", note: "" },
          { name: "Bergkäse", amount: "200", unit: "g", note: "gerieben" },
          { name: "Muskat", amount: "", unit: "", note: "" },
        ],
        steps: ["Spätzle kochen.", "Mit Käse schichten."],
      },
    ]),
  );
  fd.set(
    "notizen",
    JSON.stringify([
      { text: "Öffentlicher Tipp", isPublic: true },
      { text: "Interner Hinweis", isPublic: false },
    ]),
  );
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

describe("Rezept-CRUD", () => {
  it("legt ein Rezept mit Abschnitten, Zutaten und Notizen an", async () => {
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const { getFullRecipe } = await import("@/lib/recipes");

    const result = await saveRecipeFromForm(recipeForm(), adminId);
    expect("recipeId" in result).toBe(true);
    const id = (result as { recipeId: number }).recipeId;

    const full = await getFullRecipe({ id });
    expect(full).not.toBeNull();
    expect(full!.recipe.slug).toBe("kaesespaetzle");
    expect(full!.recipe.totalMinutes).toBe(35);
    expect(full!.recipe.status).toBe("entwurf");
    expect(full!.recipe.publishedAt).toBeNull();
    expect(full!.sections).toHaveLength(1);
    expect(full!.sections[0].ingredients).toHaveLength(3);
    // Zutaten wurden automatisch angelegt
    expect(full!.sections[0].ingredients.map((i) => i.name)).toContain("Bergkäse");
    // "nach Geschmack" ohne Menge
    expect(
      full!.sections[0].ingredients.find((i) => i.name === "Muskat")!.amount,
    ).toBeNull();
    expect(full!.publicNotes).toHaveLength(1);
    expect(full!.adminNotes).toHaveLength(1);
  });

  it("Entwurf speichern → Editor-Seite (Redirect-Ziel) lädt das Rezept [Regression: page-can-not-load]", async () => {
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const { buildEditorProps } = await import(
      "@/app/admin/(protected)/rezepte/editor-data"
    );

    // „Entwurf speichern": neues Rezept mit Status „entwurf" (Formular-Standard).
    const result = await saveRecipeFromForm(
      recipeForm({ titel: "Entwurf-Regression", status: "entwurf" }),
      adminId,
    );
    expect("recipeId" in result).toBe(true);
    const id = (result as { recipeId: number }).recipeId;

    // Der Save-Redirect zeigt auf /admin/rezepte/{id}; diese Seite baut ihre
    // Daten über buildEditorProps(id). Für einen ENTWURF darf das NICHT null
    // sein — sonst löst die Seite notFound() aus und der Nutzer sieht „page can
    // not load". getFullRecipe filtert bewusst NICHT nach Status, daher lädt
    // auch der Entwurf. Genau dieser Vertrag wird hier festgenagelt.
    const props = await buildEditorProps(id);
    expect(props).not.toBeNull();
    expect(props!.initial.id).toBe(id);
    expect(props!.initial.status).toBe("entwurf");
    expect(props!.initial.title).toBe("Entwurf-Regression");
  });

  it("veröffentlicht beim Statuswechsel und setzt publishedAt genau einmal", async () => {
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const { getFullRecipe } = await import("@/lib/recipes");

    const created = await saveRecipeFromForm(
      recipeForm({ titel: "Testkuchen" }),
      adminId,
    );
    const id = (created as { recipeId: number }).recipeId;

    await saveRecipeFromForm(
      recipeForm({ titel: "Testkuchen", id: String(id), status: "veroeffentlicht" }),
      adminId,
    );
    const published = await getFullRecipe({ id });
    expect(published!.recipe.status).toBe("veroeffentlicht");
    const firstPublishedAt = published!.recipe.publishedAt;
    expect(firstPublishedAt).not.toBeNull();

    // Erneutes Speichern ändert publishedAt nicht
    await new Promise((r) => setTimeout(r, 5));
    await saveRecipeFromForm(
      recipeForm({ titel: "Testkuchen v2", id: String(id), status: "veroeffentlicht" }),
      adminId,
    );
    const again = await getFullRecipe({ id });
    expect(again!.recipe.title).toBe("Testkuchen v2");
    expect(again!.recipe.publishedAt!.getTime()).toBe(firstPublishedAt!.getTime());
  });

  it("verhindert Slug-Kollisionen", async () => {
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const a = await saveRecipeFromForm(recipeForm({ titel: "Pfannkuchen" }), adminId);
    const b = await saveRecipeFromForm(recipeForm({ titel: "Pfannkuchen" }), adminId);
    const { getFullRecipe } = await import("@/lib/recipes");
    const fullA = await getFullRecipe({ id: (a as any).recipeId });
    const fullB = await getFullRecipe({ id: (b as any).recipeId });
    expect(fullA!.recipe.slug).toBe("pfannkuchen");
    expect(fullB!.recipe.slug).toBe("pfannkuchen-2");
  });

  it("löscht Rezepte samt abhängiger Daten", async () => {
    const { saveRecipeFromForm, deleteRecipeById } = await import("@/lib/recipe-save");
    const { getFullRecipe } = await import("@/lib/recipes");
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const created = await saveRecipeFromForm(recipeForm({ titel: "Wegwerf" }), adminId);
    const id = (created as { recipeId: number }).recipeId;
    await deleteRecipeById(id);
    expect(await getFullRecipe({ id })).toBeNull();
    const orphanSections = await db
      .select()
      .from(schema.recipeSection)
      .where(eq(schema.recipeSection.recipeId, id));
    expect(orphanSections).toHaveLength(0);
  });

  it("legt neue Taxonomien (kategorien__neu) erst beim Speichern an und verknüpft sie", async () => {
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");

    // Vorher existiert die Kategorie NICHT.
    const before = await db
      .select()
      .from(schema.taxonomy)
      .where(
        and(
          eq(schema.taxonomy.type, "kategorie"),
          eq(schema.taxonomy.name, "Ofengericht"),
        ),
      );
    expect(before).toHaveLength(0);

    const fd = recipeForm({ titel: "Ofengemüse" });
    fd.append("kategorien__neu", "Ofengericht");
    fd.append("ernaehrungsformen__neu", "Vegan");
    const res = await saveRecipeFromForm(fd, adminId);
    const rid = (res as { recipeId: number }).recipeId;

    // Jetzt existiert sie und ist dem Rezept als primäre Kategorie zugeordnet.
    const [kat] = await db
      .select()
      .from(schema.taxonomy)
      .where(
        and(
          eq(schema.taxonomy.type, "kategorie"),
          eq(schema.taxonomy.name, "Ofengericht"),
        ),
      );
    expect(kat).toBeTruthy();
    const links = await db
      .select()
      .from(schema.recipeTaxonomy)
      .where(eq(schema.recipeTaxonomy.recipeId, rid));
    const katLink = links.find((l) => l.taxonomyId === kat.id);
    expect(katLink).toBeTruthy();
    expect(katLink!.isPrimary).toBe(true);

    // Zweites Rezept mit demselben „neu"-Namen → idempotent, keine Dublette.
    const fd2 = recipeForm({ titel: "Zweites Ofengemüse" });
    fd2.append("kategorien__neu", "Ofengericht");
    await saveRecipeFromForm(fd2, adminId);
    const all = await db
      .select()
      .from(schema.taxonomy)
      .where(
        and(
          eq(schema.taxonomy.type, "kategorie"),
          eq(schema.taxonomy.name, "Ofengericht"),
        ),
      );
    expect(all).toHaveLength(1);
  });

  it("lehnt ungültige Eingaben ab", async () => {
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const noTitle = await saveRecipeFromForm(recipeForm({ titel: "  " }), adminId);
    expect("error" in noTitle).toBe(true);
    const badJson = await saveRecipeFromForm(
      recipeForm({ abschnitte: "kein json" }),
      adminId,
    );
    expect("error" in badJson).toBe(true);
  });

  it("Bearbeiten persistiert geänderte Zutaten, Beschreibung und SEO [Regression: Speichern kaputt]", async () => {
    // Deckt die zuvor UNGETESTETE Lücke: der Update-Pfad muss geänderte
    // skalare Felder (teaser/SEO) UND ersetzte Abschnitte/Zutaten dauerhaft
    // schreiben — nachgelesen über denselben Ladepfad wie der Editor.
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const { buildEditorProps } = await import(
      "@/app/admin/(protected)/rezepte/editor-data"
    );

    const created = await saveRecipeFromForm(
      recipeForm({
        titel: "Update-Ziel",
        teaser: "ALT Beschreibung.",
        seoTitel: "ALT SEO-Titel",
        seoBeschreibung: "ALT SEO-Beschreibung",
      }),
      adminId,
    );
    const id = (created as { recipeId: number }).recipeId;

    const upd = await saveRecipeFromForm(
      recipeForm({
        titel: "Update-Ziel",
        id: String(id),
        teaser: "NEU Beschreibung.",
        seoTitel: "NEU SEO-Titel",
        seoBeschreibung: "NEU SEO-Beschreibung",
        abschnitte: JSON.stringify([
          {
            name: "",
            ingredients: [
              { name: "Roggenmehl", amount: "333", unit: "g", note: "frisch gemahlen" },
            ],
            steps: ["Teig kneten."],
          },
        ]),
      }),
      adminId,
    );
    expect("recipeId" in upd).toBe(true);

    const props = await buildEditorProps(id);
    expect(props).not.toBeNull();
    expect(props!.initial.teaser).toBe("NEU Beschreibung.");
    expect(props!.initial.seoTitle).toBe("NEU SEO-Titel");
    expect(props!.initial.seoDescription).toBe("NEU SEO-Beschreibung");
    expect(props!.initial.sections).toHaveLength(1);
    const ings = props!.initial.sections[0].ingredients;
    expect(ings.map((i) => i.name)).toEqual(["Roggenmehl"]);
    expect(ings[0].amount).toBe("333");
    expect(ings[0].note).toBe("frisch gemahlen");
  });

  it("Schreibfehler (schreibgeschützte DB) → sichtbarer Fehler statt stillem Throw [Regression]", async () => {
    // Wurzel des „wird alles nicht gespeichert"-Symptoms: schlägt der Schreibvorgang
    // fehl (z. B. schreibgeschützte/gesperrte DB), darf saveRecipeFromForm NICHT
    // werfen (Server-Action verschluckt das sonst still), sondern muss einen
    // sichtbaren Fehler zurückgeben. Simuliert via PRAGMA query_only.
    const { saveRecipeFromForm } = await import("@/lib/recipe-save");
    const { db } = await import("@/db");
    const client = (
      db as unknown as { $client: { pragma: (s: string) => unknown } }
    ).$client;

    // Anlegen (schafft auch die Zutaten, damit der Update-Pfad NICHT neu einfügt).
    const created = await saveRecipeFromForm(recipeForm({ titel: "Readonly-Ziel" }), adminId);
    const id = (created as { recipeId: number }).recipeId;

    client.pragma("query_only = ON");
    try {
      const res = await saveRecipeFromForm(
        recipeForm({ titel: "Geändert", id: String(id) }),
        adminId,
      );
      expect("error" in res).toBe(true); // kein Throw, sichtbarer Fehler
    } finally {
      client.pragma("query_only = OFF");
    }

    // Nach dem Aufheben speichert es wieder normal.
    const ok = await saveRecipeFromForm(
      recipeForm({ titel: "Wieder-OK", id: String(id) }),
      adminId,
    );
    expect("recipeId" in ok).toBe(true);
  });
});
