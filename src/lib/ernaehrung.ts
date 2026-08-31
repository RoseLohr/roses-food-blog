/**
 * Die Übersicht der Ernährungsformen — eine gepflegte Seite mit einer Liste
 * darunter.
 *
 * ── DIE EINE STELLE, DIE DEN SLUG KENNT ─────────────────────────────────────
 *
 * `/ernaehrungsformen` ist eine GESCHÜTZTE CMS-Seite (`page.is_protected`),
 * wie „Über mich" und „Impressum": Titel, Text und Titelbild pflegt der Admin
 * unter Seiten, aber Slug und Löschen sind gesperrt. Das ist der Grund, warum
 * das Menü sich auf sie verlassen darf — bei einer frei angelegten Seite
 * verschwände der Eintrag stillschweigend, sobald jemand den Slug ändert.
 *
 * Der Slug steht deshalb GENAU HIER. Er wird an fünf Stellen gebraucht
 * (Route, Menü, Seed, Migration, Tests); als fünfmal getippte Zeichenkette
 * wäre er eine Verabredung, an die sich niemand erinnert.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { mediaImageWithWidths } from "@/lib/media";
import {
  taxonomienMitRezepten,
  type TaxonomieMitAnzahl,
} from "@/lib/taxonomies";

/** Der Slug der geschützten Übersichtsseite. */
export const ERNAEHRUNGSFORMEN_SLUG = "ernaehrungsformen";
/** Ihre öffentliche Adresse. */
export const ERNAEHRUNGSFORMEN_PFAD = `/${ERNAEHRUNGSFORMEN_SLUG}`;

/** Die Adresse EINER Ernährungsform. */
export function ernaehrungsformPfad(slug: string): string {
  return `/rezepte/ernaehrung/${encodeURIComponent(slug)}`;
}

/**
 * Die Ernährungsformen, die im Menü und auf der Übersicht erscheinen.
 *
 * Nur solche mit mindestens einem veröffentlichten Rezept — eine leere
 * Übersichtsseite gehört weder ins Menü noch in die Sitemap. Diese Bedingung
 * steht in `taxonomienMitRezepten`, gemeinsam mit den Kategorien.
 */
export async function ernaehrungsformen(): Promise<TaxonomieMitAnzahl[]> {
  return taxonomienMitRezepten("ernaehrungsform");
}

/**
 * Die gepflegte Seite hinter der Übersicht — oder `null`, wenn es sie (noch)
 * nicht gibt bzw. sie ein Entwurf ist.
 *
 * Die Sichtbarkeitsfrage bekommt der Aufrufer als Parameter herein, damit sie
 * dort steht, wo sie beantwortet wird (`src/lib/entwurfsansicht.ts`) — und
 * nicht hier ein zweites Mal.
 */
export async function ernaehrungsformenSeite() {
  const [seite] = await db
    .select()
    .from(schema.page)
    .where(eq(schema.page.slug, ERNAEHRUNGSFORMEN_SLUG));
  if (!seite) return null;
  const titelbild = await mediaImageWithWidths(seite.heroImageId);
  return { seite, titelbild };
}
