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
  // tracking_unified = Tagesaggregate + heutige Roh-Events. Vorher wurde nur
  // tracking_daily gelesen — „Aufrufe heute" stand damit immer auf 0, weil
  // heutige Events erst nach Tagesende aggregiert werden.
  const today = new Date().toISOString().slice(0, 10);
  const viewsToday = db.all<{ n: number }>(sql`
    SELECT COALESCE(SUM(views), 0) AS n
    FROM tracking_unified
    WHERE day = ${today} AND visitor_type = 'mensch'
  `)[0] ?? { n: 0 };

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
          <div key={label} className="bg-white p-5 shadow-sm">
            <p className="text-3xl font-bold text-rose-primary">{value}</p>
            <p className="mt-1 text-sm text-ink-soft">{label}</p>
          </div>
        ))}
      </div>
    </>
  );
}
