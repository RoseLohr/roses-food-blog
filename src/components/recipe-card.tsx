/**
 * Rezept-Kachel für Übersichten (Startseite, Rezeptliste, Suche).
 */
import Link from "next/link";
import { ResponsiveImg, type MediaImageLike } from "./responsive-img";
import { t } from "@/i18n/de";

const dict = t();

export interface RecipeCardData {
  slug: string;
  title: string;
  teaser: string;
  totalMinutes: number;
  likeCount: number;
  image: MediaImageLike | null;
}

export function RecipeCard({ recipe }: { recipe: RecipeCardData }) {
  return (
    <article className="group overflow-hidden rounded-2xl bg-white shadow-sm transition-shadow hover:shadow-md">
      <Link href={`/rezepte/${recipe.slug}`} className="block">
        {recipe.image ? (
          <ResponsiveImg
            image={recipe.image}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 384px"
            className="aspect-[3/2] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div aria-hidden className="aspect-[3/2] w-full bg-cream" />
        )}
        <div className="p-4">
          <h3 className="font-display text-lg font-bold group-hover:text-rose-primary">
            {recipe.title}
          </h3>
          {recipe.teaser && (
            <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
              {recipe.teaser}
            </p>
          )}
          <p className="mt-2 text-xs text-ink-soft">
            {recipe.totalMinutes} {dict.recipe.minutes} · ♥ {recipe.likeCount}{" "}
            {dict.recipeList.likesSuffix}
          </p>
        </div>
      </Link>
    </article>
  );
}
