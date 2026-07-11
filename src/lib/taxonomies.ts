/**
 * Zentrale Registry der fünf Taxonomien — genutzt von Admin-CRUD,
 * Rezept-Editor und den öffentlichen Filtern.
 */
import { schema } from "@/db";

export const TAXONOMY_TYPES = [
  "kategorie",
  "schlagwort",
  "ernaehrungsform",
  "kueche",
  "geraet",
] as const;

export type TaxonomyType = (typeof TAXONOMY_TYPES)[number];

export const TAXONOMY_TABLES: Record<TaxonomyType, typeof schema.category> = {
  kategorie: schema.category,
  schlagwort: schema.tag,
  ernaehrungsform: schema.dietType,
  kueche: schema.cuisine,
  geraet: schema.equipment,
};

export function isTaxonomyType(v: string): v is TaxonomyType {
  return (TAXONOMY_TYPES as readonly string[]).includes(v);
}
