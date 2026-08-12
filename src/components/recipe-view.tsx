/**
 * Rezept-Karte im Tiny-Salt-Stil: Hero mit runden Aktions-Buttons,
 * Serifen-Titel, Icon-Meta-Zeile, zweispaltig Equipment/Zutaten mit
 * grünen Häkchen, nummerierte Schritte (grüne Kreise), Notizen-Box
 * und Tag-Zeile. Mengen werden serverseitig für die Originalportionen
 * gerendert; der Portionsrechner (Client) skaliert über data-Attribute.
 */
import Link from "next/link";
import type { FullRecipe } from "@/lib/recipes";
import { formatAmount } from "@/lib/servings";
import { renderMarkdown } from "@/lib/markdown";
import { t } from "@/i18n/de";
import { ResponsiveImg } from "./responsive-img";
import { ServingsControl } from "./servings-control";
import { HeroActions } from "./hero-actions";
import { IconClock, IconTag } from "./icons";

const dict = t();
const r = dict.recipe;

/** Eine Zeitangabe im Zeit-Band: Beschriftung oben, Wert darunter betont. */
function TimeItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    // flex-1 statt fester Rasterspalte: fehlt eine der drei Zeiten (Rezept
    // ohne Vorbereitungs- oder Kochzeit), teilen sich die verbliebenen die
    // Breite gleichmäßig, statt eine leere Spalte stehen zu lassen.
    <div className="flex-1">
      {/* Auf dem Handy eine Stufe kleiner: „Vorbereitung" ist das längste
          Wort und soll auch in einer Drittel-Spalte einzeilig bleiben. */}
      <p className="text-xs text-ink-soft sm:text-sm">{label}</p>
      <p className="mt-1 font-display text-lg font-bold sm:text-xl">
        {children}
      </p>
    </div>
  );
}

function SerifHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-2xl font-bold md:text-3xl">
      {children}
    </h2>
  );
}

