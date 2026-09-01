"use client";

/**
 * Öffentlicher Kopfbereich im Tiny-Salt-Look:
 * - Logo-Lockup „tinysalt.studio" mit Unterzeile „Cook & Write"
 * - Runde Suchpille (Enter sucht → /suche?q=…)
 * - Menü hinter einem Hamburger-Icon (wie in der Referenz), das ein Panel
 *   mit den Navigationslinks öffnet. Tastatur- und Screenreader-tauglich
 *   (aria-expanded/-controls, Escape schließt, Fokusreihenfolge).
 * - „Rezepte" und „Reisen" tragen Dropdowns (Kategorien bzw. Reiseberichte):
 *   sie öffnen beim Hovern automatisch und lassen sich zusätzlich über einen
 *   Aufklapppfeil per Klick/Tastatur umschalten (auch im mobilen Panel).
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { SiteLogo } from "@/components/site-logo";
import type { HeaderBrand } from "@/lib/branding";
import { t } from "@/i18n/de";

const dict = t();

/**
 * Ein Menue-Unterpunkt. `children` traegt die ZWEITE Ebene — sie gibt es
 * seit 08/2026 fuer „Ernaehrung → Ernaehrungsformen → Vegan".
 */
export type NavChild = { href: string; label: string; children?: NavChild[] };

/**
 * Ein Hauptmenue-Punkt.
 *
 * `href` ist OPTIONAL: „Ernaehrung" ist eine reine Gruppenueberschrift ohne
 * eigene Seite. Ohne diese Moeglichkeit haette die Gruppe auf eine ihrer
 * Unterseiten zeigen muessen — zwei Eintraege mit demselben Ziel, und der
 * obere waere im Menue als Link erschienen, der nichts Eigenes zeigt.
 * Ist `href` leer, steht dort ein Knopf, der nur auf- und zuklappt.
 */
type NavItem = { href?: string; label: string; children: NavChild[] };

/** Trifft dieser Pfad den Eintrag oder einen seiner Unterpunkte? */
function istAktiv(pathname: string, item: NavItem): boolean {
  const passt = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  if (item.href && passt(item.href)) return true;
  // Eine Gruppe ohne eigene Seite ist aktiv, wenn eines ihrer Ziele es ist —
  // sonst waere „Ernaehrung" auf der Seite „Vegan" unmarkiert.
  return item.children.some(
    (c) => passt(c.href) || (c.children ?? []).some((g) => passt(g.href)),
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SearchField({
  onSubmitted,
  autoFocus = false,
}: {
  onSubmitted?: () => void;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        router.push(term ? `/suche?q=${encodeURIComponent(term)}` : "/suche");
        onSubmitted?.();
      }}
      className="relative w-full"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-leaf"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>
      <input
        type="search"
        name="q"
        value={q}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        aria-label={dict.nav.search}
        placeholder={dict.site.searchPlaceholder}
        // text-base (16px) verhindert das automatische Reinzoomen von iOS
        // Safari beim Fokussieren des Feldes.
        className="w-full rounded-full border border-ink/15 bg-white py-2.5 pl-11 pr-4 text-base text-ink placeholder:text-ink-soft/70 focus:border-leaf focus:outline-none focus:ring-2 focus:ring-leaf/30"
      />
    </form>
  );
}

