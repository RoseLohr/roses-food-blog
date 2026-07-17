/**
 * „Ernährungsform-Box" in der rechten Seitenleiste der Startseite
 * (konfigurierbar im Startseiten-Admin): weiße Karte im Stil der übrigen
 * Seitenleisten-Boxen, innen der Teal-Titelkasten mit Dreieck als
 * Wiedererkennungsmerkmal, darunter kompakte Rezept-Einträge mit rundem
 * Vorschaubild, Name und Kategorie(n) — ohne Ernährungsform in der
 * Unterzeile (die steht schon im Titel).
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
    <section className="bg-white p-5 shadow-sm">
      {/* Titel-Kasten mit nach unten weisendem Dreieck (Teal) */}
      <div className="relative border border-leaf px-4 py-2.5 text-center">
        <h2 className="text-sm font-bold uppercase tracking-[0.22em] text-ink">
          {title}
        </h2>
        <span
          aria-hidden
          className="absolute -bottom-2 left-1/2 h-0 w-0 -translate-x-1/2 border-x-8 border-t-8 border-x-transparent border-t-leaf"
        />
      </div>

      <ul className="mt-6 flex flex-col gap-4">
        {items.map((it) => (
          <li key={it.slug}>
            <Link
              href={`/rezepte/${it.slug}`}
              className="group flex items-center gap-3"
            >
              {it.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.thumbUrl}
                  alt=""
                  width={56}
                  height={56}
                  loading="lazy"
                  className="h-14 w-14 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="h-14 w-14 shrink-0 rounded-full bg-cream"
                />
              )}
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-snug text-ink group-hover:text-leaf">
                  {it.title}
                </span>
                {it.subtitle && (
                  <span className="mt-0.5 block text-xs text-ink-soft">
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
