/**
 * Wo wird ein Foto benutzt?
 *
 * DER BEFUND (nachgestellt): „Löschen" in der Mediathek löschte ohne jede
 * Rückfrage. `travel_block.image_id` hat `ON DELETE SET NULL` — der Bildblock
 * blieb also als leere Hülle stehen, wurde beim Lesen still übersprungen, und
 * die Zeilenzugehörigkeit der NACHBARN blieb unverändert. Damit zerfiel eine
 * Bildzeile: zwei Bilder nebeneinander, das dritte darunter — ohne dass jemand
 * den Editor angefasst hätte und ohne dass auf der Seite etwas davon zu sehen
 * wäre. Beim nächsten Öffnen des Editors sah es aus, als sei das Häkchen eben
 * nie gesetzt worden.
 *
 * Die Liste der Fundstellen gab es dabei schon: `data-transfer/delete.ts`
 * zählte `travel_block.image_id` längst als Referenz, um verwaiste Fotos zu
 * erkennen. Sie stand nur an der falschen Stelle, um vor dem Löschen zu warnen.
 * Deshalb steht sie jetzt HIER — einmal, und beide Seiten fragen sie.
 */
import { db, schema } from "@/db";

/** Eine Fundstelle: der Bereich, in dem das Foto steckt, und wie oft. */
export interface Bildverwendung {
  bereich: string;
  anzahl: number;
}

/**
 * Jede Spalte, die auf `media_image` zeigt — mit dem Namen, den ein Mensch
 * lesen kann.
 *
 * Kommt eine Spalte hinzu, gehört sie hierher: Was hier fehlt, gilt als
 * unbenutzt — und wird beim Aufräumen gelöscht bzw. beim Löschen nicht
 * gemeldet. Der Selbsttest in tests/media-verwendung.integration.test.ts hält
 * die Liste gegen das Schema.
 */
const QUELLEN: Array<{ bereich: string; ids: () => Promise<(number | null)[]> }> = [
  {
    bereich: "Rezept (Titelbild)",
    ids: async () =>
      (await db.select({ id: schema.recipe.heroImageId }).from(schema.recipe)).map(
        (r) => r.id,
      ),
  },
  {
    bereich: "Rezept (Zubereitungsschritt)",
    ids: async () =>
      (
        await db.select({ id: schema.recipeStep.imageId }).from(schema.recipeStep)
      ).map((r) => r.id),
  },
  {
    bereich: "Zutat",
    ids: async () =>
      (
        await db.select({ id: schema.ingredient.imageId }).from(schema.ingredient)
      ).map((r) => r.id),
  },
  {
    bereich: "Seite (Titelbild)",
    ids: async () =>
      (await db.select({ id: schema.page.heroImageId }).from(schema.page)).map(
        (r) => r.id,
      ),
  },
  {
    bereich: "Reisebericht (Titelbild)",
    ids: async () =>
      (
        await db.select({ id: schema.travelPost.heroImageId }).from(schema.travelPost)
      ).map((r) => r.id),
  },
  {
    bereich: "Reisebericht (Galerie)",
    ids: async () =>
      (
        await db
          .select({ id: schema.travelPostImage.imageId })
          .from(schema.travelPostImage)
      ).map((r) => r.id),
  },
  {
    bereich: "Reisebericht (Bild im Text)",
    ids: async () =>
      (
        await db.select({ id: schema.travelBlock.imageId }).from(schema.travelBlock)
      ).map((r) => r.id),
  },
  // Die beiden Fotoplätze eines Restaurants stehen BEWUSST als zwei Einträge
  // da, nicht als einer mit zwei Spalten. Die Fangregel in
  // tests/bild-ohne-foto.integration.test.ts zählt Einträge gegen
  // Fremdschlüsselspalten: Nur so fällt auf, wenn eine Spalte dazukommt und
  // hier vergessen wird — und der Redakteur erfährt, WELCHES der beiden Fotos
  // dem Löschen im Weg steht, statt nur „Restaurant".
  {
    bereich: "Restaurant (erstes Foto)",
    ids: async () =>
      (
        await db.select({ id: schema.restaurant.imageId }).from(schema.restaurant)
      ).map((r) => r.id),
  },
  {
    bereich: "Restaurant (zweites Foto)",
    ids: async () =>
      (
        await db
          .select({ id: schema.restaurant.imageId2 })
          .from(schema.restaurant)
      ).map((r) => r.id),
  },
  {
    bereich: "Gericht",
    ids: async () =>
      (await db.select({ id: schema.dishImage.imageId }).from(schema.dishImage)).map(
        (r) => r.id,
      ),
  },
  {
    bereich: "Startseite (Über mich)",
    ids: async () =>
      (
        await db
          .select({ id: schema.homepageConfig.aboutTeaserImageId })
          .from(schema.homepageConfig)
      ).map((r) => r.id),
  },
  {
    bereich: "Startseite (Slider)",
    ids: async () =>
      (
        await db.select({ id: schema.sliderItem.imageId }).from(schema.sliderItem)
      ).map((r) => r.id),
  },
];

/** Die Bereiche, in denen dieses Foto steckt — leer heißt: nirgends. */
export async function verwendungenVonBild(
  imageId: number,
): Promise<Bildverwendung[]> {
  const out: Bildverwendung[] = [];
  for (const q of QUELLEN) {
    const anzahl = (await q.ids()).filter((id) => id === imageId).length;
    if (anzahl > 0) out.push({ bereich: q.bereich, anzahl });
  }
  return out;
}

/** Alle Foto-IDs, die irgendwo benutzt werden (fürs Aufräumen von Waisen). */
export async function referenzierteBildIds(): Promise<Set<number>> {
  const s = new Set<number>();
  for (const q of QUELLEN) {
    for (const id of await q.ids()) if (id != null) s.add(id);
  }
  return s;
}

/** Nur für den Selbsttest: die Namen der Fundstellen. */
export const VERWENDUNGS_BEREICHE = QUELLEN.map((q) => q.bereich);
