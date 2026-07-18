import Link from "next/link";
import { NewsletterSection } from "@/components/newsletter-section";
import { SiteHeader } from "@/components/site-header";
import { getNavMenus } from "@/lib/nav-data";
import { t } from "@/i18n/de";

const dict = t();

export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { recipeChildren, travelChildren } = await getNavMenus();
  return (
    <>
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg"
      >
        {dict.site.skipToContent}
      </a>

      <SiteHeader
        recipeChildren={recipeChildren}
        travelChildren={travelChildren}
      />

      <div id="inhalt" className="mx-auto w-full max-w-6xl grow px-4 py-8">
        {children}
      </div>

      <footer className="mt-auto print:hidden">
        <div className="border-t border-ink/10 bg-white">
          {/* Newsletter im Footer — auf allen öffentlichen Seiten inkl.
              Startseite. */}
          <div className="mx-auto max-w-6xl px-4 pt-8">
            <NewsletterSection source={dict.newsletter.sourceFooter} />
          </div>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-ink-soft">
            <ul className="flex flex-wrap gap-4">
              <li>
                <Link href="/ueber-mich" className="hover:text-leaf">
                  {dict.footer.aboutMe}
                </Link>
              </li>
              <li>
                <Link href="/datenschutz" className="hover:text-leaf">
                  {dict.footer.privacy}
                </Link>
              </li>
              <li>
                <Link href="/impressum" className="hover:text-leaf">
                  {dict.footer.imprint}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Dunkle Fußleiste im Tiny-Salt-Stil */}
        <div className="bg-ink text-white">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-1 px-4 py-6 text-center text-sm">
            {/* Marken-Schriftzug (weiß) auf dem dunklen Band — kein Logo. */}
            <span className="mb-3 font-display text-lg font-extrabold tracking-tight text-white">
              {dict.site.name}
            </span>
            <p className="flex items-center gap-1.5 text-white/90">
              Travel, Cook &amp; Write with
              <span aria-hidden>❤️</span>
            </p>
            <p className="text-white/60">
              © {new Date().getFullYear()} {dict.site.name}. {dict.footer.rights}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
