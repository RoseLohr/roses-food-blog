/**
 * Reisebericht im Tiny-Salt-Stil: weiße Karte mit Hero-Bild und
 * Teilen-Button, Serifen-Titel, Icon-Meta-Zeile (Land/Region/Stadt),
 * Inhaltsverzeichnis, Inhalt als Blockfolge (Text/Bild/Restaurant),
 * Bildergalerie und die restlichen Restaurants gesammelt am Ende.
 * Zu jedem Gericht erscheinen bis zu 3 „Ähnliche Rezepte selbst machen".
 */
import Link from "next/link";
import type { FullDish, FullRestaurant, FullTravelPost } from "@/lib/travel";
import type { MediaImage } from "@/lib/recipes";
import type { BildGroesse, BildPlatz } from "@/lib/bildreihen";
import {
  bildSizes,
  galerieSizes,
  seitenverhaeltnis,
  vollbildSizes,
  zuRenderBloecken,
} from "@/lib/bildreihen";
import { extractHeadings, renderMarkdown } from "@/lib/markdown";
import { getSimilarRecipesByDish } from "@/lib/similar-recipes";
import { RecipeCard, type RecipeCardData } from "@/components/recipe-card";
import { t } from "@/i18n/de";
import { ResponsiveImg } from "./responsive-img";
import { GalleryLightbox } from "./gallery-lightbox";
import { HeroActions } from "./hero-actions";
import { TravelToc, type TocEntry } from "./travel-toc";
import { IconCalendar, IconCity, IconCountry, IconRegion, IconTag } from "./icons";
import { IconBesteck } from "./icon-besteck";
import { IconLoeffel } from "./icon-loeffel";

const dict = t();

/**
 * Reale Anzeigebreiten der Bilder — AUSGERECHNET, nicht geschätzt. Ein zu
 * großes `sizes` lässt den Browser eine zu schwere Variante laden, ein zu
 * kleines liefert ein unscharfes Bild; beides ist ein Fehler.
 *
 * Die Kette bis zum Inhaltsbereich:
 *   Layout `px-4`          → 2rem  auf jeder Breite
 *   Artikel `p-6 md:p-10`  → 3rem  bis 767 px, darüber 5rem
 *   Artikel `max-w-4xl`    → deckelt bei 896 px, also ab 928 px Viewport
 *
 *   <768: 100vw − 5rem | <929: 100vw − 7rem | ≥929: 816 px
 *
 * Das Inhaltsverzeichnis kommt hier NICHT mehr vor, und das ist der Kern des
 * Umbaus: Es steht als umflossener Block (float) im Text, nicht mehr als
 * Rasterspalte. Umflossen werden nur die TEXTZEILEN; alle bildtragenden
 * Blöcke tragen `clear-left` und beginnen unter dem Verzeichnis. Ein Bild ist
 * damit in JEDER Fensterbreite genau so breit wie der Inhaltsbereich —
 * an elf Breiten nachgemessen. Vorher brauchte es dafür zwei Maßtabellen,
 * die durch alle Komponenten gereicht wurden.
 *
 * Nicht eingerechnet sind die 1-px-Rahmen der Restaurant-Karte (2 px je
 * Bild). Das deklariert 2 px MEHR als nötig — auf der Variantenleiter
 * (160/320/480/640/…) ändert das nie die Stufe, und zu großzügig ist die
 * sichere Richtung: die Gegenrichtung ergäbe ein unscharfes Bild.
 */
const MASSE = {
  /** Bild über die volle Breite des Inhalts (Titelbild, Restaurant-Band). */
  inhalt:
    "(max-width: 767px) calc(100vw - 5rem), (max-width: 928px) calc(100vw - 7rem), 816px",
  /** Bühne eines Gerichts: volle Breite innerhalb der Restaurant-Karte
   *  (`p-4 md:p-6` zieht mobil 2rem ab, ab md 3rem) und abzüglich der
   *  Stationsschiene (36 px Punkt + 16 px Abstand = 52 px = 3.25rem). */
  buehne:
    "(max-width: 767px) calc(100vw - 10.25rem), (max-width: 928px) calc(100vw - 13.25rem), 714px",
} as const;

