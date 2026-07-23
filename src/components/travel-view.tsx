/**
 * Reisebericht im Tiny-Salt-Stil: weiße Karte mit Hero-Bild und
 * Teilen-Button, Serifen-Titel, Icon-Meta-Zeile (Land/Region/Stadt),
 * Inhaltsverzeichnis, Inhalt als Blockfolge (Text/Bild/Restaurant),
 * Bildergalerie und die restlichen Restaurants gesammelt am Ende.
 * Zu jedem Gericht erscheinen bis zu 3 „Ähnliche Rezepte selbst machen".
 */
import Link from "next/link";
import type { FullDish, FullRestaurant, FullTravelPost } from "@/lib/travel";
import { extractHeadings, renderMarkdown } from "@/lib/markdown";
import { getBaseUrl } from "@/lib/base-url";
import { getSimilarRecipesByDish } from "@/lib/similar-recipes";
import { RecipeCard, type RecipeCardData } from "@/components/recipe-card";
import { t } from "@/i18n/de";
import { ResponsiveImg } from "./responsive-img";
import { HeroActions } from "./hero-actions";
import { TravelToc, type TocEntry } from "./travel-toc";
import { IconCalendar, IconCity, IconCountry, IconRegion, IconTag } from "./icons";

const dict = t();

/** Google-Maps-Ziel aus Koordinaten — gleiche URL wie die Weltkarten-Pins. */
function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Koordinaten eines Restaurants — wie bei den Pins der Weltkarte:
 * manueller Override am Restaurant zuerst, dann EXIF-GPS der Gericht-Bilder
 * (in Reihenfolge), ersatzweise das Restaurant-Foto. null ohne Treffer.
 */
function restaurantCoords(
  r: FullRestaurant,
): { lat: number; lng: number } | null {
  if (r.lat != null && r.lng != null) return { lat: r.lat, lng: r.lng };
  for (const dish of r.dishes) {
    for (const img of dish.images) {
      if (img.lat != null && img.lng != null) {
        return { lat: img.lat, lng: img.lng };
      }
    }
  }
  if (r.image && r.image.lat != null && r.image.lng != null) {
    return { lat: r.image.lat, lng: r.image.lng };
  }
  return null;
}

/** Kommagetrennte Angabe → getrimmte Einzel-Tokens (leere verworfen). */
function metaTokens(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Reisezeitpunkt als „September 2026" (Monat optional). Ohne Jahr → null (kein
 * Chip); mit Jahr, aber ohne gültigen Monat → nur das Jahr.
 */
function formatTravelTime(
  month: number | null,
  year: number | null,
): string | null {
  if (year == null) return null;
  return month != null && month >= 1 && month <= 12
    ? `${dict.travelList.months[month - 1]} ${year}`
    : String(year);
}

const metaLinkCls =
  "text-leaf underline underline-offset-2 hover:text-rose-primary-dark";

/** Karten-Hülle einer Meta-Angabe (Icon + Label + Inhalt). */
function MetaChip({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cream text-ink-soft"
      >
        {icon}
      </span>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-ink">
          {label}
        </p>
        <p className="text-sm text-ink-soft">{children}</p>
      </div>
    </div>
  );
}

/**
 * Meta-Angabe Land/Region/Stadt als Filter: JEDER kommagetrennte Wert wird ein
 * EIGENER Link auf die passende Reisen-Ergebnisseite (z. B. „Queensland" und
 * „New South Wales" getrennt → /reisen/region/Queensland bzw. …). So lässt sich
 * gezielt nach einem einzelnen Ort filtern, nicht nur nach der ganzen Kette.
 * Ohne `interactive` (z. B. Druckansicht) bleibt es reiner Text.
 */
function MetaFilterLinks({
  label,
  icon,
  value,
  base,
  interactive,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  /** Routen-Präfix, z. B. „/reisen/region". */
  base: string;
  interactive: boolean;
}) {
  const tokens = metaTokens(value);
  if (tokens.length === 0) return null;
  return (
    <MetaChip label={label} icon={icon}>
      {tokens.map((tok, i) => (
        <span key={`${tok}-${i}`}>
          {i > 0 && ", "}
          {interactive ? (
            <Link href={`${base}/${encodeURIComponent(tok)}`} className={metaLinkCls}>
              {tok}
            </Link>
          ) : (
            tok
          )}
        </span>
      ))}
    </MetaChip>
  );
}

