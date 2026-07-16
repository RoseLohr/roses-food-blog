"use client";

/**
 * Öffentlicher Kopfbereich im Tiny-Salt-Look:
 * - Logo-Lockup „tinysalt.studio" mit Unterzeile „Cook & Write"
 * - Runde Suchpille (Enter sucht → /suche?q=…)
 * - Menü hinter einem Hamburger-Icon (wie in der Referenz), das ein Panel
 *   mit den Navigationslinks öffnet. Tastatur- und Screenreader-tauglich
 *   (aria-expanded/-controls, Escape schließt, Fokusreihenfolge).
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { t } from "@/i18n/de";

const dict = t();

const NAV: Array<[string, string]> = [
  ["/rezepte", dict.nav.recipes],
  ["/reisen", dict.nav.travel],
  ["/saisonkalender", dict.nav.seasonCalendar],
  ["/ueber-mich", dict.nav.about],
  ["/suche", dict.nav.search],
];

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

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);

  // Route-Wechsel schließt das Menü.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape schließt; Klick außerhalb schließt.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <header
      ref={panelRef}
      className="sticky top-0 z-40 border-b border-ink/10 bg-white print:hidden"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:gap-6">
        {/* Logo-Lockup: Blogname + Slogan */}
        <Link href="/" className="mr-auto shrink-0 leading-none" aria-label={dict.site.name}>
          <span className="block font-display text-2xl font-bold tracking-tight text-ink">
            {dict.site.name}
          </span>
          <span className="mt-1 block text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-ink-soft">
            {dict.site.tagline}
          </span>
        </Link>

        {/* Permanentes horizontales Menü ab md */}
        <nav className="hidden md:block" aria-label={dict.nav.menu}>
          <ul className="flex items-center gap-1">
            {NAV.map(([href, label]) => {
              const active =
                pathname === href || pathname.startsWith(href + "/");
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={`block px-3 py-2 text-sm font-semibold transition-colors hover:text-leaf ${
                      active ? "text-leaf" : "text-ink"
                    }`}
                  >
                    {label}
                  </Link>
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
          className="flex h-11 w-11 shrink-0 items-center justify-center text-ink transition-colors hover:text-leaf md:hidden"
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
        <div id={menuId} className="border-t border-ink/10 bg-white md:hidden">
          <div className="mx-auto max-w-6xl px-4 py-4">
            {/* Suche auf kleinen Screens im Panel */}
            <div className="mb-4 sm:hidden">
              <SearchField autoFocus onSubmitted={() => setOpen(false)} />
            </div>
            <nav aria-label={dict.nav.menu}>
              <ul className="flex flex-col gap-1">
                {NAV.map(([href, label]) => {
                  const active =
                    pathname === href || pathname.startsWith(href + "/");
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className={`block py-2 font-display text-lg font-semibold transition-colors hover:text-leaf ${
                          active ? "text-leaf" : "text-ink"
                        }`}
                      >
                        {label}
                      </Link>
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
