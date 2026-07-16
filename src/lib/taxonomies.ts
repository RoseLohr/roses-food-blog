/**
 * Zentrale Helper-Schicht für die vereinheitlichte taxonomy-Tabelle.
 *
 * WICHTIG: Der Fremdschlüssel kann die ART einer Zuordnung nicht erzwingen
 * (ein Gericht könnte technisch ein „geraet" bekommen). Deshalb laufen ALLE
 * Taxonomie-Zugriffe über diese Funktionen — sie filtern konsequent nach
 * type und validieren beim Zuordnen. Direkte Queries auf schema.taxonomy
 * außerhalb dieser Datei bitte vermeiden.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { TAXONOMY_TYPES, type TaxonomyType } from "@/db/schema";
import { slugify, uniqueSlug } from "@/lib/slug";

export { TAXONOMY_TYPES };
export type { TaxonomyType };

/** Arten, die an Reise-Gerichten erlaubt sind (kein „geraet"). */
export const DISH_TAXONOMY_TYPES: readonly TaxonomyType[] = [
  "kategorie",
  "schlagwort",
  "ernaehrungsform",
  "kueche",
];

export function isTaxonomyType(v: string): v is TaxonomyType {
  return (TAXONOMY_TYPES as readonly string[]).includes(v);
}

export interface TaxonomyRow {
  id: number;
  type: TaxonomyType;
  name: string;
  slug: string;
}

/** Alle Einträge einer Art, alphabetisch. */
export async function taxonomiesOfType(
  type: TaxonomyType,
): Promise<TaxonomyRow[]> {
  return db
    .select()
    .from(schema.taxonomy)
    .where(eq(schema.taxonomy.type, type))
    .orderBy(asc(schema.taxonomy.name));
}

/** Alle Einträge aller Arten, gruppiert — für Editor-Formulare. */
export async function taxonomiesByType(): Promise<
  Record<TaxonomyType, TaxonomyRow[]>
> {
  const rows = await db
    .select()
    .from(schema.taxonomy)
    .orderBy(asc(schema.taxonomy.name));
  const grouped = Object.fromEntries(
    TAXONOMY_TYPES.map((t) => [t, [] as TaxonomyRow[]]),
  ) as Record<TaxonomyType, TaxonomyRow[]>;
  for (const row of rows) grouped[row.type].push(row);
  return grouped;
}

/** Eintrag per Art + Slug (z. B. Kategorie-Seite). */
export async function taxonomyBySlug(
  type: TaxonomyType,
  slug: string,
): Promise<TaxonomyRow | null> {
  const [row] = await db
    .select()
    .from(schema.taxonomy)
    .where(and(eq(schema.taxonomy.type, type), eq(schema.taxonomy.slug, slug)))
    .limit(1);
  return row ?? null;
}

/**
 * IDs auf die erwartete Art einschränken — Validierung vor jedem Zuordnen
 * (die DB kann die Art nicht erzwingen). Liefert nur existierende IDs der
 * gewünschten Art(en) zurück; alles andere wird still verworfen.
 */
export async function filterIdsByType(
  ids: number[],
  types: readonly TaxonomyType[],
): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: schema.taxonomy.id, type: schema.taxonomy.type })
    .from(schema.taxonomy)
    .where(inArray(schema.taxonomy.id, [...new Set(ids)]));
  const allowed = new Set<string>(types);
  return rows.filter((r) => allowed.has(r.type)).map((r) => r.id);
}

/**
 * Eintrag per Name finden oder anlegen (case-insensitiv; die DB sichert das
 * zusätzlich per UNIQUE COLLATE NOCASE ab). Race-fest durch Conflict-Retry.
 */
