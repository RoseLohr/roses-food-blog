/** Editor-Daten für Reiseberichte laden. */
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { getFullTravelPost } from "@/lib/travel";
import type { TravelEditorProps } from "./travel-editor";

export async function buildTravelEditorProps(
  travelId: number | null,
): Promise<TravelEditorProps | null> {
  const images = await db
    .select({
      id: schema.mediaImage.id,
      originalName: schema.mediaImage.originalName,
      altText: schema.mediaImage.altText,
    })
    .from(schema.mediaImage)
    .orderBy(asc(schema.mediaImage.originalName));

  const base: TravelEditorProps = {
    initial: {
      id: null,
      title: "",
      slug: "",
      teaser: "",
      content: "",
      country: "",
      destination: "",
      heroImageId: null,
      imageIds: [],
      seoTitle: "",
      seoDescription: "",
      status: "entwurf",
      restaurants: [],
    },
    images: images.map((i) => ({ id: i.id, label: i.altText || i.originalName })),
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
      content: full.post.content,
      country: full.post.country,
      destination: full.post.destination,
      heroImageId: full.post.heroImageId,
      imageIds: full.images.map((i) => i.id),
      seoTitle: full.post.seoTitle,
      seoDescription: full.post.seoDescription,
      status: full.post.status,
      restaurants: full.restaurants.map((r) => ({
        name: r.name,
        city: r.city,
        description: r.description,
        dishes: r.dishes.map((d) => ({
          name: d.name,
          description: d.description,
          imageIds: d.images.map((i) => i.id),
          ingredientsText: d.ingredients.map((i) => i.name).join(", "),
        })),
      })),
    },
  };
}
