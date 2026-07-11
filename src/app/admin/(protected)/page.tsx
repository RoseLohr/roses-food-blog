import { count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";

const dict = t();

export default async function AdminDashboard() {
  const admin = await requireAdmin();

  const [published] = await db
    .select({ n: count() })
    .from(schema.recipe)
    .where(eq(schema.recipe.status, "veroeffentlicht"));
  const [drafts] = await db
    .select({ n: count() })
    .from(schema.recipe)
    .where(eq(schema.recipe.status, "entwurf"));
  const [activeContacts] = await db
    .select({ n: count() })
    .from(schema.contact)
    .where(eq(schema.contact.status, "aktiv"));
  const today = new Date().toISOString().slice(0, 10);
  const [viewsToday] = await db
    .select({ n: sql<number>`COALESCE(SUM(views), 0)` })
    .from(schema.trackingDaily)
    .where(
      sql`${schema.trackingDaily.day} = ${today} AND ${schema.trackingDaily.visitorType} = 'mensch'`,
    );

  const cards: Array<[string, number | string]> = [
    [`${dict.admin.dashboard.recipes} (${dict.admin.dashboard.published})`, published.n],
    [dict.admin.dashboard.drafts, drafts.n],
    [dict.admin.dashboard.contacts, activeContacts.n],
    [dict.admin.dashboard.viewsToday, viewsToday.n],
  ];

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {dict.admin.dashboard.welcome}, {admin.name}!
      </h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-3xl font-bold text-rose-primary">{value}</p>
            <p className="mt-1 text-sm text-ink-soft">{label}</p>
          </div>
        ))}
      </div>
    </>
  );
}