export async function findOrCreateTaxonomy(
  type: TaxonomyType,
  name: string,
): Promise<TaxonomyRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name darf nicht leer sein.");

  const findExisting = async () => {
    const rows = await db
      .select()
      .from(schema.taxonomy)
      .where(eq(schema.taxonomy.type, type));
    return (
      rows.find((r) => r.name.toLowerCase() === trimmed.toLowerCase()) ?? null
    );
  };

  const existing = await findExisting();
  if (existing) return existing;

  const takenSlugs = new Set(
    (
      await db
        .select({ slug: schema.taxonomy.slug })
        .from(schema.taxonomy)
        .where(eq(schema.taxonomy.type, type))
    ).map((r) => r.slug),
  );
  try {
    const [row] = await db
      .insert(schema.taxonomy)
      .values({
        type,
        name: trimmed,
        slug: uniqueSlug(slugify(trimmed), (s) => takenSlugs.has(s)),
      })
      .returning();
    return row;
  } catch {
    // Paralleler Insert (NOCASE-Unique) — der Gewinner wird übernommen.
    const winner = await findExisting();
    if (winner) return winner;
    throw new Error("Taxonomie konnte nicht angelegt werden.");
  }
}

// ---------------------------------------------------------------------------
// Zuordnungen lesen (nach Art gruppiert) — für Rezept-/Gericht-Ansichten
// ---------------------------------------------------------------------------
export interface TaxonomyRef {
  id: number;
  name: string;
  slug: string;
}

export type GroupedTaxonomies = Record<TaxonomyType, TaxonomyRef[]>;

function emptyGroups(): GroupedTaxonomies {
  return Object.fromEntries(
    TAXONOMY_TYPES.map((t) => [t, [] as TaxonomyRef[]]),
  ) as GroupedTaxonomies;
}

/** Zuordnungen mehrerer Rezepte in EINER Abfrage, gruppiert nach Art. */
export async function recipeTaxonomiesByRecipe(
  recipeIds: number[],
): Promise<Map<number, GroupedTaxonomies>> {
  const map = new Map<number, GroupedTaxonomies>();
  if (recipeIds.length === 0) return map;
  const rows = await db
    .select({
      recipeId: schema.recipeTaxonomy.recipeId,
      id: schema.taxonomy.id,
      type: schema.taxonomy.type,
      name: schema.taxonomy.name,
      slug: schema.taxonomy.slug,
    })
    .from(schema.recipeTaxonomy)
    .innerJoin(
      schema.taxonomy,
      eq(schema.recipeTaxonomy.taxonomyId, schema.taxonomy.id),
    )
    .where(inArray(schema.recipeTaxonomy.recipeId, recipeIds))
    .orderBy(asc(schema.taxonomy.name));
  for (const r of rows) {
    let groups = map.get(r.recipeId);
    if (!groups) {
      groups = emptyGroups();
      map.set(r.recipeId, groups);
    }
    groups[r.type].push({ id: r.id, name: r.name, slug: r.slug });
  }
  return map;
}

/** Zuordnungen mehrerer Gerichte in EINER Abfrage, gruppiert nach Art. */
export async function dishTaxonomiesByDish(
  dishIds: number[],
): Promise<Map<number, GroupedTaxonomies>> {
  const map = new Map<number, GroupedTaxonomies>();
  if (dishIds.length === 0) return map;
  const rows = await db
    .select({
      dishId: schema.dishTaxonomy.dishId,
      id: schema.taxonomy.id,
      type: schema.taxonomy.type,
      name: schema.taxonomy.name,
      slug: schema.taxonomy.slug,
    })
    .from(schema.dishTaxonomy)
    .innerJoin(
      schema.taxonomy,
      eq(schema.dishTaxonomy.taxonomyId, schema.taxonomy.id),
    )
    .where(inArray(schema.dishTaxonomy.dishId, dishIds))
    .orderBy(asc(schema.taxonomy.name));
  for (const r of rows) {
    let groups = map.get(r.dishId);
    if (!groups) {
      groups = emptyGroups();
      map.set(r.dishId, groups);
    }
    groups[r.type].push({ id: r.id, name: r.name, slug: r.slug });
  }
  return map;
}
