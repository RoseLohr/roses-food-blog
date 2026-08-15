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
import { getSimilarRecipesByDish } from "@/lib/similar-recipes";
import { RecipeCard, type RecipeCardData } from "@/components/recipe-card";
import { t } from "@/i18n/de";
import { ResponsiveImg } from "./responsive-img";
import { GalleryLightbox } from "./gallery-lightbox";
import { HeroActions } from "./hero-actions";
import { TravelToc, type TocEntry } from "./travel-toc";
import {
  IconCalendar,
  IconCity,
  IconCountry,
  IconPinCutlery,
  IconRegion,
  IconTag,
} from "./icons";

const dict = t();

/**
 * Reale Anzeigebreiten der Bilder in der Inhaltsspalte — AUSGERECHNET, nicht
 * geschätzt. Ein zu großes `sizes` lässt den Browser eine zu schwere Variante
 * laden, ein zu kleines liefert ein unscharfes Bild; beides ist ein Fehler.
 *
 * Die Kette bis zur Inhaltsspalte (C):
 *   Layout `px-4`             → 2rem  auf jeder Breite
 *   Artikel `p-6 md:p-10`     → 3rem  bis 767 px, darüber 5rem
 *   Artikel `max-w-4xl`       → deckelt bei 896 px, also ab 928 px Viewport
 *   Inhaltsverzeichnis ab md  → 200 px Spalte + `gap-8` (32 px) = 232 px
 *                               = 14.5rem, ABER nur wenn es eines gibt
 *
 *   ohne Verzeichnis:  <768: 100vw−5rem | <929: 100vw−7rem    | ≥929: 816px
 *   mit  Verzeichnis:  <768: 100vw−5rem | <929: 100vw−21.5rem | ≥929: 584px
 *
 * Deshalb gibt es die Maße zweimal: ob ein Verzeichnis steht, weiß erst
 * `TravelView` (es hängt an Überschriften und Restaurants), und ein `sizes`
 * kann das nicht selbst abfragen. Der Wert wird von dort durchgereicht.
 *
 * Nicht eingerechnet sind die 1-px-Rahmen der Restaurant-Karte (2 px je
 * Bild). Das deklariert 2 px MEHR als nötig — auf der Variantenleiter
 * (160/320/480/640/…) ändert das nie die Stufe, und zu großzügig ist die
 * sichere Richtung: die Gegenrichtung ergäbe ein unscharfes Bild.
 */
interface Bildmasse {
  /** Bild über die volle Breite der Inhaltsspalte (Block-Bild, Restaurant-Band). */
  inhalt: string;
  /** Bilder im 2er-Raster der Galerie (`sm:grid-cols-2`, `gap-4` = 16 px). */
  galerie: string;
  /** Bühne eines Gerichts: volle Breite INNERHALB der Restaurant-Karte
   *  (deren `p-4 md:p-6` zieht mobil 2rem, ab md 3rem ab). */
  buehne: string;
  /** Streifen darunter: Drittel der Bühne (`grid-cols-3`, `gap-2` = 8 px, also
   *  16 px auf drei Spalten). Der abgezogene rem-Wert ist bewusst leicht zu
   *  klein gerundet — lieber ein Pixel zu großzügig als ein unscharfes Bild. */
  streifen: string;
}

const MASSE_OHNE_TOC: Bildmasse = {
  inhalt:
    "(max-width: 767px) calc(100vw - 5rem), (max-width: 928px) calc(100vw - 7rem), 816px",
  galerie:
    "(max-width: 639px) calc(100vw - 5rem), (max-width: 767px) calc(50vw - 3rem), (max-width: 928px) calc(50vw - 4rem), 400px",
  buehne:
    "(max-width: 767px) calc(100vw - 7rem), (max-width: 928px) calc(100vw - 10rem), 768px",
  streifen:
    "(max-width: 767px) calc(33.4vw - 2.6rem), (max-width: 928px) calc(33.4vw - 3.6rem), 251px",
};

