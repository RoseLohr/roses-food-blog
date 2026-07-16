/**
 * „Ernährungsform-Box" auf der Startseite (konfigurierbar im Startseiten-Admin):
 * Titel-Kasten mit Pfeil, darunter eine Liste von Rezepten einer Ernährungsform
 * mit rundem Vorschaubild, Name und „Kategorie / Ernährungsform". Farben im
 * Blog-Schema (Teal-Akzent).
 */
import Link from "next/link";

export interface DietBoxItem {
  slug: string;
  title: string;
  thumbUrl: string | null;
  subtitle: string;
}

export function DietBox({
  title,
  items,
}: {
  title: string;
  items: DietBoxItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-10">
      {/* Titel-Kasten mit nach unten weisendem Dreieck (Teal) */}
      <div className="relative border border-leaf px-6 py-4 text-center">
        <h2 className="text-lg font-bold uppercase tracking-[0.25em] text-ink">
          {title}
        </h2>
        <span
          aria-hidden
          className="absolute -bottom-2 left-1/2 h-0 w-0 -translate-x-1/2 border-x-8 border-t-8 border-x-transparent border-t-leaf"
        />
      </div>

      <ul className="mt-8 flex flex-col gap-6">
        {items.map((it) => (
          <li key={it.slug}>
            <Link
              href={`/rezepte/${it.slug}`}
              className="group flex items-center gap-5"
            >
              {it.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.thumbUrl}
                  alt=""
                  width={80}
                  height={80}
                  loading="lazy"
                  className="h-20 w-20 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="h-20 w-20 shrink-0 rounded-full bg-cream"
                />
              )}
              <span className="min-w-0">
                <span className="block text-xl font-semibold text-ink group-hover:text-leaf">
                  {it.title}
                </span>
                {it.subtitle && (
                  <span className="mt-1 block text-sm text-ink-soft">
                    {it.subtitle}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
