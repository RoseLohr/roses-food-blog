/**
 * Vollständige Rezeptansicht (Server-Komponente). Genutzt von der
 * öffentlichen Rezeptseite, der Admin-Vorschau und der Druckansicht.
 * Mengen werden serverseitig für die Originalportionen gerendert;
 * der Portionsrechner (Client) skaliert sie über data-Attribute.
 */
import type { FullRecipe } from "@/lib/recipes";
import { formatAmount } from "@/lib/servings";
import { renderMarkdown } from "@/lib/markdown";
import { t } from "@/i18n/de";
import { ResponsiveImg } from "./responsive-img";
import { ServingsControl } from "./servings-control";
import { ShareButtons } from "./share-buttons";

const dict = t();

function Chips({ label, items }: { label: string; items: Array<{ id: number; name: string; slug: string }>; }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="font-medium text-ink-soft">{label}:</span>
      {items.map((item) => (
        <span key={item.id} className="rounded-full bg-cream px-2.5 py-0.5">
          {item.name}
        </span>
      ))}
    </div>
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
  /** z. B. Like-Button (E7) */
  extraActions?: React.ReactNode;
}) {
  const { recipe } = full;
  const containerId = `rezept-${recipe.id}`;
  const url = `${baseUrl}/rezepte/${recipe.slug}`;

  const meta: Array<[string, string]> = [
    [dict.recipe.prepTime, `${recipe.prepMinutes} ${dict.recipe.minutes}`],
    [dict.recipe.cookTime, `${recipe.cookMinutes} ${dict.recipe.minutes}`],
    [dict.recipe.totalTime, `${recipe.totalMinutes} ${dict.recipe.minutes}`],
    [
      dict.recipe.difficulty,
      dict.admin.recipes.difficulties[recipe.difficulty] ?? recipe.difficulty,
    ],
  ];
  if (recipe.kcal) meta.push([dict.recipe.kcalPerServing, String(recipe.kcal)]);

  return (
    <article id={containerId} className="mx-auto max-w-3xl">
      <header>
        <h1 className="font-display text-3xl font-bold md:text-4xl">
          {recipe.title}
        </h1>
        {recipe.teaser && (
          <p className="mt-3 text-lg text-ink-soft">{recipe.teaser}</p>
        )}
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {meta.map(([label, value]) => (
            <div key={label} className="flex gap-1.5">
              <dt className="font-medium text-ink-soft">{label}:</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-col gap-1.5">
          <Chips label={dict.recipe.categories} items={full.categories} />
          <Chips label={dict.recipe.diet} items={full.dietTypes} />
          <Chips label={dict.recipe.cuisine} items={full.cuisines} />
          <Chips label={dict.recipe.equipment} items={full.equipment} />
          <Chips label={dict.recipe.tagsLabel} items={full.tags} />
        </div>
      </header>

      {full.heroImage && (
        <div className="mt-6 overflow-hidden rounded-2xl">
          <ResponsiveImg
            image={full.heroImage}
            sizes="(max-width: 768px) 100vw, 768px"
            priority
            className="w-full object-cover"
          />
        </div>
      )}

      {interactive && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <ServingsControl
            baseServings={recipe.servings}
            containerId={containerId}
          />
          <div className="flex items-center gap-2">
            {extraActions}
            <ShareButtons
              title={recipe.title}
              url={url}
              printPath={`/drucken/rezepte/${recipe.slug}`}
            />
          </div>
        </div>
      )}
      {!interactive && (
        <p className="mt-4 text-sm font-medium">
          {recipe.servings}{" "}
          {recipe.servings === 1 ? dict.recipe.servingsOne : dict.recipe.servings}
        </p>
      )}

      {/* Zutaten */}
      <section className="mt-8">
        <h2 className="font-display text-2xl font-bold">
          {dict.recipe.ingredients}
        </h2>
        {full.sections
          .filter((s) => s.ingredients.length > 0)
          .map((section) => (
            <div key={`ing-${section.id}`} className="mt-4">
              {section.name && (
                <h3 className="mb-2 font-semibold">{section.name}</h3>
              )}
              <ul className="flex flex-col gap-1.5 border-l-2 border-rose-primary/30 pl-4">
                {section.ingredients.map((ing) => (
                  <li key={ing.id} className="flex flex-wrap gap-1.5">
                    <span className="min-w-16 font-medium tabular-nums">
                      <span data-menge={ing.amount ?? undefined} data-einheit={ing.unit}>
                        {ing.amount !== null
                          ? formatAmount(ing.amount, ing.unit)
                          : ""}
                      </span>
                      {ing.amount !== null && ing.unit ? ` ${ing.unit}` : ""}
                      {ing.amount === null && (
                        <span className="font-normal text-ink-soft">
                          {dict.recipe.toTaste}
                        </span>
                      )}
                    </span>
                    <span>
                      {ing.name}
                      {ing.note && (
                        <span className="text-ink-soft"> ({ing.note})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </section>

      {/* Zubereitung */}
      <section className="mt-8">
        <h2 className="font-display text-2xl font-bold">
          {dict.recipe.preparation}
        </h2>
        {full.sections
          .filter((s) => s.steps.length > 0)
          .map((section) => (
            <div key={`steps-${section.id}`} className="mt-4">
              {section.name && (
                <h3 className="mb-2 font-semibold">{section.name}</h3>
              )}
              <ol className="flex list-none flex-col gap-3">
                {section.steps.map((step, i) => (
                  <li key={step.id} className="flex gap-3">
                    <span
                      aria-hidden
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-primary text-sm font-bold text-white"
                    >
                      {i + 1}
                    </span>
                    <p className="pt-0.5">{step.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
      </section>

      {/* Weitere Bilder */}
      {full.images.length > 0 && (
        <section className="mt-8 grid grid-cols-2 gap-3 print:hidden">
          {full.images.map((img) => (
            <ResponsiveImg
              key={img.id}
              image={img}
              sizes="(max-width: 768px) 50vw, 384px"
              className="w-full rounded-xl object-cover"
            />
          ))}
        </section>
      )}

      {/* Tipps & Varianten */}
      {recipe.tips && (
        <section className="mt-8 rounded-2xl bg-cream p-5">
          <h2 className="font-display text-xl font-bold">{dict.recipe.tips}</h2>
          <div
            className="prose-content mt-2"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(recipe.tips) }}
          />
        </section>
      )}

      {/* Öffentliche Notizen */}
      {full.publicNotes.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-xl font-bold">{dict.recipe.notes}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {full.publicNotes.map((n) => (
              <li key={n.id} className="rounded-xl border border-ink/10 p-3 text-sm">
                {n.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