const MASSE_MIT_TOC: Bildmasse = {
  inhalt:
    "(max-width: 767px) calc(100vw - 5rem), (max-width: 928px) calc(100vw - 21.5rem), 584px",
  galerie:
    "(max-width: 639px) calc(100vw - 5rem), (max-width: 767px) calc(50vw - 3rem), (max-width: 928px) calc(50vw - 11.25rem), 284px",
  buehne:
    "(max-width: 767px) calc(100vw - 7rem), (max-width: 928px) calc(100vw - 24.5rem), 536px",
  streifen:
    "(max-width: 767px) calc(33.4vw - 2.6rem), (max-width: 928px) calc(33.4vw - 8.4rem), 174px",
};

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
            <Link
              href={`${base}/${encodeURIComponent(tok)}`}
              className={metaLinkCls}
            >
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

/**
 * Ein Gericht als „Bühne und Streifen" (Entwurf, Vorschlag C): Kopf mit
 * Kategorie und Name, darunter das erste Foto groß als Bühne und die übrigen
 * klein als Streifen, dann der Text über die volle Breite.
 *
 * Warum so: Das beste Foto bekommt den Auftritt, die übrigen bleiben Beleg —
 * genau die Rangfolge, die ein Reisebericht ohnehin hat. Und weil der Text
 * UNTER den Bildern über die ganze Breite läuft, hält die Anordnung jede
 * Textlänge aus: bei zwei Zeilen entsteht kein Loch neben einer Bilderspalte
 * (das war die Schwäche der Alternative „Text links, Bilder rechts"), bei
 * einem langen Absatz bricht nichts auseinander.
 *
 * Die Trennlinie oben grenzt aufeinanderfolgende Gerichte ab; beim ersten
 * Eintrag entfällt sie, sonst stünde direkt unter dem Zwischentitel
 * „Gerichte / Getränke" eine zweite Linie.
 */
