/**
 * Kernlogik zum Speichern/Löschen von Rezepten aus dem Editor-Formular.
 * Von der Server Action (Auth + Redirect) getrennt, damit sie
 * integrationstestbar ist. Der komplette Schreib-Satz läuft in EINER
 * Transaktion (better-sqlite3, synchron) — ein Rezept ist nie halb gespeichert.
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { slugify, uniqueSlug } from "@/lib/slug";
import type { TaxonomyType } from "@/lib/taxonomies";
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
    // Schritt: Markdown-Text + optionales Bild. Akzeptiert auch das alte
    // reine String-Format (Rückwärtskompatibilität) und normalisiert es.
    steps: z
      .array(
        z.union([
          z
            .string()
            .trim()
            .max(8000)
            .transform((text) => ({ text, imageId: null as number | null })),
          z.object({
            text: z.string().trim().max(8000).default(""),
            imageId: z.number().int().positive().nullable().default(null),
          }),
        ]),
      )
      .default([]),
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
  return [
    ...new Set(
      formData
        .getAll(field)
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
}

/** Formularfeld → Taxonomie-Art (Reihenfolge = TAXONOMY_TYPES). */
const TAXONOMY_FIELDS: ReadonlyArray<[string, TaxonomyType]> = [
  ["kategorien", "kategorie"],
  ["schlagwoerter", "schlagwort"],
  ["ernaehrungsformen", "ernaehrungsform"],
  ["kuechen", "kueche"],
  ["geraete", "geraet"],
];

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
      steps: s.steps.filter((st) => st.text.trim() !== ""),
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

  // Saison: Kalenderwochen nur im gültigen Bereich (1–53) übernehmen.
  const isSeasonal = formData.get("saisonal") === "ja";
  const weekOrNull = (v: FormDataEntryValue | null): number | null => {
    const n = Number(String(v ?? "").trim());
    return Number.isInteger(n) && n >= 1 && n <= 53 ? n : null;
  };
  const seasonStartWeek = weekOrNull(formData.get("saisonVon"));
  const seasonEndWeek = weekOrNull(formData.get("saisonBis"));
  const status =
    String(formData.get("status")) === "veroeffentlicht"
      ? ("veroeffentlicht" as const)
      : ("entwurf" as const);
  const heroImageId = formData.get("titelbild")
    ? Number(formData.get("titelbild"))
    : null;

  // Slug bestimmen (eindeutig, eigenes Rezept ausgenommen)
  const slugInput = String(formData.get("slug") ?? "").trim();
  const existing = await db
    .select({ id: schema.recipe.id, slug: schema.recipe.slug })
    .from(schema.recipe);
  const taken = new Set(existing.filter((r) => r.id !== id).map((r) => r.slug));
  const slug = uniqueSlug(slugInput || title, (s) => taken.has(s));

  // Taxonomien: IDs je Feld einsammeln und gegen die erwartete Art prüfen —
  // der FK allein kann die Art nicht erzwingen. Eine Abfrage für alle Felder.
  const submittedTax = TAXONOMY_FIELDS.map(([field, type]) => ({
    type,
    ids: idList(formData, field),
  }));
  const allTaxIds = [...new Set(submittedTax.flatMap((s) => s.ids))];
  const typeById = new Map<number, TaxonomyType>(
    allTaxIds.length
      ? (
          await db
            .select({ id: schema.taxonomy.id, type: schema.taxonomy.type })
            .from(schema.taxonomy)
            .where(inArray(schema.taxonomy.id, allTaxIds))
        ).map((r) => [r.id, r.type])
      : [],
  );
  const primaryCategoryId =
    submittedTax
      .find((s) => s.type === "kategorie")!
      .ids.find((tid) => typeById.get(tid) === "kategorie") ?? null;
  const taxonomyRows = submittedTax.flatMap(({ type, ids }) =>
    ids
      .filter((tid) => typeById.get(tid) === type)
      .map((tid) => ({
        taxonomyId: tid,
        isPrimary: tid === primaryCategoryId,
      })),
  );

  const ingredientIds = await resolveIngredientIds(
    sections.flatMap((s) => s.ingredients.map((i) => i.name)),
  );

  const now = new Date();
  const base = {
    title,
    slug,
    teaser: String(formData.get("teaser") ?? "").trim(),
    heroImageId: Number.isInteger(heroImageId) ? heroImageId : null,
    prepMinutes: prep,
    cookMinutes: cook,
    servings,
    difficulty,
    kcal,
    isSeasonal,
    seasonStartWeek,
    seasonEndWeek,
    tips: String(formData.get("tipps") ?? "").trim(),
    seoTitle: String(formData.get("seoTitel") ?? "").trim(),
    seoDescription: String(formData.get("seoBeschreibung") ?? "").trim(),
    status,
    updatedAt: now,
  };

  // Kompletter Schreib-Satz atomar (sync-Transaktion, better-sqlite3).
  const recipeId = db.transaction((tx): number | null => {
    let rid: number;
    if (id !== null && Number.isInteger(id)) {
      const current = tx
        .select()
        .from(schema.recipe)
        .where(eq(schema.recipe.id, id))
        .get();
      if (!current) return null;
      tx.update(schema.recipe)
        .set({
          ...base,
          publishedAt:
            status === "veroeffentlicht" && !current.publishedAt
              ? now
              : current.publishedAt,
        })
        .where(eq(schema.recipe.id, id))
        .run();
      rid = id;
    } else {
      const created = tx
        .insert(schema.recipe)
        .values({
          ...base,
          publishedAt: status === "veroeffentlicht" ? now : null,
          authorId: adminId,
          createdAt: now,
        })
        .returning()
        .get();
      rid = created.id;
    }

    // Abschnitte ersetzen — Schritte und Zutatenzeilen hängen per
    // ON DELETE CASCADE am Abschnitt.
    tx.delete(schema.recipeSection)
      .where(eq(schema.recipeSection.recipeId, rid))
      .run();
    for (const [i, s] of sections.entries()) {
      const sec = tx
        .insert(schema.recipeSection)
        .values({ recipeId: rid, name: s.name, sortOrder: i })
        .returning()
        .get();
      if (s.steps.length) {
        tx.insert(schema.recipeStep)
          .values(
            s.steps.map((step, j) => ({
              sectionId: sec.id,
              text: step.text,
              imageId: step.imageId ?? null,
              sortOrder: j,
            })),
          )
          .run();
      }
      if (s.ingredients.length) {
        tx.insert(schema.recipeIngredient)
          .values(
            s.ingredients.map((ing, j) => ({
              sectionId: sec.id,
              ingredientId: ingredientIds.get(ing.name.toLowerCase())!,
              amount: parseAmount(ing.amount),
              unit: ing.unit,
              note: ing.note,
              sortOrder: j,
            })),
          )
          .run();
      }
    }

    // Notizen ersetzen
    tx.delete(schema.recipeNote)
      .where(eq(schema.recipeNote.recipeId, rid))
      .run();
    if (notes.length) {
      tx.insert(schema.recipeNote)
        .values(
          notes.map((n) => ({
            recipeId: rid,
            text: n.text,
            isPublic: n.isPublic,
            createdAt: now,
          })),
        )
        .run();
    }

    // Taxonomie-Zuordnungen ersetzen (erste Kategorie = primär → Karten-Label)
    tx.delete(schema.recipeTaxonomy)
      .where(eq(schema.recipeTaxonomy.recipeId, rid))
      .run();
    if (taxonomyRows.length) {
      tx.insert(schema.recipeTaxonomy)
        .values(taxonomyRows.map((r) => ({ recipeId: rid, ...r })))
        .run();
    }

    return rid;
  });

  if (recipeId === null) return { error: dict.common.error };
  return { recipeId };
}

export async function deleteRecipeById(id: number): Promise<void> {
  // Abschnitte, Schritte, Zutaten, Notizen, Taxonomien und Likes hängen per
  // FK-Cascade am Rezept; der FTS-Trigger räumt den Suchindex auf.
  await db.delete(schema.recipe).where(eq(schema.recipe.id, id));
}
