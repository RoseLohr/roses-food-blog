/**
 * Vollständige Ansicht eines Reiseberichts (Server-Komponente):
 * Inhalt (Markdown), Restaurants mit Gerichten, Bildern und Zutaten.
 * Genutzt von öffentlicher Seite und Admin-Vorschau.
 */
import type { FullTravelPost } from "@/lib/travel";
import { renderMarkdown } from "@/lib/markdown";
import { t } from "@/i18n/de";
import { ResponsiveImg } from "./responsive-img";

const dict = t();

export function TravelView({ full }: { full: FullTravelPost }) {
  const { post } = full;

  return (
    <article className="mx-auto max-w-3xl">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-rose-primary">
          {[post.country, post.destination].filter(Boolean).join(" · ")}
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold md:text-4xl">
          {post.title}
        </h1>
        {post.teaser && <p className="mt-3 text-lg text-ink-soft">{post.teaser}</p>}
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

      {post.content && (
        <div
          className="prose-content mt-6"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
        />
      )}

      {full.images.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {full.images.map((img) => (
            <ResponsiveImg
              key={img.id}
              image={img}
              sizes="(max-width: 768px) 50vw, 384px"
              className="w-full rounded-xl object-cover"
            />
          ))}
        </div>
      )}

      {full.restaurants.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl font-bold">
            {dict.travelList.restaurantsTitle}
          </h2>
          <div className="mt-4 flex flex-col gap-6">
            {full.restaurants.map((r) => (
              <div key={r.id} className="rounded-2xl bg-white p-5 shadow-sm">
                <h3 className="font-display text-xl font-bold">
                  {r.name}
                  {r.city && (
                    <span className="ml-2 text-sm font-normal text-ink-soft">
                      {r.city}
                    </span>
                  )}
                </h3>
                {r.description && (
                  <p className="mt-1 text-sm text-ink-soft">{r.description}</p>
                )}
                <ul className="mt-4 flex flex-col gap-4">
                  {r.dishes.map((dish) => (
                    <li key={dish.id} className="flex flex-col gap-3 sm:flex-row">
                      {dish.images[0] && (
                        <div className="sm:w-40 sm:shrink-0">
                          <ResponsiveImg
                            image={dish.images[0]}
                            sizes="(max-width: 640px) 100vw, 160px"
                            className="aspect-[4/3] w-full rounded-lg object-cover"
                          />
                        </div>
                      )}
                      <div>
                        <h4 className="font-semibold">{dish.name}</h4>
                        {dish.description && (
                          <p className="mt-0.5 text-sm text-ink-soft">
                            {dish.description}
                          </p>
                        )}
                        {dish.ingredients.length > 0 && (
                          <p className="mt-1.5 text-xs text-ink-soft">
                            {dict.travelList.dishIngredients}:{" "}
                            {dish.ingredients.map((i) => i.name).join(", ")}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
