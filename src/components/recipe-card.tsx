/**
 * Rezept-Kachel für Übersichten (Startseite, Rezeptliste, Suche).
 */
import Link from "next/link";
import { ResponsiveImg, type MediaImageLike } from "./responsive-img";
import { IconClock, IconHeart } from "./icons";
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
    <article className="group overflow-hidden bg-white shadow-sm transition-shadow hover:shadow-md">
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
        <div className="p-5">
          <h3 className="font-display text-lg font-bold tracking-tight group-hover:text-rose-primary">
            {recipe.title}
          </h3>
          {recipe.teaser && (
            <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-soft">
              {recipe.teaser}
            </p>
          )}
          <p className="mt-3 flex items-center gap-4 text-xs text-ink-soft">
            <span className="flex items-center gap-1.5">
              <IconClock className="h-3.5 w-3.5" />
              {recipe.totalMinutes} {dict.recipe.minutes}
            </span>
            <span className="flex items-center gap-1.5">
              <IconHeart className="h-3.5 w-3.5" />
              {recipe.likeCount} {dict.recipeList.likesSuffix}
            </span>
          </p>
        </div>
      </Link>
    </article>
  );
}
