/**
 * Rezept-Karte im Tiny-Salt-Stil: Hero mit runden Aktions-Buttons,
 * Serifen-Titel, Icon-Meta-Zeile, zweispaltig Equipment/Zutaten mit
 * grünen Häkchen, nummerierte Schritte (grüne Kreise), Notizen-Box
 * und Tag-Zeile. Mengen werden serverseitig für die Originalportionen
 * gerendert; der Portionsrechner (Client) skaliert über data-Attribute.
 */
import type { FullRecipe } from "@/lib/recipes";
import { formatAmount } from "@/lib/servings";
import { renderMarkdown } from "@/lib/markdown";
import { t } from "@/i18n/de";
import { ResponsiveImg } from "./responsive-img";
import { ServingsControl } from "./servings-control";
import { HeroActions } from "./hero-actions";
import {
  IconCheck,
  IconClock,
  IconFlame,
  IconServings,
  IconTag,
} from "./icons";

const dict = t();
const r = dict.recipe;

function MetaChip({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
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

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <IconCheck className="mt-1 h-4 w-4 shrink-0 text-leaf" />
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function SerifHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
      {children}
    </h2>
  );
}

export function RecipeView({
  full,
  baseUrl,
  interactive = true,
  extraActions,
}: {
  full: FullRecipe;
  baseUrl: string;
  /** false in der Druckansicht: keine Client-Buttons */
  interactive?: boolean;
  /** z. B. Like-Button */
  extraActions?: React.ReactNode;
}) {
  const { recipe } = full;
  const containerId = `rezept-${recipe.id}`;
  const url = `${baseUrl}/rezepte/${recipe.slug}`;

  const minutes = (m: number) => {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (h === 0) return `${rest} ${r.minutes}`;
    return rest === 0 ? `${h} Std.` : `${h} Std. ${rest} ${r.minutes}`;
  };

  // kcal wird oben im Kennzahlen-Block gezeigt (nicht mehr in der Tag-Zeile).
  const tagRows: Array<[React.ReactNode, string, string] | null> = [
    full.categories.length
      ? [
          <IconTag key="c" className="h-4 w-4" />,
          r.course,
          full.categories.map((c) => c.name).join(", "),
        ]
      : null,
    full.cuisines.length
      ? [
          <IconTag key="cu" className="h-4 w-4" />,
          r.cuisineShort,
          full.cuisines.map((c) => c.name).join(", "),
        ]
      : null,
    full.dietTypes.length
      ? [
          <IconTag key="d" className="h-4 w-4" />,
          r.dietShort,
          full.dietTypes.map((d) => d.name).join(", "),
        ]
      : null,
    full.tags.length
      ? [
          <IconTag key="t" className="h-4 w-4" />,
          r.keywords,
          full.tags.map((tg) => tg.name).join(", "),
        ]
      : null,
  ];

  return (
    <article
      id={containerId}
      className="overflow-hidden bg-white shadow-sm print:shadow-none"
    >
      {/* Hero mit Aktions-Buttons */}
      {full.heroImage && (
        <div className="relative">
          <ResponsiveImg
            image={full.heroImage}
            sizes="(max-width: 820px) 100vw, 768px"
            priority
            // 4:3 wie die Kacheln; auf großen Screens die Höhe deckeln, damit der
            // Hero nicht überproportional groß wird (object-cover beschneidet).
            className="aspect-[4/3] max-h-[28rem] w-full object-cover"
          />
          {interactive && (
            <HeroActions
              title={recipe.title}
              url={url}
              printPath={`/drucken/rezepte/${recipe.slug}`}
            />
          )}
        </div>
      )}

      <div className="p-6 md:p-10">
        <header>
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-[2.6rem] md:leading-tight">
            {recipe.title}
          </h1>
          {recipe.teaser && (
            <div
              className="prose-content mt-4 text-ink-soft"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(recipe.teaser) }}
            />
          )}

          {/* Meta-Zeile: festes 2-Spalten-Raster, damit die Spalten sauber
              untereinander fluchten (Paare: Portionen+Kalorien,
              Vorbereitung+Kochzeit, Gesamtzeit+Schwierigkeit) */}
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
            <MetaChip icon={<IconServings className="h-5 w-5" />} label={r.metaServings}>
              {interactive ? (
                <ServingsControl
                  baseServings={recipe.servings}
                  containerId={containerId}
                />
              ) : (
                // Nur die Zahl — „Portionen" steht bereits als Chip-Label.
                <>{recipe.servings}</>
              )}
            </MetaChip>
            {/* Kalorien direkt neben den Portionen (auf Wunsch) */}
            {recipe.kcal != null && (
              <MetaChip icon={<IconFlame className="h-5 w-5" />} label={r.calories}>
                {recipe.kcal} {r.kcalUnit} {r.perServing}
              </MetaChip>
            )}
            {recipe.prepMinutes > 0 && (
              <MetaChip icon={<IconClock className="h-5 w-5" />} label={r.metaPrep}>
                {minutes(recipe.prepMinutes)}
              </MetaChip>
            )}
            {recipe.cookMinutes > 0 && (
              <MetaChip icon={<IconClock className="h-5 w-5" />} label={r.metaCook}>
                {minutes(recipe.cookMinutes)}
              </MetaChip>
            )}
            <MetaChip icon={<IconClock className="h-5 w-5" />} label={r.metaTotal}>
              {minutes(recipe.totalMinutes)}
            </MetaChip>
            <MetaChip icon={<IconFlame className="h-5 w-5" />} label={r.metaDifficulty}>
              {dict.admin.recipes.difficulties[recipe.difficulty] ?? recipe.difficulty}
            </MetaChip>
          </div>

          {extraActions && (
            <div className="mt-5 print:hidden">{extraActions}</div>
          )}
        </header>

        <hr className="my-8 border-ink/10" />

        {/* Equipment + Zutaten */}
        <div className="grid gap-10 md:grid-cols-[2fr_3fr]">
          {full.equipment.length > 0 && (
            <section>
              <SerifHeading>{r.equipmentHeading}</SerifHeading>
              <ul className="mt-5 flex flex-col gap-3">
                {full.equipment.map((e) => (
                  <CheckItem key={e.id}>{e.name}</CheckItem>
                ))}
              </ul>
            </section>
          )}
          <section className={full.equipment.length === 0 ? "md:col-span-2" : ""}>
            <SerifHeading>{r.ingredients}</SerifHeading>
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
                    <ul className="flex flex-col gap-3">
                      {section.ingredients.map((ing) => (
                        <CheckItem key={ing.id}>
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
                        </CheckItem>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </section>
        </div>

        <hr className="my-8 border-ink/10" />

        {/* Zubereitung */}
        <section>
          <SerifHeading>{r.preparation}</SerifHeading>
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
                                sizes="(max-width: 640px) 100vw, 400px"
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

        {/* Notizen / Tipps */}
        {(recipe.tips || full.publicNotes.length > 0) && (
          <section className="mt-10 bg-cream-deep/60 p-6 md:p-8">
            <h2 className="font-display text-2xl font-bold tracking-tight">
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

        {/* Tag-Zeile */}
        {tagRows.some(Boolean) && (
          <footer className="mt-8 flex flex-wrap gap-x-8 gap-y-3 border-t border-ink/10 pt-6 text-sm">
            {tagRows.filter(Boolean).map((row) => {
              const [icon, label, value] = row!;
              return (
                <p key={label} className="flex items-center gap-2">
                  <span aria-hidden className="text-ink-soft">
                    {icon}
                  </span>
                  <strong className="font-semibold">{label}:</strong>
                  <span className="text-ink-soft">{value}</span>
                </p>
              );
            })}
          </footer>
        )}
      </div>
    </article>
  );
}