/**
 * `sizes` einer Streifen-Kachel. Es gibt genau ZWEI Formen, weil der Streifen
 * genau zwei oder drei Spalten hat — auf dem Handy immer zwei.
 *
 * Das war nicht immer so: Zuerst stand hier `auto-fit` mit
 * `minmax(6.25rem, 1fr)`, also „so viele Spalten, wie bei 100 px hineinpassen".
 * Elegant, aber die Spaltenzahl war damit eine VERSTECKTE Funktion von
 * Containerbreite, Mindestbreite und Abstand — und ein `sizes`-Attribut kann
 * sie nicht ausrechnen. Unter etwa 372 px Viewport fiel das Raster auf EINE
 * Spalte zurück, die Kachel wurde doppelt so breit wie deklariert, und der
 * Browser lud eine zu kleine Variante: sichtbar unscharf. Gleichzeitig stand
 * der Zwei-Foto-Fall dort gestapelt statt nebeneinander — also gerade nicht
 * das, was Regel C zusagt. (Befund gpt-5.6-sol, PR #67.)
 *
 * Deshalb steht die Spaltenzahl jetzt AUSGESCHRIEBEN in den Rasterklassen und
 * hier — beides direkt nebeneinander, damit es nicht auseinanderlaufen kann.
 *
 * Kachelbreite = (Stationsbreite − Abstände) / Spalten, mit `gap-2` = 0,5rem:
 *   Station  <768 px : 100vw − 10.25rem   (Layout 2 + Artikel 3 + Karte 2 + Schiene 3.25)
 *   Station  <929 px : 100vw − 13.25rem   (ab md Artikel 5 + Karte 3)
 *   Station ≥929 px  : 714 px             (816 − 2 Rahmen − 48 − 52)
 */
const STREIFEN_ZWEISPALTIG =
  "(max-width: 767px) calc(50vw - 5.375rem), (max-width: 928px) calc(50vw - 6.875rem), 353px";
const STREIFEN_DREISPALTIG =
  "(max-width: 639px) calc(50vw - 5.375rem), (max-width: 767px) calc(33.33vw - 3.75rem), (max-width: 928px) calc(33.33vw - 4.75rem), 233px";

/** Seitenverhältnis eines Bildes als Inline-Custom-Property. Es ist eine
 *  Eigenschaft des BILDES, keine des Layouts — deshalb inline und nicht als
 *  Klasse. Auf 4 Stellen gerundet: mehr ändert unter einem Pixel nichts. */
function arStil(img: MediaImage): React.CSSProperties {
  return {
    "--ar": seitenverhaeltnis(img.width, img.height).toFixed(4),
  } as React.CSSProperties;
}

/**
 * Ein BILDPLATZ: ein Bild oder zwei als Paar, in der eingestellten Breite und
 * an der eingestellten Seite. Der Text fließt daneben weiter.
 *
 * Beim Paar teilen sich die beiden Bilder die Breite über
 * `flex: var(--ar) 1 0` im Verhältnis ihrer Seitenverhältnisse. Die gesamte
 * Breite ist freier Platz, der proportional zum Format verteilt wird — dadurch
 * ist Breite_i / Format_i für beide gleich, also sind sie exakt gleich hoch und
 * schließen unten bündig ab, ohne Zuschnitt und ohne eine Zeile JavaScript.
 */
