/** Editor-Daten für Reiseberichte laden. */
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { thumbUrl, variantWidthsByImage } from "@/lib/media";
import { taxonomiesByType } from "@/lib/taxonomies";
import { getFullTravelPost } from "@/lib/travel";
import type { TravelEditorProps } from "./travel-editor";

export async function buildTravelEditorProps(
  travelId: number | null,
): Promise<TravelEditorProps | null> {
  const imageRows = await db
    .select({
      id: schema.mediaImage.id,
      originalName: schema.mediaImage.originalName,
      altText: schema.mediaImage.altText,
      fileKey: schema.mediaImage.fileKey,
    })
    .from(schema.mediaImage)
    .orderBy(asc(schema.mediaImage.originalName));
  const widthsById = await variantWidthsByImage(imageRows.map((i) => i.id));
  const images = imageRows.map((i) => ({
    id: i.id,
    label: i.altText || i.originalName,
    thumbUrl: thumbUrl(i.fileKey, widthsById.get(i.id) ?? []),
  }));

  // Taxonomie-Optionen für die Gericht-Zuordnung (gemeinsamer Stamm mit
  // Rezepten; „geraet" ist an Gerichten nicht vorgesehen).
  const grouped = await taxonomiesByType();
  const taxonomies = {
    categories: grouped.kategorie,
    tags: grouped.schlagwort,
    dietTypes: grouped.ernaehrungsform,
    cuisines: grouped.kueche,
  };

  const base: TravelEditorProps = {
    initial: {
      id: null,
      title: "",
      slug: "",
      teaser: "",
      blocks: [],
      country: "",
      region: "",
      city: "",
      travelYear: null,
      heroImageId: null,
      imageIds: [],
      seoTitle: "",
      seoDescription: "",
      status: "entwurf",
      restaurants: [],
    },
    taxonomies,
    images,
  };

  if (travelId === null) return base;

  const full = await getFullTravelPost({ id: travelId });
  if (!full) return null;

  return {
    ...base,
    initial: {
      id: full.post.id,
      title: full.post.title,
      slug: full.post.slug,
      teaser: full.post.teaser,
      blocks: full.blocks,
      country: full.post.country,
      region: full.post.region,
      city: full.post.city,
      travelYear: full.post.travelYear,
      heroImageId: full.post.heroImageId,
      imageIds: full.images.map((i) => i.id),
      seoTitle: full.post.seoTitle,
      seoDescription: full.post.seoDescription,
      status: full.post.status,
      restaurants: full.restaurants.map((r) => ({
        name: r.name,
        city: r.city,
        description: r.description,
        imageId: r.imageId ?? null,
        lat: r.lat != null ? String(r.lat).replace(".", ",") : "",
        lng: r.lng != null ? String(r.lng).replace(".", ",") : "",
        dishes: r.dishes.map((d) => ({
          name: d.name,
          description: d.description,
          imageIds: d.images.map((i) => i.id),
          ingredientsText: d.ingredients.map((i) => i.name).join(", "),
          categoryIds: d.categories.map((x) => x.id),
          tagIds: d.tags.map((x) => x.id),
          dietTypeIds: d.dietTypes.map((x) => x.id),
          cuisineIds: d.cuisines.map((x) => x.id),
        })),
      })),
    },
  };
}
