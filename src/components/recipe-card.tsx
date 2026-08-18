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

/**
 * Standard-`sizes` für die volle 6xl-Breite mit 3-spaltigem Raster (Listen-
 * seiten /rezepte, /suche): je Kachel ~360 px ab lg, 50vw bei 2 Spalten,
 * 100vw mobil. Kontexte mit Seitenleiste (Startseite: nur ~256 px je Kachel)
 * übergeben ein engeres `imageSizes`, damit der Browser nicht unnötig w640
 * statt w320 lädt (Lighthouse „Bildübermittlung verbessern").
 */
const DEFAULT_CARD_SIZES =
  "(max-width: 640px) calc(100vw - 2rem), (max-width: 1024px) 50vw, 360px";

export function RecipeCard({
  recipe,
  imageSizes = DEFAULT_CARD_SIZES,
  layout = "kachel",
}: {
  recipe: RecipeCardData;
  /** Überschreibt `sizes` je Layout-Kontext (Spaltenbreite). */
  imageSizes?: string;
  /**
   * `kachel` (Standard): Foto oben, Text darunter — die Form für Raster.
   *
   * `zeile`: ab `sm` Foto links, Text rechts. Für den Fall, dass in einem
   * mehrspaltigen Raster nur EIN Eintrag steht: Die einzelne Kachel stünde
   * sonst in einem Drittel der Breite links und der Rest bliebe leer. Unter
   * `sm` bleibt auch diese Form gestapelt — dort ist die Spalte ohnehin die
   * ganze Breite, und ein 240-px-Foto daneben ließe für den Text nichts übrig.
   */
  layout?: "kachel" | "zeile";
}) {
  const zeile = layout === "zeile";
  return (
    // relative: der über die ganze Kachel gespannte Link (z-0) macht sie
    // klickbar; der Like-Button liegt darüber (z-10) und bleibt eigenständig.
    <article
      className={`group relative overflow-hidden bg-white shadow-sm transition-shadow hover:shadow-md ${
        zeile ? "sm:grid sm:grid-cols-[15rem_minmax(0,1fr)]" : ""
      }`}
    >
      <Link
        href={`/rezepte/${recipe.slug}`}
        aria-label={recipe.title}
        className="absolute inset-0 z-0"
      />
      {/* In der Zeilenform füllt das Foto die Höhe der Zeile statt ein festes
          Seitenverhältnis zu halten: Als Rasterkind wird es auf die Zeilenhöhe
          gestreckt, `object-cover` beschneidet. `min-h` deckt den Fall ab, dass
          der Text kürzer ist als ein brauchbares Bild hoch. */}
      {recipe.image ? (
        <ResponsiveImg
          image={recipe.image}
          sizes={imageSizes}
          className={`aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] ${
            zeile ? "sm:aspect-auto sm:h-full sm:min-h-40" : ""
          }`}
        />
      ) : (
        <div
          aria-hidden
          className={`aspect-[4/3] w-full bg-cream ${
            zeile ? "sm:aspect-auto sm:h-full sm:min-h-40" : ""
          }`}
        />
      )}
      {/* Innerer Abstand: auf schmalen (2-spaltigen) Kacheln links/rechts knapper
          (px-3), damit mehr Platz für Titel/Text bleibt; ab sm wieder p-5. */}
      <div className={`px-3 py-4 sm:p-5 ${zeile ? "sm:self-center" : ""}`}>
        {(recipe.category || recipe.dietType) && (
          // break-words: „FAMILIENESSEN" ist ein einziges langes Wort und lief
          // auf schmalen Kacheln über die Kante — sichtbar ABGESCHNITTEN, weil
          // die Kachel `overflow-hidden` trägt. Umbrechen statt abschneiden.
          <p className="mb-1.5 text-xs font-semibold break-words uppercase tracking-[0.14em] text-leaf">
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
        {/* flex-wrap: Zeit und Likes stehen nebeneinander, solange sie passen —
            auf sehr schmalen Kacheln rutschen die Likes in die zweite Zeile,
            statt hinter der Kachelkante zu verschwinden. */}
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
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