function Bildplatz({
  images,
  groesse,
  platz,
}: {
  images: MediaImage[];
  groesse: BildGroesse;
  platz: BildPlatz;
}) {
  if (images.length === 0) return null;
  const sizes = bildSizes(
    groesse,
    images.map((img) => seitenverhaeltnis(img.width, img.height)),
  );
  // Bei `l` gibt es keine Seite — die Klasse entfällt, damit im CSS gar nicht
  // erst eine Float-Regel greifen kann, die dann wieder aufgehoben werden müsste.
  const klassen = `bildplatz gr-${groesse}${groesse === "l" ? "" : ` pl-${platz}`}`;

  // Ein einzelnes Bild: Der Klick-Rahmen IST der Bildplatz — er schwebt im
  // Text, also trägt er die Layout-Klassen. Ein Paar: Der Bildplatz bleibt der
  // Kasten außen herum, die beiden Rahmen sind seine Flex-Kinder und tragen
  // je ihr Seitenverhältnis. Beide Male gehören die Bilder zu EINER Galerie —
  // im Pop-up blättert man deshalb durch das Paar.
  const galerie = images.map((img, i) => ({
    ...img,
    thumb:
      images.length === 1
        ? { sizes: sizes[i], frameClassName: klassen }
        : { sizes: sizes[i], frameStyle: arStil(img) },
  }));
  const lightbox = (
    <GalleryLightbox
      images={galerie}
      thumbSizes={sizes[0]}
      groupClassName={images.length === 1 ? undefined : "bildpaar"}
    />
  );
  return images.length === 1 ? (
    lightbox
  ) : (
    <div className={klassen}>{lightbox}</div>
  );
}

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

/**
 * `sizes` einer „Ähnliche Rezepte"-Kachel. Sie steht NICHT in der Gerichts-
 * Bühne, sondern in der ausgerückten Fläche darum (siehe SimilarRecipeTiles):
 * Die ist links um Schiene + Abstand (3.25rem) breiter als die Bühne, mobil
 * zusätzlich um den rechten Karten-Innenabstand (1rem), und zieht selbst
 * Innenabstand ab (mobil links 1.25 + rechts 1rem, ab md 1.25rem je Seite).
 *
 * Fläche  <768 : (100vw − 10.25rem) + 3.25 + 1     = 100vw − 6rem
 * Inhalt  <768 : − 1.25 − 1                        = 100vw − 8.25rem
 * Fläche  <929 : (100vw − 13.25rem) + 3.25         = 100vw − 10rem
 * Inhalt  <929 : − 2 × 1.25                        = 100vw − 12.5rem
 * Inhalt ≥929  : 714 + 52 − 40                     = 726 px
 *
 * Spalten: 1 (<640) · 2 (ab sm) · 3 (ab lg), Abstand ab sm 20 px.
 *   ≥1024: (726 − 40) / 3 = 228,7 → 229 px
 *   929–1023: (726 − 20) / 2 = 353 px
 */
const AEHNLICH_SIZES =
  "(max-width: 639px) calc(100vw - 8.25rem), " +
  "(max-width: 767px) calc((100vw - 8.25rem - 20px) / 2), " +
  "(max-width: 928px) calc((100vw - 12.5rem - 20px) / 2), " +
  "(max-width: 1023px) 353px, 229px";

/**
 * `sizes` der EINZELNEN Kachel in Zeilenform. Unter `sm` steht sie gestapelt
 * über die volle Breite der Fläche (wie im Raster), ab `sm` ist das Foto die
 * feste linke Spalte der Zeile: 15rem = 240 px, unabhängig vom Viewport.
 */
const AEHNLICH_ZEILE_SIZES = "(max-width: 639px) calc(100vw - 8.25rem), 240px";

