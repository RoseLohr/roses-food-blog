import type { Metadata } from "next";
import Link from "next/link";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminNav, type AdminNavSection } from "@/components/admin/admin-nav";
import { logoutAction } from "./actions";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";

const dict = t();
const nav = dict.admin.nav;

export const metadata: Metadata = {
  title: { default: dict.admin.title, template: `%s – ${dict.admin.title}` },
  robots: { index: false, follow: false },
};

const NAV_SECTIONS: AdminNavSection[] = [
  { entries: [{ href: "/admin", label: nav.dashboard }] },
  {
    label: nav.groupContent,
    entries: [
      // „Beiträge": aufklappbare Gruppe. Zutaten sitzt direkt unter Rezepte.
      {
        label: nav.groupPosts,
        children: [
          { href: "/admin/rezepte", label: nav.recipes },
          { href: "/admin/zutaten", label: nav.ingredients },
          { href: "/admin/reisen", label: nav.travel },
          { href: "/admin/seiten", label: nav.pages },
          { href: "/admin/startseite", label: nav.homepage },
        ],
      },
      { href: "/admin/medien", label: nav.media },
      { href: "/admin/taxonomien", label: nav.taxonomies },
    ],
  },
  {
    label: nav.groupNewsletter,
    entries: [
      { href: "/admin/kontakte", label: nav.contacts },
      { href: "/admin/segmente", label: nav.segments },
      { href: "/admin/kampagnen", label: nav.campaigns },
      { href: "/admin/sequenzen", label: nav.sequences },
    ],
  },
  { label: nav.groupAnalytics, entries: [{ href: "/admin/statistik", label: nav.tracking }] },
  {
    label: nav.groupSystem,
    entries: [
      { href: "/admin/benutzer", label: nav.users },
      { href: "/admin/einstellungen", label: nav.settings },
      { href: "/admin/aktualisierung", label: nav.deploy },
    ],
  },
];

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-cream">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-ink/10 bg-white p-4 md:flex">
        <Link href="/admin" className="mb-6 text-lg font-bold text-rose-primary">
          {dict.site.name}
        </Link>
        <nav aria-label={dict.admin.title} className="flex-1">
          <AdminNav sections={NAV_SECTIONS} />
        </nav>
        <a
          href="/"
          className="mt-4 block px-3 py-1.5 text-sm text-ink-soft hover:bg-cream"
        >
          {dict.admin.nav.viewSite}
        </a>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-ink/10 bg-white px-4 py-2 md:px-6">
          <AdminMobileNav
            menuLabel={dict.admin.nav.menu}
            label={dict.admin.title}
            sections={NAV_SECTIONS}
          />
          <p className="hidden text-sm text-ink-soft md:block">
            {dict.auth.loggedInAs} <strong>{admin.name}</strong> ({admin.email})
          </p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg border border-ink/20 px-3 py-1 text-sm hover:bg-cream"
            >
              {dict.auth.logout}
            </button>
          </form>
        </header>
        <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
