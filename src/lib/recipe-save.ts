/**
 * Kernlogik zum Speichern/Löschen von Rezepten aus dem Editor-Formular.
 * Von der Server Action (Auth + Redirect) getrennt, damit sie
 * integrationstestbar ist.
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { slugify, uniqueSlug } from "@/lib/slug";
import { t } from "@/i18n/de";

const dict = t();

/** "1,5" / "1.5" / "" → number | null */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const sectionsSchema = z.array(
  z.object({
    name: z.string().trim().max(120).default(""),
    ingredients: z
      .array(
        z.object({
          name: z.string().trim().max(120),
          amount: z.string().max(20).default(""),
          unit: z.string().trim().max(30).default(""),
          note: z.string().trim().max(200).default(""),
        }),
      )
      .default([]),
    steps: z.array(z.string().trim().max(4000)).default([]),
  }),
);

const notesSchema = z.array(
  z.object({
    text: z.string().trim().max(4000),
    isPublic: z.boolean().default(false),
  }),
);

function intOr(v: FormDataEntryValue | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function idList(formData: FormData, field: string): number[] {
  return formData
    .getAll(field)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Zutaten anhand des Namens auflösen; unbekannte Zutaten werden angelegt. */
async function resolveIngredientIds(
  names: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (names.length === 0) return result;
  const all = await db.select().from(schema.ingredient);
  const byLower = new Map(all.map((i) => [i.name.toLowerCase(), i]));
  const slugs = new Set(all.map((i) => i.slug));

  for (const name of names) {
    const key = name.toLowerCase();
    const found = byLower.get(key);
    if (found) {
      result.set(key, found.id);
      continue;
    }
    const slug = uniqueSlug(slugify(name), (s) => slugs.has(s));
    slugs.add(slug);
    const [created] = await db
      .insert(schema.ingredient)
      .values({ name, slug })
      .returning();
    byLower.set(key, created);
    result.set(key, created.id);
  }
  return result;
}

export type SaveRecipeResult = { recipeId: number } | { error: string };

export async function saveRecipeFromForm(
  formData: FormData,
  adminId: number,
): Promise<SaveRecipeResult> {
  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const title = String(formData.get("titel") ?? "").trim();
  if (!title) return { error: dict.admin.recipes.invalid };

  let sections: z.infer<typeof sectionsSchema>;
  let notes: z.infer<typeof notesSchema>;
  try {
    sections = sectionsSchema.parse(
      JSON.parse(String(formData.get("abschnitte") ?? "[]")),
    );
    notes = notesSchema.parse(JSON.parse(String(formData.get("notizen") ?? "[]")));
  } catch {
    return { error: dict.admin.recipes.invalid };
  }
  // Leere Zeilen entfernen
  sections = sections
    .map((s) => ({
      ...s,
      ingredients: s.ingredients.filter((i) => i.name.trim() !== ""),
      steps: s.steps.filter((st) => st !== ""),
    }))
    .filter(
      (s, idx) =>
        idx === 0 || s.name !== "" || s.ingredients.length > 0 || s.steps.length > 0,
    );
  notes = notes.filter((n) => n.text !== "");

  const prep = intOr(formData.get("vorbereitung"), 0);
  const cook = intOr(formData.get("kochzeit"), 0);
  const servings = Math.max(1, intOr(formData.get("portionen"), 4));
  const difficultyRaw = String(formData.get("schwierigkeit") ?? "leicht");
  const difficulty = (["leicht", "mittel", "schwer"] as const).includes(
    difficultyRaw as never,
  )
    ? (difficultyRaw as "leicht" | "mittel" | "schwer")
    : "leicht";
  const kcalRaw = String(formData.get("kcal") ?? "").trim();
  const kcal = kcalRaw ? intOr(kcalRaw, 0) : null;
  const status =
    String(formData.get("status")) === "veroeffentlicht"
      ? ("veroeffentlicht" as const)
      : ("entwurf" as const);
  const heroImageId = formData.get("titelbild")
    ? Number(formData.get("titelbild"))
    : null;
  const imageIds = idList(formData, "bilder");

  // Slug bestimmen (eindeutig, eigenes Rezept ausgenommen)
  const slugInput = String(formData.get("slug") ?? "").trim();
  const existing = await db
    .select({ id: schema.recipe.id, slug: schema.recipe.slug })
    .from(schema.recipe);
  const taken = new Set(existing.filter((r) => r.id !== id).map((r) => r.slug));
  const slug = uniqueSlug(slugInput || title, (s) => taken.has(s));

  const now = new Date();
  const base = {
    title,
    slug,
    teaser: String(formData.get("teaser") ?? "").trim(),
    heroImageId: Number.isInteger(heroImageId) ? heroImageId : null,
    prepMinutes: prep,
    cookMinutes: cook,
    totalMinutes: prep + cook,
    servings,
    difficulty,
    kcal,
    tips: String(formData.get("tipps") ?? "").trim(),
    seoTitle: String(formData.get("seoTitel") ?? "").trim(),
    seoDescription: String(formData.get("seoBeschreibung") ?? "").trim(),
    status,
    updatedAt: now,
  };

  let recipeId: number;
  if (id !== null && Number.isInteger(id)) {
    const [current] = await db
      .select()
      .from(schema.recipe)
      .where(eq(schema.recipe.id, id));
    if (!current) return { error: dict.common.error };
    await db
      .update(schema.recipe)
      .set({
        ...base,
        publishedAt:
          status === "veroeffentlicht" && !current.publishedAt
            ? now
            : current.publishedAt,
      })
      .where(eq(schema.recipe.id, id));
    recipeId = id;
  } else {
    const [created] = await db
      .insert(schema.recipe)
      .values({
        ...base,
        publishedAt: status === "veroeffentlicht" ? now : null,
        authorId: adminId,
        createdAt: now,
      })
      .returning();
    recipeId = created.id;
  }

  // Abschnitte/Schritte/Zutaten ersetzen (Steps/Ingredients hängen per
  // ON DELETE CASCADE an den Abschnitten)
  await db
    .delete(schema.recipeIngredient)
    .where(eq(schema.recipeIngredient.recipeId, recipeId));
  await db
    .delete(schema.recipeSection)
    .where(eq(schema.recipeSection.recipeId, recipeId));

  const ingredientIds = await resolveIngredientIds(
    sections.flatMap((s) => s.ingredients.map((i) => i.name)),
  );

  for (const [i, s] of sections.entries()) {
    const [sec] = await db
      .insert(schema.recipeSection)
      .values({ recipeId, name: s.name, sortOrder: i })
      .returning();
    if (s.steps.length) {
      await db.insert(schema.recipeStep).values(
        s.steps.map((text, j) => ({ sectionId: sec.id, text, sortOrder: j })),
      );
    }
    if (s.ingredients.length) {
      await db.insert(schema.recipeIngredient).values(
        s.ingredients.map((ing, j) => ({
          recipeId,
          sectionId: sec.id,
          ingredientId: ingredientIds.get(ing.name.toLowerCase())!,
          amount: parseAmount(ing.amount),
          unit: ing.unit,
          note: ing.note,
          sortOrder: j,
        })),
      );
    }
  }

  // Notizen ersetzen
  await db.delete(schema.recipeNote).where(eq(schema.recipeNote.recipeId, recipeId));
  if (notes.length) {
    await db.insert(schema.recipeNote).values(
      notes.map((n) => ({
        recipeId,
        text: n.text,
        isPublic: n.isPublic,
        createdAt: now,
      })),
    );
  }

  // Taxonomien ersetzen
  const joins = [
    [schema.recipeCategory, "categoryId", idList(formData, "kategorien")],
    [schema.recipeTag, "tagId", idList(formData, "schlagwoerter")],
    [schema.recipeDietType, "dietTypeId", idList(formData, "ernaehrungsformen")],
    [schema.recipeCuisine, "cuisineId", idList(formData, "kuechen")],
    [schema.recipeEquipment, "equipmentId", idList(formData, "geraete")],
  ] as const;
  for (const [table, col, ids] of joins) {
    await db
      .delete(table as typeof schema.recipeCategory)
      .where(eq((table as typeof schema.recipeCategory).recipeId, recipeId));
    if (ids.length) {
      await db
        .insert(table as typeof schema.recipeCategory)
        .values(ids.map((tid) => ({ recipeId, [col]: tid }) as never));
    }
  }

  // Zusätzliche Bilder ersetzen
  await db.delete(schema.recipeImage).where(eq(schema.recipeImage.recipeId, recipeId));
  if (imageIds.length) {
    await db.insert(schema.recipeImage).values(
      imageIds.map((imgId, i) => ({ recipeId, imageId: imgId, sortOrder: i })),
    );
  }

  return { recipeId };
}

export async function deleteRecipeById(id: number): Promise<void> {
  // Abschnitte, Schritte, Zutaten, Notizen, Joins hängen per FK-Cascade am Rezept
  const sections = await db
    .select({ id: schema.recipeSection.id })
    .from(schema.recipeSection)
    .where(eq(schema.recipeSection.recipeId, id));
  if (sections.length) {
    await db.delete(schema.recipeStep).where(
      inArray(
        schema.recipeStep.sectionId,
        sections.map((s) => s.id),
      ),
    );
  }
  await db.delete(schema.recipe).where(eq(schema.recipe.id, id));
}
