/**
 * Reisebericht im Tiny-Salt-Stil: weiße Karte mit Hero-Bild und
 * Teilen-Button, Serifen-Titel, Icon-Meta-Zeile (Land/Reiseziel),
 * Markdown-Inhalt, Restaurants mit Gerichten (Bild links, Zutaten
 * mit Tag-Icon) und Bildergalerie.
 */
import type { FullTravelPost } from "@/lib/travel";
import { renderMarkdown } from "@/lib/markdown";
import { getBaseUrl } from "@/lib/base-url";
import { t } from "@/i18n/de";
import { ResponsiveImg } from "./responsive-img";
import { HeroActions } from "./hero-actions";
import { IconCity, IconCountry, IconRegion, IconTag } from "./icons";

const dict = t();

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

export function TravelView({
  full,
  interactive = true,
}: {
  full: FullTravelPost;
  interactive?: boolean;
}) {
  const { post } = full;
  const url = `${getBaseUrl()}/reisen/${post.slug}`;

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
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-[2.6rem] md:leading-tight">
            {post.title}
          </h1>
          {post.teaser && (
            <div
              className="prose-content mt-4 text-ink-soft"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(post.teaser) }}
            />
          )}
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4">
            {post.country && (
              <MetaChip
                label={dict.admin.travel.fieldCountry}
                icon={<IconCountry className="h-5 w-5" />}
              >
                {post.country}
              </MetaChip>
            )}
            {post.region && (
              <MetaChip
                label={dict.admin.travel.fieldRegion}
                icon={<IconRegion className="h-5 w-5" />}
              >
                {post.region}
              </MetaChip>
            )}
            {post.city && (
              <MetaChip
                label={dict.admin.travel.fieldCity}
                icon={<IconCity className="h-5 w-5" />}
              >
                {post.city}
              </MetaChip>
            )}
          </div>
        </header>

        {post.content && (
          <>
            <hr className="my-8 border-ink/10" />
            <div
              className="prose-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
            />
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

        {full.restaurants.length > 0 && (
          <>
            <hr className="my-8 border-ink/10" />
            <section>
              <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
                {dict.travelList.restaurantsTitle}
              </h2>
              <div className="mt-6 flex flex-col gap-8">
                {full.restaurants.map((r) => (
                  <div key={r.id}>
                    <h3 className="font-display text-xl font-bold">
                      {r.name}
                      {r.city && (
                        <span className="ml-2 text-sm font-normal text-ink-soft">
                          · {r.city}
                        </span>
                      )}
                    </h3>
                    {r.image && (
                      <div className="mt-3 sm:max-w-sm">
                        <ResponsiveImg
                          image={r.image}
                          sizes="(max-width: 640px) 100vw, 384px"
                          className="aspect-[3/2] w-full object-cover"
                        />
                      </div>
                    )}
                    {r.description && (
                      <div
                        className="prose-content mt-2 text-ink-soft"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(r.description),
                        }}
                      />
                    )}
                    <ul className="mt-4 flex flex-col gap-5">
                      {r.dishes.map((dish) => (
                        <li
                          key={dish.id}
                          className="flex flex-col gap-4 bg-cream/60 p-4 sm:flex-row"
                        >
                          {dish.images[0] && (
                            <div className="sm:w-44 sm:shrink-0">
                              <ResponsiveImg
                                image={dish.images[0]}
                                sizes="(max-width: 640px) 100vw, 176px"
                                className="aspect-[4/3] w-full object-cover"
                              />
                            </div>
                          )}
                          <div>
                            <h4 className="font-semibold">{dish.name}</h4>
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
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </article>
  );
}