function DishItem({
  dish,
  similar,
  masse,
}: {
  dish: FullDish;
  similar: RecipeCardData[];
  masse: Bildmasse;
}) {
  return (
    <li
      id={`dish-${dish.id}`}
      className="flex flex-col gap-4 border-t border-ink/10 pt-6 first:border-t-0 first:pt-0"
    >
      <div>
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
      </div>

      {dish.images.length > 0 && (
        // Eigener Wrapper, damit Bühne und Streifen EIN Element im
        // `flex-col gap-4` darüber sind — sonst schöbe sich der Spalten-
        // Abstand zwischen beide und der Streifen verlöre den Bezug.
        <div>
          {/* Alle ausgewählten Fotos als EINE klickbare Galerie: ein Klick
              öffnet das Bild groß im Pop-up, bei mehreren Fotos mit
              Vor/Zurück — die Bühne zählt dabei mit („1 von 4"), sie ist
              kein Sonderfall. */}
          <GalleryLightbox
            images={dish.images}
            label={dish.name}
            lead={{
              className: "aspect-[16/9] w-full object-cover",
              sizes: masse.buehne,
            }}
            thumbSizes={masse.streifen}
            thumbClassName="aspect-square w-full object-cover"
            groupClassName="mt-2 grid grid-cols-3 gap-2"
          />
        </div>
      )}

      {(dish.description || dish.ingredients.length > 0) && (
        <div>
          {dish.description && (
            <div
              className="prose-content text-sm text-ink-soft"
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
      )}

      <SimilarRecipeTiles recipes={similar} />
    </li>
  );
}

/**
 * Restaurant als „Karteikarte" (Entwurf, Vorschlag A) — im Blockfluss oder in
 * der Sammel-Sektion unten. Kopfzeile mit Name und Ort, darunter das Foto als
 * durchgehendes Band, dann Beschreibung und Gerichte im Karten-Körper.
 *
 * Warum ein Rahmen: Ein Bericht listet oft mehrere Stationen hintereinander,
 * jede mit Fotos, Text und mehreren Gerichten. Ohne Abgrenzung verschwimmt,
 * was wozu gehört — die Karte macht daraus einen Eintrag, den man auch
 * überspringen kann. Das Foto läuft dabei bewusst über die volle Kartenbreite
 * statt neben dem Text: in der schmalen Spalte neben dem Inhaltsverzeichnis
 * bliebe für die Beschreibung sonst kaum mehr Platz als ein paar Zeichen.
 */
function RestaurantCard({
  r,
  similarByDish,
  masse,
}: {
  r: FullRestaurant;
  similarByDish: Record<number, RecipeCardData[]>;
  masse: Bildmasse;
}) {
  const coords = restaurantCoords(r);
  return (
    <div
      id={`restaurant-${r.id}`}
      className="overflow-hidden rounded-sm border border-ink/15"
    >
      <div className="border-b border-ink/10 bg-cream/50 px-4 py-3 md:px-6 md:py-4">
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
      </div>

      {r.image && (
        // Restaurant-Foto klickbar: öffnet sich groß im Pop-up. Als Band ohne
        // Innenabstand ist es exakt so breit wie die Karte, also wie die
        // Inhaltsspalte.
        <GalleryLightbox
          images={[r.image]}
          label={`${dict.travelList.restaurantWord} ${r.name}`}
          thumbSizes={masse.inhalt}
          thumbClassName="aspect-[3/2] w-full object-cover"
        />
      )}

      <div className="p-4 md:p-6">
        {r.description && (
          <div
            className="prose-content text-ink-soft"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(r.description),
            }}
          />
        )}
        {r.dishes.length > 0 && (
          <>
            <h4
              className={`font-display text-base font-bold text-ink ${
                r.description ? "mt-6" : ""
              }`}
            >
              {dict.travelList.dishesTitle}
            </h4>
            <ul className="mt-4 flex flex-col gap-6">
              {r.dishes.map((dish) => (
                <DishItem
                  key={dish.id}
                  dish={dish}
                  similar={similarByDish[dish.id] ?? []}
                  masse={masse}
                />
              ))}
            </ul>
          </>
        )}
      </div>
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

  // Erst jetzt steht fest, ob links ein Inhaltsverzeichnis steht — und damit,
  // wie breit die Inhaltsspalte wirklich ist. Genau daran hängen die
  // `sizes`-Angaben aller Bilder darunter.
  const masse = tocEntries.length > 0 ? MASSE_MIT_TOC : MASSE_OHNE_TOC;

  // Gibt es überhaupt etwas unter dem Kopf? Sonst stünde dort eine einsame
  // Trennlinie über einem leeren Raster.
  const hatInhalt =
    full.blocks.length > 0 ||
    full.images.length > 0 ||
    remainingRestaurants.length > 0;

  return (
    // Gleiche Breite wie die Rezeptseite (recipe-view.tsx: mx-auto max-w-4xl):
    // beide stehen damit als 896-px-Blatt auf demselben grauen Grund, und der
    // Wechsel zwischen Rezept und Reise springt nicht mehr. Der Layout-
    // Container ringsum bleibt unangetastet (max-w-6xl gilt weiter für die
    // Listenseiten) — deshalb hier am Artikel und nicht im Layout.
    <article className="mx-auto max-w-4xl overflow-hidden bg-white shadow-sm">
      {full.heroImage && (
        <div className="relative">
          <ResponsiveImg
            image={full.heroImage}
            // Der Hero füllt die Artikelbreite: bis 928 px Viewport die volle
            // Breite abzüglich Layout-px-4, darüber der Deckel von 896 px.
            // (928 = 896 + 2×16; derselbe Umschaltpunkt wie im Rezept.)
            sizes="(max-width: 928px) calc(100vw - 2rem), 896px"
            priority
            className="aspect-[2/1] w-full object-cover"
          />
          {interactive && (
            <HeroActions
              title={post.title}
              publicPath={`/reisen/${post.slug}`}
            />
          )}
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
          {/* Mobil festes 2er-Raster (Land|Region, Stadt|Reisezeit) statt
              unregelmäßigem Umbruch; ab Tablet wieder Fließzeile. */}
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
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

        {/* Trennt den Kopf vom Inhalt — bewusst ÜBER dem Raster, nicht in der
            rechten Spalte: sonst begänne der Text 32 px tiefer als das
            Inhaltsverzeichnis daneben, und die beiden Spalten stünden sichtbar
            versetzt. */}
        {hatInhalt && <hr className="my-8 border-ink/10" />}

        {/* Ab Tablet zweispaltig: Inhaltsverzeichnis links, Inhalt rechts.
            Beides steht INNERHALB des weissen Blattes — stünde das
            Verzeichnis im grauen Rand, wäre der Rand links und rechts wieder
            ungleich breit, also genau das, was der Umbau abstellen soll.
            Ohne Verzeichnis (kurzer Bericht ohne Überschriften und
            Restaurants) bleibt es einspaltig, sonst stünde links eine leere
            Spalte. Die 200 px sind gemessen, nicht geraten: darunter bricht
            „1.1.1 Pasta alla Norma" auf der dritten Ebene in drei Zeilen. */}
        <div
          className={
            tocEntries.length > 0
              ? "grid gap-8 md:grid-cols-[200px_minmax(0,1fr)] md:items-start"
              : ""
          }
        >
          {tocEntries.length > 0 && (
            <TravelToc
              title={dict.travelList.tocTitle}
              hideLabel={dict.travelList.tocHide}
              showLabel={dict.travelList.tocShow}
              entries={tocEntries}
            />
          )}

          {/* min-w-0: ohne das sprengt ein langes Wort oder ein breites Bild
              die Rasterspalte, statt umzubrechen. */}
          <div className="min-w-0">
            {/* Inhalt als Blockfolge: Text, Bild, Restaurant */}
            {full.blocks.length > 0 && (
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
                        // Volle Breite der Inhaltsspalte (Herleitung siehe
                        // Bildmasse oben) — mit Verzeichnis schmaler.
                        sizes={masse.inhalt}
                        className="w-full object-cover"
                      />
                    ) : null;
                  }
                  const r = full.restaurants[b.index];
                  return r ? (
                    <RestaurantCard
                      key={i}
                      r={r}
                      similarByDish={similarByDish}
                      masse={masse}
                    />
                  ) : null;
                })}
              </div>
            )}

            {full.images.length > 0 && (
              <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {full.images.map((img) => (
                  <ResponsiveImg
                    key={img.id}
                    image={img}
                    // Halbe Inhaltsspalte abzüglich gap-4 (siehe Bildmasse);
                    // bis 639 px steht das Raster einspaltig.
                    sizes={masse.galerie}
                    className="w-full object-cover"
                  />
                ))}
              </div>
            )}

            {remainingRestaurants.length > 0 && (
              <>
                {/* Trenner mit Marke statt schlichter Linie: Linie links,
                    Kartenpin mit Besteck in der Marken-Farbe, Linie rechts.
                    Dasselbe Muster trägt schon das Zeit-Band im Rezept
                    (recipe-view.tsx) — ein Haus, eine Sprache.
                    aria-hidden: rein schmückend, die Überschrift darunter
                    benennt die Sektion für Screenreader.
                    36 px (h-9): darunter laufen Gabel und Messer im Pin zu
                    einem Fleck zusammen (im Rendering-Vergleich gemessen). */}
                <div className="my-8 flex items-center gap-4" aria-hidden>
                  <span className="h-px flex-1 bg-ink/10" />
                  <IconPinCutlery className="h-9 w-9 shrink-0 text-leaf" />
                  <span className="h-px flex-1 bg-ink/10" />
                </div>
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
                        masse={masse}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