/**
 * „Ähnliche Rezepte selbst machen" — als vollwertige Rezept-Kacheln (dieselbe
 * RecipeCard wie auf der Startseite), auf dem Handy einspaltig.
 *
 * ABGESETZT ÜBER ZWEI SIGNALE, die dasselbe auf zwei Arten sagen (Entwurf
 * „B + C", abgestimmt):
 *
 * 1. TRENNER MIT LÖFFEL — derselbe Bau wie vor der Restaurant-Sektion (Linie,
 *    Zeichen, Linie), nur mit einem anderen Zeichen: zwei Wechsel, zwei
 *    Zeichen. Er markiert den Wechsel zeitlich: hier hört das Gericht auf.
 * 2. AUSRÜCKEN um Schiene + Abstand (`-ml-13` = 52 px) auf getöntem Grund. Das
 *    markiert ihn räumlich: hier gehört etwas anderes hin. Die Gericht-Spalte
 *    bleibt eingerückt, der Bereich ist so breit wie der Karteninhalt.
 *
 * Der Trenner spannt über die AUSGERÜCKTE Breite, nicht über die Gericht-
 * Spalte — dadurch fällt der Versatz genau an der Linie auf, wo der Blick
 * ohnehin hinschaut. Ohne diese Kopplung wären es zwei Signale nebeneinander
 * statt eines gemeinsamen.
 *
 * Mobil rückt der Bereich auch nach rechts aus (`-mr-4 pr-4`) und wird damit
 * zum Band über die ganze Kartenbreite; ab `md` bleibt die rechte Kante bündig,
 * weil dort der Versatz allein schon trägt.
 *
 * `relative`: Die Schienenlinie zur nächsten Station ist ein Pseudo-Element
 * eines positionierten Elements und läge sonst ÜBER der getönten Fläche — sie
 * sagt „hier geht dasselbe weiter", während die Fläche „hier ist etwas
 * anderes" sagt. Positioniert bricht die Fläche die Linie und gibt sie unter
 * sich wieder frei, sodass die Kette zur nächsten Station sichtbar bleibt.
 */
