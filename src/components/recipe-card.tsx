/**
 * Rezept-Kachel für Übersichten (Startseite, Rezeptliste, Suche).
 */
import Link from "next/link";
import { ResponsiveImg, type MediaImageLike } from "./responsive-img";
import { CompactLike } from "./compact-like";
import { IconClock } from "./icons";
import { t } from "@/i18n/de";

const dict = t();

export interface RecipeCardData {
  id: number;
  slug: string;
  title: string;
  teaser: string;
  totalMinutes: number;
  likeCount: number;
  category?: string | null;
  /** Ernährungsform (wird hinter der Kategorie mit „/“ getrennt gezeigt). */
  dietType?: string | null;
  image: MediaImageLike | null;
}

export function RecipeCard({ recipe }: { recipe: RecipeCardData }) {
  return (
    // relative: der über die ganze Kachel gespannte Link (z-0) macht sie
    // klickbar; der Like-Button liegt darüber (z-10) und bleibt eigenständig.
    <article className="group relative overflow-hidden bg-white shadow-sm transition-shadow hover:shadow-md">
      <Link
        href={`/rezepte/${recipe.slug}`}
        aria-label={recipe.title}
        className="absolute inset-0 z-0"
      />
      {recipe.image ? (
        <ResponsiveImg
          image={recipe.image}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 384px"
          className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div aria-hidden className="aspect-[4/3] w-full bg-cream" />
      )}
      {/* Innerer Abstand: auf schmalen (2-spaltigen) Kacheln links/rechts knapper
          (px-3), damit mehr Platz für Titel/Text bleibt; ab sm wieder p-5. */}
      <div className="px-3 py-4 sm:p-5">
        {(recipe.category || recipe.dietType) && (
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-leaf">
            {/* Kategorie und – falls vorhanden – Ernährungsform, „/“-getrennt. */}
            {[recipe.category, recipe.dietType].filter(Boolean).join(" · ")}
          </p>
        )}
        {/* break-words + hyphens-auto: lange Wörter (z. B. „Schmorgemüse")
            brechen um statt über die Kachelkante zu laufen (html lang=de). */}
        <h3 className="font-display text-lg font-bold hyphens-auto break-words group-hover:text-leaf">
          {recipe.title}
        </h3>
        {recipe.teaser && (
          <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-ink-soft md:line-clamp-2">
            {recipe.teaser}
          </p>
        )}
        <p className="mt-3 flex items-center gap-4 text-xs text-ink-soft">
          <span className="flex items-center gap-1.5">
            <IconClock className="h-3.5 w-3.5" />
            {recipe.totalMinutes} {dict.recipe.minutes}
          </span>
          <CompactLike
            recipeId={recipe.id}
            initialCount={recipe.likeCount}
            className="relative z-10 hover:text-rose-primary"
          />
        </p>
      </div>
    </article>
  );
}
