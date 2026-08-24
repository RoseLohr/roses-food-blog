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
import { getTableName } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db, schema } from "@/db";

/** Eine Fundstelle: der Bereich, in dem das Foto steckt, und wie oft. */
export interface Bildverwendung {
  bereich: string;
  anzahl: number;
}

/** Ein Eintrag der Tabelle unten: lesbarer Name, Tabelle, Fremdschlüsselspalte. */
type Quelle = readonly [bereich: string, tabelle: SQLiteTable, spalte: SQLiteColumn];

/**
 * Jede Spalte, die auf `media_image` zeigt — mit dem Namen, den ein Mensch
 * lesen kann.
 *
 * Bewusst eine Tabelle aus Tupeln und keine zwölf ausgeschriebenen Abfragen:
 * Die Abfrage ist bei allen dieselbe (`SELECT <spalte> FROM <tabelle>`), nur
 * Tabelle und Spalte wechseln. Ausgeschrieben war der eigentliche Inhalt —
 * welche Spalte zählt — zwischen immer gleichem Beiwerk versteckt, und eine
 * neue Zeile hieß acht Zeilen abschreiben.
 *
 * Kommt eine Spalte hinzu, gehört sie hierher: Was hier fehlt, gilt als
 * unbenutzt — und wird beim Aufräumen gelöscht bzw. beim Löschen nicht
 * gemeldet. Der Selbsttest in tests/bild-ohne-foto.integration.test.ts hält
 * die Liste Paar für Paar gegen die Fremdschlüssel des Schemas.
 *
 * Die beiden Fotoplätze eines Restaurants stehen BEWUSST als zwei Einträge da,
 * nicht als einer mit zwei Spalten: Nur so fällt auf, wenn eine Spalte
 * dazukommt und hier vergessen wird — und der Redakteur erfährt, WELCHES der
 * beiden Fotos dem Löschen im Weg steht, statt nur „Restaurant".
 */
const QUELLEN = [
  ["Rezept (Titelbild)", schema.recipe, schema.recipe.heroImageId],
  ["Rezept (Zubereitungsschritt)", schema.recipeStep, schema.recipeStep.imageId],
  ["Zutat", schema.ingredient, schema.ingredient.imageId],
  ["Seite (Titelbild)", schema.page, schema.page.heroImageId],
  ["Reisebericht (Titelbild)", schema.travelPost, schema.travelPost.heroImageId],
  ["Reisebericht (Bild im Text)", schema.travelBlock, schema.travelBlock.imageId],
  ["Restaurant (erstes Foto)", schema.restaurant, schema.restaurant.imageId],
  ["Restaurant (zweites Foto)", schema.restaurant, schema.restaurant.imageId2],
  ["Gericht", schema.dishImage, schema.dishImage.imageId],
  [
    "Startseite (Über mich)",
    schema.homepageConfig,
    schema.homepageConfig.aboutTeaserImageId,
  ],
  ["Startseite (Slider)", schema.sliderItem, schema.sliderItem.imageId],
] as const satisfies readonly Quelle[];

/** Alle Werte einer Fremdschlüsselspalte — NULL eingeschlossen. */
async function idsAus([, tabelle, spalte]: Quelle): Promise<(number | null)[]> {
  const zeilen = await db.select({ id: spalte }).from(tabelle);
  return zeilen.map((z) => z.id as number | null);
}

/** Die Bereiche, in denen dieses Foto steckt — leer heißt: nirgends. */
export async function verwendungenVonBild(
  imageId: number,
): Promise<Bildverwendung[]> {
  const out: Bildverwendung[] = [];
  for (const q of QUELLEN) {
    const anzahl = (await idsAus(q)).filter((id) => id === imageId).length;
    if (anzahl > 0) out.push({ bereich: q[0], anzahl });
  }
  return out;
}

/** Alle Foto-IDs, die irgendwo benutzt werden (fürs Aufräumen von Waisen). */
export async function referenzierteBildIds(): Promise<Set<number>> {
  const s = new Set<number>();
  for (const q of QUELLEN) {
    for (const id of await idsAus(q)) if (id != null) s.add(id);
  }
  return s;
}

/** Nur für den Selbsttest: die Namen der Fundstellen. */
export const VERWENDUNGS_BEREICHE = QUELLEN.map(([bereich]) => bereich);

/**
 * Nur für den Selbsttest: `tabelle.spalte` je Fundstelle, wie SQLite sie
 * schreibt. Damit prüft der Test nicht mehr bloß die ANZAHL der Einträge gegen
 * die Anzahl der Fremdschlüssel, sondern jedes Paar einzeln — zwei Fehler, die
 * sich in der Zählung aufheben (eine Spalte vergessen, eine doppelt), fallen
 * jetzt auf.
 */
export const VERWENDUNGS_SPALTEN = QUELLEN.map(
  ([, tabelle, spalte]) => `${getTableName(tabelle)}.${spalte.name}`,
);