function SimilarRecipeTiles({ recipes }: { recipes: RecipeCardData[] }) {
  if (recipes.length === 0) return null;
  return (
    <section className="relative -ml-13 -mr-4 bg-cream px-5 pt-5 pr-4 pb-6 md:mr-0 md:pr-5">
      {/* aria-hidden: rein schmückend, die Überschrift darunter benennt den
          Abschnitt für Screenreader. Zur Größe h-9 siehe icon-loeffel.tsx. */}
      <div className="mb-3 flex items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-ink/15" />
        <IconLoeffel className="h-9 w-9 shrink-0 text-ink-soft" />
        <span className="h-px flex-1 bg-ink/15" />
      </div>
      {/* Titel in der Titelschrift, mittig unter dem Löffel. Vorher stand hier
          eine Eyebrow-Zeile — also exakt dieselbe Auszeichnung, die zwei
          Zentimeter darüber schon die Kategorien des Gerichts trägt. Genau
          daran war der Abschnitt nicht als eigener Bereich zu erkennen. */}
      <h6 className="mb-4 text-center font-display text-base font-bold text-ink">
        {dict.travelList.similarTitle}
      </h6>
      {/* EIN Eintrag bekommt die ganze Breite — auf jedem Gerät. Auf dem Handy
          galt das schon; im Drei-Spalten-Raster stand er dagegen in einem
          Drittel links, und der Rest blieb leer. Unter einem Trenner, der über
          die volle Breite spannt, liest sich das wie ein Fehler. Ab `sm` wird
          daraus die Zeile: Foto links, Text rechts.

          Ab zwei Einträgen bleibt es das Raster — eine Spalte bis sm, zwei ab
          sm, drei ab lg. Zwei Spalten auch auf dem Handy ließen rund 147 px je
          Kachel: Ein Titel wie „Caponata – Sizilianisches Schmorgemüse" ist
          darin sechs Zeilen lang, und die Eyebrow-Zeile wurde abgeschnitten. */}
      {recipes.length === 1 ? (
        <RecipeCard
          recipe={recipes[0]}
          imageSizes={AEHNLICH_ZEILE_SIZES}
          layout="zeile"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {recipes.map((rec) => (
            <RecipeCard
              key={rec.slug}
              recipe={rec}
              imageSizes={AEHNLICH_SIZES}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Ein Gericht als STATION: links ein nummerierter Punkt an einer dünnen Linie,
 * rechts der Inhalt (Kopf, Fotos, Text). Innerhalb der Fotos gilt „Bühne und
 * Streifen": das erste Foto groß, die übrigen klein darunter.
 *
 * Der Punkt ist nicht neu erfunden — die Zubereitungsschritte im Rezept
 * (`recipe-view.tsx`) tragen längst genau diesen Kreis: 36 px, `bg-leaf-soft`,
 * weiße Ziffer, 16 px Abstand zum Text. Die Reise übernimmt ihn und hängt nur
 * die Linie dazwischen. Ein Haus, eine Sprache.
 *
 * FOTOS, Regel C (abgestimmt): Bei GENAU ZWEI Fotos gibt es keine Bühne,
 * sondern zwei gleich große nebeneinander — bei dieser Zahl existiert die
 * Rangfolge nicht, die eine Bühne behaupten würde. Ab drei Fotos trägt die
 * Bühne, und der Streifen bekommt so viele Spalten, wie Fotos übrig sind,
 * gedeckelt bei drei; auf dem Handy sind es immer zwei. Damit ist die Zeile
 * bei zwei und drei Streifen-Fotos immer voll — nie bleibt ein Drittel leer,
 * was der eigentliche Anlass für Regel C war.
 *
 * Die Spaltenzahl steht AUSGESCHRIEBEN (`grid-cols-2 sm:grid-cols-3`), nicht
 * als `auto-fit`: Nur so kann das `sizes`-Attribut sie kennen. Warum das
 * nötig ist, steht bei STREIFEN_ZWEISPALTIG.
 */
function DishItem({
  dish,
  similar,
  nummer,
  letzte,
}: {
  dish: FullDish;
  similar: RecipeCardData[];
  /** Fortlaufende Nummer innerhalb des Restaurants (1-basiert). */
  nummer: number;
  /** Letzte Station: dann endet die Schiene, es folgt nichts mehr. */
  letzte: boolean;
}) {
  const fotos = dish.images;
  // Genau zwei Fotos → gleichrangig nebeneinander, sonst Bühne + Streifen.
  const paarweise = fotos.length === 2;
  // Streifen-Fotos = alle ohne die Bühne. Ab dreien wird ab `sm` dreispaltig;
  // darunter und auf dem Handy bleibt es bei zwei Spalten.
  const streifenAnzahl = paarweise ? fotos.length : fotos.length - 1;
  const dreispaltig = streifenAnzahl >= 3;

  return (
    <li
      id={`dish-${dish.id}`}
      className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-4"
    >
      {/* Schiene: Punkt, darunter die Linie bis zur nächsten Station. Beim
          letzten Eintrag entfällt sie — bewusst über ein Prop und nicht über
          die `last:`-Variante: die zielt auf das letzte KIND, und dieses div
          ist immer das erste von zweien, nie das letzte. */}
      <div
        className={`relative ${
          letzte
            ? ""
            : "before:absolute before:left-[1.09rem] before:top-11 before:-bottom-8 before:w-px before:bg-leaf/30"
        }`}
      >
        <span
          aria-hidden
          className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full bg-leaf-soft text-base font-semibold tabular-nums text-white"
        >
          {nummer}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
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

        {fotos.length > 0 && (
          // Eigener Wrapper, damit Bühne und Streifen EIN Element im
          // `flex-col gap-4` darüber sind — sonst schöbe sich der Spalten-
          // Abstand zwischen beide und der Streifen verlöre den Bezug.
          <div>
            {/* Alle Fotos als EINE klickbare Galerie: ein Klick öffnet das Bild
                groß im Pop-up, bei mehreren mit Vor/Zurück — die Bühne zählt
                dabei mit („1 von 4"), sie ist kein Sonderfall. */}
            <GalleryLightbox
              images={fotos}
              label={dish.name}
              lead={
                paarweise
                  ? undefined
                  : {
                      className: "aspect-[16/9] w-full object-cover",
                      sizes: MASSE.buehne,
                    }
              }
              thumbSizes={
                dreispaltig ? STREIFEN_DREISPALTIG : STREIFEN_ZWEISPALTIG
              }
              thumbClassName={
                paarweise
                  ? "aspect-[4/3] w-full object-cover"
                  : "aspect-square w-full object-cover"
              }
              groupClassName={`grid gap-2 grid-cols-2 ${
                dreispaltig ? "sm:grid-cols-3" : ""
              } ${paarweise ? "" : "mt-2"}`}
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
      </div>
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
}: {
  r: FullRestaurant;
  similarByDish: Record<number, RecipeCardData[]>;
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
          thumbSizes={MASSE.inhalt}
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
            {/* gap-8: der Abstand trägt die Schienenlinie zwischen den
                Stationen — enger wirkt die Linie wie ein Strich, weiter reißt
                die Kette optisch. */}
            <ul className="mt-4 flex flex-col gap-8">
              {r.dishes.map((dish, i) => (
                <DishItem
                  key={dish.id}
                  dish={dish}
                  similar={similarByDish[dish.id] ?? []}
                  nummer={i + 1}
                  letzte={i === r.dishes.length - 1}
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

        {/* Inhaltsverzeichnis als UMFLOSSENER Block, nicht als Rasterspalte.
            Warum kein Raster: Eine Rasterspalte bleibt über die GANZE Länge des
            Berichts stehen — auch weit unter dem Verzeichnis, wo links nur noch
            Weißraum ist (am geseedeten Bericht gemessen: 200 × 2303 px tote
            Spalte). Ein Grid-Element kann nicht in Spalte 2 beginnen und weiter
            unten über beide Spalten weiterlaufen; Raster-Spuren fragmentieren
            nicht. Ein Float kann genau das.

            `flow-root` schließt den Float ein, damit das weiße Blatt mitwächst,
            wenn das Verzeichnis höher ist als der Text daneben. Bewusst NICHT
            `overflow-hidden` — das schnitte später ein `position: sticky` ab.

            Und bewusst KEIN Flex-Wrapper um die Blöcke: der wäre EIN Kasten,
            verschmälerte sich neben dem Float auf dessen Restbreite und behielte
            sie über die ganze Länge. Die Blöcke sind Geschwister im normalen
            Fluss, der Abstand kommt über `space-y`. */}
        {/* `[&>nav+*]:mt-0` ab md: Der erste Block soll auf gleicher Höhe
            beginnen wie das Verzeichnis. Ohne die Regel schöbe ihn der
            Geschwister-Abstand 28 px tiefer und beide stünden sichtbar
            versetzt (gemessen). Auf dem Handy ist das Verzeichnis gestapelt,
            dort SOLL der Abstand bleiben. */}
        <div className="flow-root [&>*+*]:mt-7 md:[&>nav+*]:mt-0">
          {tocEntries.length > 0 && (
            <TravelToc
              title={dict.travelList.tocTitle}
              hideLabel={dict.travelList.tocHide}
              showLabel={dict.travelList.tocShow}
              entries={tocEntries}
              /* 300 px sind gemessen: Bei den vorherigen 200 px waren 4 von 13
                 echten Einträgen dreizeilig, bei 300 px keiner mehr, und das
                 Verzeichnis wird um ein Drittel flacher (798 → 534 px). Die
                 Schwelle steht als `md:` (48rem, also in em) — stellt jemand
                 den Browser auf 24 px Grundschrift, wandert sie mit und der
                 Umfluss schaltet sich ab, statt 40 Zeichen je Zeile zu lassen.
                 first:mt-0 hier nicht nötig: als erstes Kind greift `[&>*+*]`
                 ohnehin nicht. */
              className="my-6 md:float-left md:my-0 md:mr-8 md:mb-6 md:w-[clamp(240px,38%,300px)]"
            />
          )}

          {/* Der erste Block startet auf gleicher Höhe wie das Verzeichnis. */}
          {full.blocks.length > 0 && (
            <div className="[&>*+*]:mt-7">
              {(() => {
                /**
                 * BILD UND SEIN TEXT GEHÖREN IN EINEN KASTEN.
                 *
                 * Ein Float wirkt auf die Zeilen, die ihm folgen — nicht auf
                 * die Kästen. Standen Bild und Text als Geschwister im Fluss,
                 * schob `clear` das BILD nach unten (unter das Verzeichnis,
                 * unter das vorige Bild), während der Textkasten oben blieb:
                 * Am geseedeten Bericht gemessen begann das Bild bei y=1596,
                 * sein Text schon bei y=1381 und war 54 px später zu Ende. Das
                 * Bild hing dann ohne eine Zeile neben sich in der Luft — genau
                 * das, was ein Umfluss verhindern soll.
                 *
                 * Deshalb umschließt `.bildlauf` (display: flow-root) das Bild
                 * zusammen mit dem unmittelbar folgenden Textblock. Der Kasten
                 * rückt als Ganzes nach unten, Bild und Text beginnen auf
                 * derselben Höhe, und weil er den Float einschließt, kann kein
                 * späterer Block in ihn hineinlaufen. Folgt kein Text, steht das
                 * Bild allein im Kasten — dann gibt es nichts zu umfließen.
                 */
                const bloecke = zuRenderBloecken(full.blocks);
                const ausgabe = [];
                for (let i = 0; i < bloecke.length; i++) {
                  const b = bloecke[i];
                  if (b.art === "text") {
                    ausgabe.push(
                      <div
                        key={i}
                        className="prose-content"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(b.markdown),
                        }}
                      />,
                    );
                    continue;
                  }
                  if (b.art === "bild") {
                    const bilder = b.imageIds
                      .map((id) => full.blockImages[id])
                      .filter((img) => img !== undefined);
                    const naechster = bloecke[i + 1];
                    const mitText = naechster?.art === "text" ? naechster : undefined;
                    if (mitText) i++; // wird hier mitgerendert
                    ausgabe.push(
                      <div key={i} className="bildlauf">
                        <Bildplatz
                          images={bilder}
                          groesse={b.groesse}
                          platz={b.platz}
                        />
                        {mitText && (
                          <div
                            className="prose-content"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdown(mitText.markdown),
                            }}
                          />
                        )}
                      </div>,
                    );
                    continue;
                  }
                  const r = full.restaurants[b.index];
                  if (r)
                    ausgabe.push(
                      <div key={i} className="md:clear-left">
                        <RestaurantCard r={r} similarByDish={similarByDish} />
                      </div>,
                    );
                }
                return ausgabe;
              })()}
            </div>
          )}

          {/* Die Galerie ist keine eigene Erfindung mehr, sondern dieselbe
              Reihe mit Umbruch. Das starre 2er-Raster ließ neben einem Hochbild
              eine Lücke stehen, weil die Zeilenhöhe aus dem Raster kam statt
              aus den Bildern; hier bezieht jede Zeile ihre Höhe aus ihrem
              Inhalt und ist deshalb immer voll. */}
          {full.images.length > 0 && (
            <GalleryLightbox
              images={full.images.map((img) => ({
                ...img,
                thumb: {
                  sizes: galerieSizes(seitenverhaeltnis(img.width, img.height)),
                  frameStyle: arStil(img),
                },
              }))}
              thumbSizes={vollbildSizes()}
              groupClassName="bildgalerie md:clear-both"
            />
          )}

          {remainingRestaurants.length > 0 && (
            <div className="md:clear-left">
              {/* Trenner mit Marke statt schlichter Linie: Linie links, Gabel
                  und Messer über Kreuz, Linie rechts. Dasselbe Muster trägt
                  schon das Zeit-Band im Rezept (recipe-view.tsx) — ein Haus,
                  eine Sprache. aria-hidden: rein schmückend, die Überschrift
                  darunter benennt die Sektion für Screenreader.
                  Zur Größe h-9 (36 px) siehe icon-besteck.tsx. */}
              <div className="mb-8 flex items-center gap-4" aria-hidden>
                <span className="h-px flex-1 bg-ink/10" />
                <IconBesteck className="h-9 w-9 shrink-0 text-ink-soft" />
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
                    />
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