export function RecipeView({
  full,
  interactive = true,
  extraActions,
}: {
  full: FullRecipe;
  /** false in der Druckansicht: keine Client-Buttons */
  interactive?: boolean;
  /** z. B. Like-Button */
  extraActions?: React.ReactNode;
}) {
  const { recipe } = full;
  const containerId = `rezept-${recipe.id}`;

  const minutes = (m: number) => {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (h === 0) return `${rest} ${r.minutes}`;
    return rest === 0 ? `${h} Std.` : `${h} Std. ${rest} ${r.minutes}`;
  };

  // Tag-Zeile: Kategorie, Küche, Ernährungsform und Schlagwörter — jeweils als
  // Link zur gefilterten Suche (kcal steht oben im Kennzahlen-Block).
  type TagRow = {
    key: string;
    label: string;
    items: Array<{ name: string; href: string }>;
  };
  const filterRow = (
    items: Array<{ name: string; slug: string }>,
    label: string,
    param: string,
    key: string,
  ): TagRow | null =>
    items.length
      ? {
          key,
          label,
          items: items.map((it) => ({
            name: it.name,
            href: `/suche?${param}=${encodeURIComponent(it.slug)}`,
          })),
        }
      : null;
  const tagRows: TagRow[] = [
    filterRow(full.categories, r.course, "kategorie", "c"),
    filterRow(full.cuisines, r.cuisineShort, "kueche", "cu"),
    filterRow(full.dietTypes, r.dietShort, "ernaehrung", "d"),
    filterRow(full.tags, r.keywords, "schlagwort", "t"),
  ].filter((row): row is TagRow => row !== null);

  return (
    <article
      id={containerId}
      className="mx-auto max-w-4xl overflow-hidden bg-white shadow-sm print:shadow-none"
    >
      {/* Hero mit Aktions-Buttons */}
      {full.heroImage && (
        <div className="relative">
          <ResponsiveImg
            image={full.heroImage}
            // Der Hero füllt die Artikelbreite — der Artikel ist auf Desktop
            // bewusst schmaler als das Layout (max-w-4xl → 896 px Lesebreite).
            sizes="(max-width: 928px) calc(100vw - 2rem), 896px"
            priority
            // 4:3 wie die Kacheln; auf großen Screens die Höhe deckeln, damit der
            // Hero nicht überproportional groß wird (object-cover beschneidet).
            className="aspect-[4/3] max-h-[28rem] w-full object-cover"
          />
          {interactive && (
            <HeroActions
              title={recipe.title}
              publicPath={`/rezepte/${recipe.slug}`}
              printPath={`/drucken/rezepte/${recipe.slug}`}
            />
          )}
        </div>
      )}

      <div className="p-6 md:p-10">
        <header>
          <h1 className="font-display text-3xl font-bold md:text-[2.6rem] md:leading-tight">
            {recipe.title}
          </h1>
          {recipe.teaser && (
            <div
              className="prose-content mt-4 text-ink-soft"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(recipe.teaser) }}
            />
          )}

          {/* Zeit-Band: dünne Linie, in deren Mitte dieselbe Uhr sitzt, die
              zuvor in den runden Chips stand. Darunter die drei Zeiten in
              EINER Reihe (Vorbereitung → Kochzeit → Gesamtzeit) — auf jeder
              Breite nebeneinander, auf dem Handy mit engerem Abstand und eine
              Schriftstufe kleiner, damit die drei Spalten dort passen.
              Den früheren Chip-Block über dem Trenner gibt es nicht mehr:
              Portionen und Kalorien stehen jetzt unter „Zutaten" (dort werden
              sie gebraucht), die Schwierigkeit neben dem Equipment. */}
          <div className="mt-8 flex items-center gap-4" aria-hidden>
            <span className="h-px flex-1 bg-ink/10" />
            <IconClock className="h-6 w-6 shrink-0 text-ink-soft" />
            <span className="h-px flex-1 bg-ink/10" />
          </div>
          <div className="mt-5 flex gap-2 text-center sm:gap-5">
            {recipe.prepMinutes > 0 && (
              <TimeItem label={r.metaPrep}>{minutes(recipe.prepMinutes)}</TimeItem>
            )}
            {recipe.cookMinutes > 0 && (
              <TimeItem label={r.metaCook}>{minutes(recipe.cookMinutes)}</TimeItem>
            )}
            <TimeItem label={r.metaTotal}>{minutes(recipe.totalMinutes)}</TimeItem>
          </div>

          {extraActions && (
            <div className="mt-5 print:hidden">{extraActions}</div>
          )}
        </header>

        <hr className="my-8 border-ink/10" />

        {/* Der Equipment-Bereich ist in der öffentlichen Ansicht bewusst
            NICHT gerendert (Wunsch 08/2026, vorerst ausgeblendet). Die Daten
            selbst bleiben unangetastet: im Admin weiter pflegbar, im Export
            enthalten und in den strukturierten Daten als schema.org "tool"
            ausgeliefert. Zum Wiedereinblenden reicht ein Revert des Commits,
            der diesen Block entfernt hat. */}

        {/* Zutaten neben der Zubereitung: ab Tablet zweispaltig, damit man die
            Mengen beim Kochen im Blick behält, ohne zu scrollen. Die Zutaten
            bekommen die schmalere Spalte (kurze Zeilen), die Zubereitung die
            breitere (Fließtext + Schrittbilder). Mobil bleibt es gestapelt.
            Kein oberer Abstand: das <hr> darüber trennt bereits. */}
        <div className="grid gap-10 md:grid-cols-[2fr_3fr]">
          <section>
            <SerifHeading>{r.ingredients}</SerifHeading>
            {/* Wofür die Mengen gelten: Portionen (mit Rechner) und Kalorien
                direkt unter der Überschrift — dort, wo man sie beim Einkaufen
                und Abwiegen tatsächlich braucht. */}
            <div className="mt-2 text-sm text-ink-soft">
              {/* Zwei eigene Zeilen statt einer mit Trennpunkt: die Spalte ist
                  schmal, und ein umbrechendes „·" bliebe am Zeilenende hängen. */}
              <p className="flex flex-wrap items-center gap-2">
                {r.servingsPrefix}
                {interactive ? (
                  <ServingsControl
                    baseServings={recipe.servings}
                    containerId={containerId}
                  />
                ) : (
                  <strong className="font-semibold text-ink">
                    {recipe.servings}
                  </strong>
                )}
                {r.metaServings}
              </p>
              {recipe.kcal != null && (
                <p className="mt-1">
                  {recipe.kcal} {r.kcalUnit} {r.perServing}
                </p>
              )}
            </div>
            <div className="mt-5 flex flex-col gap-5">
              {full.sections
                .filter((s) => s.ingredients.length > 0)
                .map((section) => (
                  <div key={`ing-${section.id}`}>
                    {section.name && (
                      <h3 className="mb-2 font-display text-lg font-bold">
                        {section.name}
                      </h3>
                    )}
                    {/* Bewusst OHNE Häkchen-Symbol: die Mengen sollen ruhig und
                        gut abtastbar sein. Die Häkchen bleiben dem Equipment
                        vorbehalten, wo sie eine Abhak-Liste sind. */}
                    <ul className="flex flex-col gap-3">
                      {section.ingredients.map((ing) => (
                        <li key={ing.id} className="leading-relaxed">
                          <span data-menge={ing.amount ?? undefined} data-einheit={ing.unit}>
                            {ing.amount !== null
                              ? formatAmount(ing.amount, ing.unit)
                              : ""}
                          </span>
                          {ing.amount !== null && ing.unit ? ` ${ing.unit} ` : " "}
                          <strong className="font-semibold">{ing.name}</strong>
                          {ing.amount === null && (
                            <span className="text-ink-soft"> ({r.toTaste})</span>
                          )}
                          {ing.note && (
                            <span className="text-ink-soft"> ({ing.note})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </section>

          {/* Zubereitung — zweite Spalte desselben Rasters */}
          <section>
            <SerifHeading>{r.preparation}</SerifHeading>
            {/* Die Schwierigkeit gehört zum Kochen, nicht zum Einkauf: sie
                steht unter „Zubereitung" — spiegelbildlich zu Portionen und
                Kalorien unter „Zutaten". */}
            <p className="mt-2 text-sm text-ink-soft">
              {r.metaDifficulty}:{" "}
              <strong className="font-semibold text-ink">
                {dict.admin.recipes.difficulties[recipe.difficulty] ??
                  recipe.difficulty}
              </strong>
            </p>
          {(() => {
            let step = 0;
            return full.sections
              .filter((s) => s.steps.length > 0)
              .map((section) => (
                <div key={`steps-${section.id}`} className="mt-6">
                  {section.name && (
                    <h3 className="mb-3 font-display text-lg font-bold">
                      {section.name}
                    </h3>
                  )}
                  <ol className="flex list-none flex-col gap-6">
                    {section.steps.map((st) => {
                      step += 1;
                      return (
                        <li key={st.id} className="flex gap-4">
                          <span
                            aria-hidden
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-base font-semibold text-white"
                          >
                            {step}
                          </span>
                          <div className="min-w-0 flex-1 pt-1.5">
                            <div
                              className="prose-content"
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdown(st.text),
                              }}
                            />
                            {st.image && (
                              <ResponsiveImg
                                image={st.image}
                                // max-w-sm (384 px); mobil abzüglich Layout-,
                                // Artikel-Padding und Schritt-Einrückung.
                                sizes="(max-width: 640px) calc(100vw - 8rem), 384px"
                                className="mt-3 w-full max-w-sm object-cover"
                              />
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ));
          })()}
          </section>
        </div>

        {/* Notizen / Tipps */}
        {(recipe.tips || full.publicNotes.length > 0) && (
          <section className="mt-10 bg-cream-deep/60 p-6 md:p-8">
            <h2 className="font-display text-2xl font-bold">
              {r.notes}
            </h2>
            {recipe.tips && (
              <div
                className="prose-content mt-3"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(recipe.tips) }}
              />
            )}
            {full.publicNotes.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {full.publicNotes.map((n) => (
                  <li key={n.id} className="leading-relaxed">
                    {n.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Tag-Zeile: Kategorie · Küche · Ernährungsform · Schlagwörter — jeder
            Eintrag als Link zur gefilterten Suche. */}
        {tagRows.length > 0 && (
          <footer className="mt-8 flex flex-wrap gap-x-8 gap-y-3 border-t border-ink/10 pt-6 text-sm">
            {tagRows.map((row) => (
              <p key={row.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span aria-hidden className="text-ink-soft">
                  <IconTag className="h-4 w-4" />
                </span>
                <strong className="font-semibold">{row.label}:</strong>
                {row.items.map((it, i) => (
                  <span key={it.href}>
                    <Link
                      href={it.href}
                      className="font-medium text-leaf underline-offset-2 hover:underline"
                    >
                      {it.name}
                    </Link>
                    {i < row.items.length - 1 && (
                      <span className="text-ink-soft">,</span>
                    )}
                  </span>
                ))}
              </p>
            ))}
          </footer>
        )}
      </div>
    </article>
  );
}