export function SiteHeader({
  brand,
  recipeChildren = [],
  travelChildren = [],
  nutritionChildren = [],
}: {
  brand: HeaderBrand;
  recipeChildren?: NavChild[];
  travelChildren?: NavChild[];
  /** „Ernährung": Ernährungsformen (mit ihren Formen) und Saisonkalender. */
  nutritionChildren?: NavChild[];
}) {
  const [open, setOpen] = useState(false);
  // Offenes Desktop-Dropdown bzw. aufgeklappter Mobil-Eintrag.
  //
  // Erkannt wird ein Eintrag an seiner BESCHRIFTUNG, nicht mehr an seinem
  // `href`: „Ernährung" hat keines. Die Beschriftungen des Hauptmenüs sind
  // fest verdrahtet und eindeutig.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileSub, setMobileSub] = useState<string | null>(null);
  const menuId = useId();
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);

  const NAV: NavItem[] = [
    { href: "/rezepte", label: dict.nav.recipes, children: recipeChildren },
    { href: "/reisen", label: dict.nav.travel, children: travelChildren },
    // „Ernährung" ohne eigene Seite: eine Klammer um Ernährungsformen und
    // Saisonkalender. Der Saisonkalender stand bis 08/2026 als eigener
    // Hauptpunkt daneben.
    { label: dict.nav.nutrition, children: nutritionChildren },
    { href: "/ueber-mich", label: dict.nav.about, children: [] },
    { href: "/suche", label: dict.nav.search, children: [] },
  ];
  // Desktop-Menü OHNE „Suche": direkt daneben steht die Suchpille, der Menüpunkt
  // wäre redundant und nimmt Platz (mehr Raum fürs restliche Menü). Im mobilen
  // Panel bleibt „Suche" erhalten (dort ist die Pille nur ganz oben im Panel).
  const desktopNav = NAV.filter((item) => item.href !== "/suche");

  // Route-Wechsel schließt Menü und Dropdowns.
  useEffect(() => {
    setOpen(false);
    setOpenMenu(null);
    setMobileSub(null);
  }, [pathname]);

  // Escape schließt; Klick außerhalb schließt.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setOpenMenu(null);
      }
    }
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setOpenMenu(null);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  return (
    <header
      ref={panelRef}
      className="sticky top-0 z-40 border-b border-ink/10 bg-white print:hidden"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:gap-6">
        {/* Marken-Lockup „Rose’s Gourmet Compass" (Kompass + Jost-Schrift),
            im Admin über Name/Logo konfigurierbar. */}
        <SiteLogo brand={brand} className="mr-auto shrink-0" />

        {/* Permanentes horizontales Menü erst ab lg: Logo-Lockup + einzeilige
            Navigation brauchen mehr Breite, als md (768px) bietet. Unterhalb lg
            liegt alles (inkl. „Suche") im Hamburger-Panel — nichts bricht um. */}
        <nav className="hidden lg:block" aria-label={dict.nav.menu}>
          <ul className="flex items-center gap-1">
            {desktopNav.map((item) => {
              const active = istAktiv(pathname, item);
              const hasChildren = item.children.length > 0;
              const expanded = openMenu === item.label;
              const beschriftung = `block whitespace-nowrap py-2 pl-3 text-sm font-semibold transition-colors hover:text-leaf ${
                hasChildren ? "pr-1" : "pr-3"
              } ${active ? "text-leaf" : "text-ink"}`;
              return (
                <li
                  key={item.label}
                  className="relative"
                  onMouseEnter={() => hasChildren && setOpenMenu(item.label)}
                  onMouseLeave={() =>
                    setOpenMenu((m) => (m === item.label ? null : m))
                  }
                >
                  <span className="flex items-center">
                    {item.href ? (
                      <Link href={item.href} className={beschriftung}>
                        {item.label}
                      </Link>
                    ) : (
                      /* Gruppe ohne eigene Seite: ein Knopf, kein Link. Ein
                         Link auf „nichts" (href="#") wäre ein Versprechen,
                         das die Seite nicht einlöst — und für Screenreader
                         ein Ziel, das es nicht gibt.

                         Der Klick ÖFFNET, er schaltet nicht um. Das ist kein
                         Detail: Die Maus hat beim Hinzeigen schon geöffnet
                         (onMouseEnter am <li>), ein Umschalten würde die
                         Liste im selben Moment wieder zuklappen, in dem man
                         auf ihre Überschrift klickt. Geschlossen wird über
                         den Pfeil daneben, Escape, einen Klick daneben oder
                         indem man mit der Maus weggeht. */
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpenMenu(item.label)}
                        className={beschriftung}
                      >
                        {item.label}
                      </button>
                    )}
                    {hasChildren && (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={dict.nav.toggleSubmenu(item.label)}
                        onClick={() =>
                          setOpenMenu((m) => (m === item.label ? null : item.label))
                        }
                        className="mr-1 p-1 text-ink-soft transition-colors hover:text-leaf"
                      >
                        <Chevron open={expanded} />
                      </button>
                    )}
                  </span>
                  {hasChildren && expanded && (
                    <ul className="absolute left-0 top-full z-50 max-h-[70vh] min-w-56 max-w-72 overflow-y-auto border border-ink/10 bg-white py-2 shadow-lg">
                      {item.children.map((c) => (
                        <li key={c.href}>
                          <Link
                            href={c.href}
                            className="block px-4 py-1.5 text-sm text-ink transition-colors hover:bg-cream hover:text-leaf"
                          >
                            {c.label}
                          </Link>
                          {/* Zweite Ebene: eingerückt IM selben Feld statt in
                              einem seitlich ausklappenden zweiten Feld. Ein
                              Flyout müsste man mit der Maus treffen, ohne das
                              erste Feld zu verlassen — bei fünf Einträgen
                              lohnt das den Aufwand und das Risiko nicht. */}
                          {(c.children ?? []).length > 0 && (
                            <ul className="border-l border-ink/10 pl-3 ml-4">
                              {c.children!.map((g) => (
                                <li key={g.href}>
                                  <Link
                                    href={g.href}
                                    className="block px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-cream hover:text-leaf"
                                  >
                                    {g.label}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Suchpille (ab sm sichtbar) */}
        <div className="hidden w-56 max-w-[42vw] sm:block">
          <SearchField />
        </div>

        {/* Hamburger — nur auf kleinen Screens */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? dict.nav.closeMenu : dict.nav.openMenu}
          className="flex h-11 w-11 shrink-0 items-center justify-center text-ink transition-colors hover:text-leaf lg:hidden"
        >
          {open ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Menü-Panel (nur mobil) */}
      {open && (
        <div id={menuId} className="border-t border-ink/10 bg-white lg:hidden">
          <div className="mx-auto max-w-6xl px-4 py-4">
            {/* Suche auf kleinen Screens im Panel */}
            <div className="mb-4 sm:hidden">
              {/* a11y-Ausnahme (begründet): Fokus nur, weil der Nutzer das
                  Suchpanel bewusst geöffnet hat — erwartetes Verhalten. */}
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <SearchField autoFocus onSubmitted={() => setOpen(false)} />
            </div>
            <nav aria-label={dict.nav.menu}>
              <ul className="flex flex-col gap-1">
                {NAV.map((item) => {
                  const active = istAktiv(pathname, item);
                  const hasChildren = item.children.length > 0;
                  const expanded = mobileSub === item.label;
                  const beschriftung = `block py-2 text-left font-display text-lg font-semibold transition-colors hover:text-leaf ${
                    active ? "text-leaf" : "text-ink"
                  }`;
                  return (
                    <li key={item.label}>
                      <span className="flex items-center justify-between">
                        {item.href ? (
                          <Link href={item.href} className={beschriftung}>
                            {item.label}
                          </Link>
                        ) : (
                          /* Gruppe ohne eigene Seite: Der Text selbst klappt
                             auf. Auf dem Handy ist er das größere Ziel als
                             der Pfeil daneben — und ein Tipp darauf, der
                             nichts tut, wäre die schlechteste Antwort. */
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() =>
                              setMobileSub((m) =>
                                m === item.label ? null : item.label,
                              )
                            }
                            className={beschriftung}
                          >
                            {item.label}
                          </button>
                        )}
                        {hasChildren && (
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={dict.nav.toggleSubmenu(item.label)}
                            onClick={() =>
                              setMobileSub((m) =>
                                m === item.label ? null : item.label,
                              )
                            }
                            className="flex h-11 w-11 items-center justify-center text-ink-soft hover:text-leaf"
                          >
                            <Chevron open={expanded} />
                          </button>
                        )}
                      </span>
                      {hasChildren && expanded && (
                        <ul className="mb-2 ml-1 flex flex-col gap-0.5 border-l border-ink/10 pl-4">
                          {item.children.map((c) => (
                            <li key={c.href}>
                              <Link
                                href={c.href}
                                className="block py-1.5 text-sm text-ink-soft transition-colors hover:text-leaf"
                              >
                                {c.label}
                              </Link>
                              {(c.children ?? []).length > 0 && (
                                <ul className="mb-1 ml-1 flex flex-col gap-0.5 border-l border-ink/10 pl-3">
                                  {c.children!.map((g) => (
                                    <li key={g.href}>
                                      <Link
                                        href={g.href}
                                        className="block py-1.5 text-sm text-ink-soft transition-colors hover:text-leaf"
                                      >
                                        {g.label}
                                      </Link>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
