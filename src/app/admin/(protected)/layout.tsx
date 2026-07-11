import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "./actions";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";

const dict = t();

export const metadata: Metadata = {
  title: { default: dict.admin.title, template: `%s – ${dict.admin.title}` },
  robots: { index: false, follow: false },
};

const NAV_GROUPS: Array<Array<[string, keyof typeof dict.admin.nav]>> = [
  [["/admin", "dashboard"]],
  [
    ["/admin/rezepte", "recipes"],
    ["/admin/reisen", "travel"],
    ["/admin/seiten", "pages"],
    ["/admin/medien", "media"],
    ["/admin/zutaten", "ingredients"],
    ["/admin/taxonomien", "taxonomies"],
    ["/admin/startseite", "homepage"],
  ],
  [
    ["/admin/kontakte", "contacts"],
    ["/admin/segmente", "segments"],
    ["/admin/kampagnen", "campaigns"],
    ["/admin/sequenzen", "sequences"],
  ],
  [
    ["/admin/statistik", "tracking"],
    ["/admin/benutzer", "users"],
  ],
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
            <ul key={i} className="flex flex-col gap-1 border-t border-ink/5 pt-3 first:border-t-0 first:pt-0">
              {group.map(([href, key]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="block rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:bg-cream hover:text-ink"
                  >
                    {dict.admin.nav[key]}
                  </Link>
                </li>
              ))}
            </ul>
          ))}
        </nav>
        <a
          href="/"
          className="mt-4 block rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:bg-cream"
        >
          {dict.admin.nav.viewSite}
        </a>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-ink/10 bg-white px-4 py-2 md:px-6">
          <details className="md:hidden">
            <summary className="cursor-pointer rounded-lg px-2 py-1 text-sm font-semibold">
              Menü
            </summary>
            <nav
              aria-label={dict.admin.title}
              className="absolute z-20 mt-1 rounded-xl border border-ink/10 bg-white p-3 shadow-lg"
            >
              {NAV_GROUPS.flat().map(([href, key]) => (
                <Link key={href} href={href} className="block px-2 py-1 text-sm">
                  {dict.admin.nav[key]}
                </Link>
              ))}
            </nav>
          </details>
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
