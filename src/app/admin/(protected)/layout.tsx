import type { Metadata } from "next";
import Link from "next/link";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { logoutAction } from "./actions";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";

const dict = t();

export const metadata: Metadata = {
  title: { default: dict.admin.title, template: `%s – ${dict.admin.title}` },
  robots: { index: false, follow: false },
};

type NavKey = keyof typeof dict.admin.nav;
interface NavGroup {
  label?: string;
  items: Array<[string, NavKey]>;
}

const NAV_GROUPS: NavGroup[] = [
  { items: [["/admin", "dashboard"]] },
  {
    label: dict.admin.nav.groupContent,
    items: [
      ["/admin/rezepte", "recipes"],
      ["/admin/reisen", "travel"],
      ["/admin/seiten", "pages"],
      ["/admin/startseite", "homepage"],
      ["/admin/medien", "media"],
      ["/admin/zutaten", "ingredients"],
      ["/admin/taxonomien", "taxonomies"],
    ],
  },
  {
    label: dict.admin.nav.groupNewsletter,
    items: [
      ["/admin/kontakte", "contacts"],
      ["/admin/segmente", "segments"],
      ["/admin/kampagnen", "campaigns"],
      ["/admin/sequenzen", "sequences"],
    ],
  },
  {
    label: dict.admin.nav.groupAnalytics,
    items: [["/admin/statistik", "tracking"]],
  },
  {
    label: dict.admin.nav.groupSystem,
    items: [
      ["/admin/benutzer", "users"],
      ["/admin/einstellungen", "settings"],
      ["/admin/aktualisierung", "deploy"],
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
        <nav aria-label={dict.admin.title} className="flex flex-1 flex-col gap-4">
          {NAV_GROUPS.map((group, i) => (
            <div key={i} className="border-t border-ink/5 pt-3 first:border-t-0 first:pt-0">
              {group.label && (
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-ink-soft/70">
                  {group.label}
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {group.items.map(([href, key]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="block px-3 py-1.5 text-sm text-ink-soft hover:bg-cream hover:text-ink"
                    >
                      {dict.admin.nav[key]}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
            groups={NAV_GROUPS.map((group) => ({
              label: group.label ?? "",
              items: group.items.map(
                ([href, key]) => [href, dict.admin.nav[key]] as [string, string],
              ),
            }))}
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
