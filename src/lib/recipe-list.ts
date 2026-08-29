/**
 * Kartendaten für Rezept-Übersichten (Rezeptliste, Startseite,
 * Suchergebnisse).
 *
 * HIESS BIS 08/2026 `publishedRecipeCards` — und musste umbenannt werden, als
 * die Auswahl vom Betrachter abhängig wurde: Ein Name, der „published"
 * verspricht, darf nicht manchmal Entwürfe liefern. Wer `sichtbarkeit` sieht,
 * weiß, dass er sich entscheiden muss.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { variantWidthsByImage } from "@/lib/media";
import { statusBedingung, VEROEFFENTLICHT, type Sichtbarkeit } from "@/lib/entwurfsansicht";
import type { RecipeCardData } from "@/components/recipe-card";

export async function rezeptkarten(options: {
  /** Pflicht — siehe src/lib/entwurfsansicht.ts, warum es keine Vorgabe gibt. */
  sichtbarkeit: Sichtbarkeit;
  limit?: number;
  orderByLikes?: boolean;
  ids?: number[];
}): Promise<RecipeCardData[]> {
  if (options.ids && options.ids.length === 0) return [];

  const conditions = [statusBedingung(schema.recipe.status, options.sichtbarkeit)];
  if (options.ids) conditions.push(inArray(schema.recipe.id, options.ids));

  let query = db
    .select({
      id: schema.recipe.id,
      slug: schema.recipe.slug,
      title: schema.recipe.title,
      teaser: schema.recipe.teaser,
      status: schema.recipe.status,
      totalMinutes: schema.recipe.totalMinutes,
      likeCount: schema.recipe.likeCount,
      imageId: schema.mediaImage.id,
      fileKey: schema.mediaImage.fileKey,
      altText: schema.mediaImage.altText,
      width: schema.mediaImage.width,
      focusX: schema.mediaImage.focusX,
      focusY: schema.mediaImage.focusY,
      height: schema.mediaImage.height,
    })
    .from(schema.recipe)
    .leftJoin(schema.mediaImage, eq(schema.recipe.heroImageId, schema.mediaImage.id))
    .where(and(...conditions))
    // Zweitschlüssel `id`: Beide Hauptkriterien wiederholen sich reichlich —
    // `like_count` steht im Saatzustand überall auf 0, und `published_at`
    // bekommt von der Saat EINEN gemeinsamen Zeitstempel. SQLite gibt bei
    // Gleichstand keine definierte Reihenfolge zurück; mit `limit` entschied
    // das sogar, WELCHE Rezepte überhaupt erscheinen.
    .orderBy(
      // ENTWÜRFE ZUERST — und zwar nur dann, wenn es überhaupt welche geben
      // kann. Für „nur-veroeffentlicht" entsteht dieser Schlüssel GAR NICHT:
      // Die Abfrage des anonymen Besuchers ist damit Zeichen für Zeichen die
      // alte, und die Zusage „für ihn ändert sich nichts" ist strukturell
      // wahr statt argumentiert.
      //
      // Der erste Anlauf hängte den Ausdruck unbedingt an und begründete das
      // damit, dass er bei lauter veröffentlichten Zeilen denselben Wert
      // liefert. Das stimmt fürs ERGEBNIS, nicht für den Weg dorthin: Ein
      // führender Ausdruck ist für den Abfrageplaner nicht als konstant
      // erkennbar, die Index-Ordnung fällt weg und SQLite legt einen
      // temporären Sortierbaum an (nachgemessen mit EXPLAIN QUERY PLAN:
      // `USE TEMP B-TREE FOR ORDER BY`, wo vorher nichts stand). Auf der
      // Startseite kostet das am meisten — `limit: 6` konnte vorher nach
      // sechs Index-Einträgen abbrechen und muss jetzt alles materialisieren.
      //
      // Nötig ist der Schlüssel, weil ein Entwurf `published_at = NULL` trägt
      // (siehe recipe-save.ts) und SQLite NULL bei DESC ans ENDE sortiert. Ein Entwurf
      // landete damit hinter allem — und auf der gedeckelten Startseite gar
      // nicht erst im Bild.
      ...(options.sichtbarkeit === "auch-entwuerfe"
        ? [asc(sql`${schema.recipe.status} = ${VEROEFFENTLICHT}`)]
        : []),
      options.orderByLikes
        ? desc(schema.recipe.likeCount)
        : desc(schema.recipe.publishedAt),
      desc(schema.recipe.id),
    )
    .$dynamic();

  if (options.limit) query = query.limit(options.limit);

  const rows = await query;
  const ids = rows.map((r) => r.id);

  // Primär-Kategorie (is_primary; Fallback: erste) UND erste Ernährungsform je
  // Rezept für das Kachel-Label „Kategorie / Ernährungsform" — in EINER Abfrage.
  const catByRecipe = new Map<number, string>();
  const dietByRecipe = new Map<number, string>();
  if (ids.length > 0) {
    const cats = await db
      .select({
        recipeId: schema.recipeTaxonomy.recipeId,
        name: schema.taxonomy.name,
        type: schema.taxonomy.type,
        isPrimary: schema.recipeTaxonomy.isPrimary,
      })
      .from(schema.recipeTaxonomy)
      .innerJoin(
        schema.taxonomy,
        eq(schema.recipeTaxonomy.taxonomyId, schema.taxonomy.id),
      )
      .where(
        and(
          inArray(schema.recipeTaxonomy.recipeId, ids),
          inArray(schema.taxonomy.type, ["kategorie", "ernaehrungsform"]),
        ),
      )
      // Primär zuerst, dann alphabetisch → deterministische Auswahl je Rezept.
      .orderBy(desc(schema.recipeTaxonomy.isPrimary), asc(schema.taxonomy.name));
    for (const c of cats) {
      if (c.type === "kategorie") {
        if (!catByRecipe.has(c.recipeId)) catByRecipe.set(c.recipeId, c.name);
      } else if (!dietByRecipe.has(c.recipeId)) {
        dietByRecipe.set(c.recipeId, c.name);
      }
    }
  }

  const widthsById = await variantWidthsByImage(
    rows.flatMap((r) => (r.imageId ? [r.imageId] : [])),
  );

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    teaser: r.teaser,
    totalMinutes: r.totalMinutes,
    likeCount: r.likeCount,
    // Die Kachel bekommt kein Statuswort, sondern die eine Tatsache, die sie
    // anzeigen soll. Was „veroeffentlicht" heißt, geht sie nichts an.
    entwurf: r.status !== VEROEFFENTLICHT,
    category: catByRecipe.get(r.id) ?? null,
    dietType: dietByRecipe.get(r.id) ?? null,
    image: r.imageId
      ? {
          fileKey: r.fileKey!,
          altText: r.altText ?? "",
          width: r.width!,
          focusX: r.focusX,
          focusY: r.focusY,
          height: r.height!,
          variantWidths: widthsById.get(r.imageId) ?? [],
        }
      : null,
  }));
}