/** „Ähnliche Rezepte selbst machen" — als vollwertige Rezept-Kacheln (dieselbe
 *  RecipeCard wie auf der Startseite) im gleichen Raster (bis zu 3 Vorschläge). */
function SimilarRecipeTiles({ recipes }: { recipes: RecipeCardData[] }) {
  if (recipes.length === 0) return null;
  return (
    <section className="border-t border-ink/10 pt-4">
      {/* Abschnittstitel als Eyebrow im Marken-Grün (wie die Kachel-Eyebrows). */}
      <h6 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-leaf">
        {dict.travelList.similarTitle}
      </h6>
      {/* Kompakt: schon auf Mobil 2-spaltig (mind. zwei Vorschläge sichtbar),
          ab lg drei Spalten. Etwas kleineres Gap auf Mobil. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
        {recipes.map((rec) => (
          <RecipeCard key={rec.slug} recipe={rec} />
        ))}
      </div>
    </section>
  );
}

function DishItem({
  dish,
  similar,
}: {
  dish: FullDish;
  similar: RecipeCardData[];
}) {
  return (
    <li id={`dish-${dish.id}`} className="flex flex-col gap-4">
      {/* Graue Box: nur das Gericht selbst (Bild, Name, Chips, Zutaten) */}
      <div className="flex flex-col gap-4 bg-cream/60 p-4 sm:flex-row">
        {dish.images.length > 0 && (
          <div className="sm:w-44 sm:shrink-0">
            {dish.images.length === 1 ? (
              <ResponsiveImg
                image={dish.images[0]}
                sizes="(max-width: 640px) 100vw, 176px"
                className="aspect-[4/3] w-full object-cover"
              />
            ) : (
              // Mehrere ausgewählte Fotos werden ALLE gezeigt (nicht nur das
              // erste): mobil als 3er-Reihe, ab Tablet in der schmalen
              // Seitenspalte untereinander.
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-1">
                {dish.images.map((img) => (
                  <ResponsiveImg
                    key={img.id}
                    image={img}
                    sizes="(max-width: 640px) 33vw, 176px"
                    className="aspect-[4/3] w-full object-cover"
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <div className="min-w-0 grow">
          {(dish.categories.length > 0 || dish.dietTypes.length > 0) && (
            // Kategorie · Ernährungsform als Eyebrow — identisch zu den
            // Rezept-Kacheln (Leaf-Grün, gesperrt, „·"-getrennt).
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-leaf">
              {[...dish.categories, ...dish.dietTypes]
                .map((x) => x.name)
                .join(" · ")}
            </p>
          )}
          {/* Gleiche Größe wie der Titel der Rezept-Kacheln darunter (text-lg).
              h5: unter dem „Gerichte / Getränke"-Zwischentitel (h4). */}
          <h5 className="font-display text-lg font-bold">{dish.name}</h5>
          {dish.description && (
            <div
              className="prose-content mt-1 text-sm text-ink-soft"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(dish.description),
              }}
            />
          )}
          {dish.ingredients.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft">
              <IconTag className="h-3.5 w-3.5" />
              <strong className="font-semibold text-ink">
                {dict.travelList.dishIngredients}:
              </strong>{" "}
              {dish.ingredients.map((i) => i.name).join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* Rezept-Vorschläge: außerhalb der grauen Box, klar zugeordnet */}
      <SimilarRecipeTiles recipes={similar} />
    </li>
  );
}

/** Restaurant-Karte — im Blockfluss oder in der Sammel-Sektion unten. */
function RestaurantCard({
  r,
  similarByDish,
}: {
  r: FullRestaurant;
  similarByDish: Record<number, RecipeCardData[]>;
}) {
  const coords = restaurantCoords(r);
  return (
    <div id={`restaurant-${r.id}`}>
      <h3 className="font-display text-xl font-bold">
        {dict.travelList.restaurantWord} {r.name}
        {r.city && (
          <span className="ml-2 text-sm font-normal text-ink-soft">
            ·{" "}
            {coords ? (
              // Ort → Google Maps (Koordinaten aus den EXIF-Daten der
              // Fotos, wie die Pins auf der Weltkarte)
              <a
                href={mapsUrl(coords.lat, coords.lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-leaf underline underline-offset-2 hover:text-rose-primary-dark"
              >
                {r.city}
              </a>
            ) : (
              r.city
            )}
          </span>
        )}
      </h3>
      {/* Bild + Beschreibung: mobil untereinander, ab Tablet (sm, deckt auch
          iPad-Hochformat ab) nebeneinander */}
      {(r.image || r.description) && (
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
          {r.image && (
            <div className="sm:w-72 sm:shrink-0 md:w-96">
              <ResponsiveImg
                image={r.image}
                sizes="(max-width: 640px) 100vw, 384px"
                className="aspect-[3/2] w-full object-cover"
              />
            </div>
          )}
          {r.description && (
            <div
              className="prose-content min-w-0 grow text-ink-soft"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(r.description),
              }}
            />
          )}
        </div>
      )}
      {r.dishes.length > 0 && (
        <h4 className="mt-5 font-display text-base font-bold text-ink">
          {dict.travelList.dishesTitle}
        </h4>
      )}
      <ul className="mt-4 flex flex-col gap-5">
        {r.dishes.map((dish) => (
          <DishItem
            key={dish.id}
            dish={dish}
            similar={similarByDish[dish.id] ?? []}
          />
        ))}
      </ul>
    </div>
  );
}

export async function TravelView({
  full,
  interactive = true,
}: {
  full: FullTravelPost;
  interactive?: boolean;
}) {
  const { post } = full;
  const url = `${getBaseUrl()}/reisen/${post.slug}`;

  // „Ähnliche Rezepte selbst machen" für alle Gerichte in einem Rutsch.
  const similarByDish = await getSimilarRecipesByDish(
    full.restaurants.flatMap((r) => r.dishes),
  );

  // Restaurants, die per Block im Inhalt platziert sind, erscheinen dort —
  // alle übrigen wie bisher gesammelt unter dem Inhalt.
  const inlineRestaurantIdx = new Set(
    full.blocks
      .filter((b) => b.type === "restaurant")
      .map((b) => (b.type === "restaurant" ? b.index : -1)),
  );
  const remainingRestaurants = full.restaurants.filter(
    (_, idx) => !inlineRestaurantIdx.has(idx),
  );

  // Inhaltsverzeichnis in Blockreihenfolge: Überschriften der Textblöcke
  // (oberste Ebene = Hauptpunkte), inline platzierte Restaurants als eigene
  // Hauptpunkte (mit ihren Gerichten als Unterpunkte), die restlichen
  // Restaurants gruppiert am Ende — Gerichte dort als dritte Ebene (2.1.1 …).
  const dishLeaves = (r: FullRestaurant) =>
    r.dishes
      .filter((d) => d.name)
      .map((d) => ({ id: `dish-${d.id}`, label: d.name }));
  const allHeadings = full.blocks.flatMap((b) =>
    b.type === "text" ? extractHeadings(b.markdown) : [],
  );
  const minDepth = allHeadings.length
    ? Math.min(...allHeadings.map((h) => h.depth))
    : 0;
  const tocEntries: TocEntry[] = [];
  for (const b of full.blocks) {
    if (b.type === "text") {
      for (const h of extractHeadings(b.markdown)) {
        if (h.depth <= minDepth || tocEntries.length === 0) {
          tocEntries.push({ id: h.id, label: h.text, children: [] });
        } else {
          tocEntries[tocEntries.length - 1].children.push({
            id: h.id,
            label: h.text,
          });
        }
      }
    } else if (b.type === "restaurant") {
      const r = full.restaurants[b.index];
      if (r?.name) {
        tocEntries.push({
          id: `restaurant-${r.id}`,
          label: `${dict.travelList.restaurantWord} ${r.name}`,
          children: dishLeaves(r),
        });
      }
    }
  }
  if (remainingRestaurants.length > 0) {
    tocEntries.push({
      id: "restaurants",
      label: dict.travelList.restaurantsTitle,
      children: remainingRestaurants
        .filter((r) => r.name)
        .map((r) => ({
          id: `restaurant-${r.id}`,
          label: `${dict.travelList.restaurantWord} ${r.name}`,
          children: dishLeaves(r),
        })),
    });
  }

  return (
    <article className="overflow-hidden bg-white shadow-sm">
      {full.heroImage && (
        <div className="relative">
          <ResponsiveImg
            image={full.heroImage}
            sizes="(max-width: 820px) 100vw, 768px"
            priority
            className="aspect-[2/1] w-full object-cover"
          />
          {interactive && <HeroActions title={post.title} url={url} />}
        </div>
      )}

      <div className="p-6 md:p-10">
        <header>
          <h1 className="font-display text-3xl font-bold md:text-[2.6rem] md:leading-tight">
            {post.title}
          </h1>
          {post.teaser && (
            <div
              className="prose-content mt-4 text-ink-soft"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(post.teaser) }}
            />
          )}
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4">
            <MetaFilterLinks
              label={dict.admin.travel.fieldCountry}
              icon={<IconCountry className="h-5 w-5" />}
              value={post.country}
              base="/reisen/land"
              interactive={interactive}
            />
            <MetaFilterLinks
              label={dict.admin.travel.fieldRegion}
              icon={<IconRegion className="h-5 w-5" />}
              value={post.region}
              base="/reisen/region"
              interactive={interactive}
            />
            <MetaFilterLinks
              label={dict.admin.travel.fieldCity}
              icon={<IconCity className="h-5 w-5" />}
              value={post.city}
              base="/reisen/stadt"
              interactive={interactive}
            />
            {post.travelYear != null && (
              <MetaChip
                label={dict.travelList.travelTime}
                icon={<IconCalendar className="h-5 w-5" />}
              >
                {formatTravelTime(post.travelMonth, post.travelYear)}
              </MetaChip>
            )}
          </div>
        </header>

        {/* Inhaltsverzeichnis — unter Land/Region/Stadt, mit Trennstrich */}
        {tocEntries.length > 0 && (
          <>
            <hr className="mt-8 border-ink/10" />
            <TravelToc
              title={dict.travelList.tocTitle}
              hideLabel={dict.travelList.tocHide}
              showLabel={dict.travelList.tocShow}
              entries={tocEntries}
            />
          </>
        )}

        {/* Inhalt als Blockfolge: Text, Bild, Restaurant */}
        {full.blocks.length > 0 && (
          <>
            <hr className="my-8 border-ink/10" />
            <div className="flex flex-col gap-7">
              {full.blocks.map((b, i) => {
                if (b.type === "text") {
                  return (
                    <div
                      key={i}
                      className="prose-content"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(b.markdown),
                      }}
                    />
                  );
                }
                if (b.type === "bild") {
                  const img = full.blockImages[b.imageId];
                  return img ? (
                    <ResponsiveImg
                      key={i}
                      image={img}
                      sizes="(max-width: 820px) 100vw, 688px"
                      className="w-full object-cover"
                    />
                  ) : null;
                }
                const r = full.restaurants[b.index];
                return r ? (
                  <RestaurantCard key={i} r={r} similarByDish={similarByDish} />
                ) : null;
              })}
            </div>
          </>
        )}

        {full.images.length > 0 && (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {full.images.map((img) => (
              <ResponsiveImg
                key={img.id}
                image={img}
                sizes="(max-width: 640px) 100vw, 384px"
                className="w-full object-cover"
              />
            ))}
          </div>
        )}

        {remainingRestaurants.length > 0 && (
          <>
            <hr className="my-8 border-ink/10" />
            <section id="restaurants">
              <h2 className="font-display text-2xl font-bold md:text-3xl">
                {dict.travelList.restaurantsTitle}
              </h2>
              <div className="mt-6 flex flex-col gap-8">
                {remainingRestaurants.map((r) => (
                  <RestaurantCard
                    key={r.id}
                    r={r}
                    similarByDish={similarByDish}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </article>
  );
}
