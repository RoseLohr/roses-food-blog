import Link from "next/link";
import { NewsletterSection } from "@/components/newsletter-section";
import { t } from "@/i18n/de";

const dict = t();

const NAV: Array<[string, string]> = [
  ["/rezepte", dict.nav.recipes],
  ["/reisen", dict.nav.travel],
  ["/ueber-mich", dict.nav.about],
  ["/suche", dict.nav.search],
];

export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg"
      >
        {dict.site.skipToContent}
      </a>
      <header className="border-b border-ink/10 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/"
            className="font-display text-xl font-bold text-rose-primary"
          >
            {dict.site.name}
          </Link>
          <nav aria-label={dict.nav.menu}>
            <ul className="flex flex-wrap items-center gap-1 md:gap-2">
              {NAV.map(([href, label]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-cream hover:text-rose-primary"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <div id="inhalt" className="mx-auto w-full max-w-6xl grow px-4 py-8">
        {children}
      </div>

      <footer className="mt-auto border-t border-ink/10 bg-white print:hidden">
        <div className="mx-auto max-w-6xl px-4 pt-8">
          <div className="max-w-md">
            <NewsletterSection source={dict.newsletter.sourceFooter} compact />
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-ink-soft">
          <p>
            © {new Date().getFullYear()} {dict.site.name}. {dict.footer.rights}
          </p>
          <ul className="flex gap-4">
            <li>
              <Link href="/ueber-mich" className="hover:text-rose-primary">
                {dict.footer.aboutMe}
              </Link>
            </li>
            <li>
              <Link href="/datenschutz" className="hover:text-rose-primary">
                {dict.footer.privacy}
              </Link>
            </li>
            <li>
              <Link href="/impressum" className="hover:text-rose-primary">
                {dict.footer.imprint}
              </Link>
            </li>
          </ul>
        </div>
      </footer>
    </>
  );
}
