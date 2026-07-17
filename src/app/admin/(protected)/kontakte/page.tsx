import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.contacts;

export const metadata: Metadata = { title: d.title };

export default async function ContactsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;
  const statusFilter =
    typeof searchParams.status === "string" &&
    ["unbestaetigt", "aktiv", "abgemeldet"].includes(searchParams.status)
      ? (searchParams.status as "unbestaetigt" | "aktiv" | "abgemeldet")
      : null;
  const interestFilter = Number(searchParams.interesse) || null;
  const segmentFilter = Number(searchParams.segment) || null;
  const tagFilter = Number(searchParams.tag) || null;

  const [interests, segments, tags] = await Promise.all([
    db.select().from(schema.interest).orderBy(asc(schema.interest.name)),
    db.select().from(schema.segment).orderBy(asc(schema.segment.name)),
    db.select().from(schema.contactTag).orderBy(asc(schema.contactTag.name)),
  ]);

  // Kontakt-IDs nach Facetten einschränken
  let idFilter: number[] | null = null;
  const restrict = (ids: number[]) => {
    idFilter = idFilter === null ? ids : idFilter.filter((x) => new Set(ids).has(x));
  };
  if (interestFilter) {
    const rows = await db
      .select({ id: schema.contactInterest.contactId })
      .from(schema.contactInterest)
      .where(eq(schema.contactInterest.interestId, interestFilter));
    restrict(rows.map((r) => r.id));
  }
  if (segmentFilter) {
    const { contactIdsForSegment } = await import("@/lib/segments");
    restrict(await contactIdsForSegment(segmentFilter));
  }
  if (tagFilter) {
    const rows = await db
      .select({ id: schema.contactTagAssign.contactId })
      .from(schema.contactTagAssign)
      .where(eq(schema.contactTagAssign.tagId, tagFilter));
    restrict(rows.map((r) => r.id));
  }

  const conditions = [] as ReturnType<typeof eq>[];
  if (statusFilter) conditions.push(eq(schema.contact.status, statusFilter));
  if (idFilter !== null) {
    if ((idFilter as number[]).length === 0) conditions.push(eq(schema.contact.id, -1));
    else conditions.push(inArray(schema.contact.id, idFilter));
  }

  const contacts = await (conditions.length
    ? db
        .select()
        .from(schema.contact)
        .where(and(...conditions))
        .orderBy(desc(schema.contact.signupAt))
    : db.select().from(schema.contact).orderBy(desc(schema.contact.signupAt)));

  const interestRows = contacts.length
    ? await db
        .select({
          contactId: schema.contactInterest.contactId,
          name: schema.interest.name,
        })
        .from(schema.contactInterest)
        .innerJoin(schema.interest, eq(schema.contactInterest.interestId, schema.interest.id))
        .where(
          inArray(
            schema.contactInterest.contactId,
            contacts.map((c) => c.id),
          ),
        )
    : [];

  const selectCls = "border border-ink-soft/30 px-3 py-1.5 text-sm";

  const exportParams = new URLSearchParams();
  if (statusFilter) exportParams.set("status", statusFilter);
  if (interestFilter) exportParams.set("interesse", String(interestFilter));
  if (segmentFilter) exportParams.set("segment", String(segmentFilter));
  if (tagFilter) exportParams.set("tag", String(tagFilter));

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <a
          href={`/admin/kontakte/export?${exportParams}`}
          className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-semibold hover:bg-cream"
        >
          {d.exportCsv}
        </a>
      </div>
      {message && (
        <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="f-status" className="mb-1 block text-xs text-ink-soft">
            {d.status}
          </label>
          <select id="f-status" name="status" defaultValue={statusFilter ?? ""} className={selectCls}>
            <option value="">{d.allStatuses}</option>
            {Object.entries(d.statusLabels).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-interesse" className="mb-1 block text-xs text-ink-soft">
            {d.interests}
          </label>
          <select
            id="f-interesse"
            name="interesse"
            defaultValue={interestFilter ?? ""}
            className={selectCls}
          >
            <option value="">{d.allInterests}</option>
            {interests.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-segment" className="mb-1 block text-xs text-ink-soft">
            {d.segments}
          </label>
          <select
            id="f-segment"
            name="segment"
            defaultValue={segmentFilter ?? ""}
            className={selectCls}
          >
            <option value="">{dict.common.none}</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-tag" className="mb-1 block text-xs text-ink-soft">
            {d.tags}
          </label>
          <select id="f-tag" name="tag" defaultValue={tagFilter ?? ""} className={selectCls}>
            <option value="">{dict.common.none}</option>
            {tags.map((tg) => (
              <option key={tg.id} value={tg.id}>
                {tg.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-rose-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-primary-dark"
        >
          {d.filter}
        </button>
      </form>

      {contacts.length === 0 ? (
        <p className="text-ink-soft">{d.empty}</p>
      ) : (
        <div className="overflow-x-auto bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-ink-soft">
                <th className="px-4 py-3">{d.name}</th>
                <th className="px-4 py-3">{d.email}</th>
                <th className="px-4 py-3">{d.status}</th>
                <th className="px-4 py-3">{d.interests}</th>
                <th className="px-4 py-3">{d.source}</th>
                <th className="px-4 py-3">{d.lastContact}</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/admin/kontakte/${c.id}`}
                      className="hover:text-rose-primary"
                    >
                      {c.anonymizedAt
                        ? `(${d.anonymizedLabel})`
                        : `${c.firstName} ${c.lastName}`.trim() || dict.common.none}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{c.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        c.status === "aktiv"
                          ? "bg-green-100 px-2 py-0.5 text-xs text-green-900"
                          : c.status === "unbestaetigt"
                            ? "bg-amber-100 px-2 py-0.5 text-xs text-amber-900"
                            : "bg-gray-200 px-2 py-0.5 text-xs text-gray-700"
                      }
                    >
                      {d.statusLabels[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {interestRows
                      .filter((r) => r.contactId === c.id)
                      .map((r) => r.name)
                      .join(", ") || dict.common.none}
                  </td>
                  <td className="max-w-40 truncate px-4 py-3" title={c.source}>
                    {c.source || dict.common.none}
                  </td>
                  <td className="px-4 py-3">
                    {c.lastContactAt
                      ? c.lastContactAt.toLocaleDateString("de-DE")
                      : dict.common.none}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
