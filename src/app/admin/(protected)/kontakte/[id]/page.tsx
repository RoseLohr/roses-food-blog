import type { Metadata } from "next";
import { desc, eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { anonymizeContactAction, updateContactAction } from "./actions";

const dict = t();
const d = dict.admin.contacts;

export const metadata: Metadata = { title: d.detailTitle };

const inputCls = "w-full rounded-lg border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";

export default async function ContactDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const contactId = Number(id);
  if (!Number.isInteger(contactId)) notFound();

  const [contact] = await db
    .select()
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId));
  if (!contact) notFound();

  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  const [interests, tags, segments, myInterests, myTags, mySegments, activity] =
    await Promise.all([
      db.select().from(schema.interest).orderBy(asc(schema.interest.name)),
      db.select().from(schema.contactTag).orderBy(asc(schema.contactTag.name)),
      db.select().from(schema.segment).orderBy(asc(schema.segment.name)),
      db
        .select({ id: schema.contactInterest.interestId })
        .from(schema.contactInterest)
        .where(eq(schema.contactInterest.contactId, contactId)),
      db
        .select({ id: schema.contactTagAssign.tagId })
        .from(schema.contactTagAssign)
        .where(eq(schema.contactTagAssign.contactId, contactId)),
      db
        .select({ id: schema.contactSegment.segmentId })
        .from(schema.contactSegment)
        .where(eq(schema.contactSegment.contactId, contactId)),
      db
        .select()
        .from(schema.contactActivity)
        .where(eq(schema.contactActivity.contactId, contactId))
        .orderBy(desc(schema.contactActivity.createdAt))
        .limit(50),
    ]);

  const checkboxGroup = (
    name: string,
    options: Array<{ id: number; name: string }>,
    selected: number[],
  ) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {options.map((o) => (
        <label key={o.id} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            name={name}
            value={o.id}
            defaultChecked={selected.includes(o.id)}
          />
          {o.name}
        </label>
      ))}
      {options.length === 0 && (
        <span className="text-sm text-ink-soft">{dict.common.none}</span>
      )}
    </div>
  );

  const facts: Array<[string, string]> = [
    [d.email, contact.email],
    [d.status, d.statusLabels[contact.status]],
    [d.source, contact.source || dict.common.none],
    [d.signupAt, contact.signupAt.toLocaleString("de-DE")],
    [
      d.consentAt,
      contact.consentAt?.toLocaleString("de-DE") ?? dict.common.none,
    ],
    [
      d.lastContact,
      contact.lastContactAt?.toLocaleString("de-DE") ?? dict.common.none,
    ],
  ];

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {d.detailTitle}: {`${contact.firstName} ${contact.lastName}`.trim() || contact.email}
      </h1>
      {message && (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="font-medium text-ink-soft">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <form action={updateContactAction} className="mt-5 flex flex-col gap-4">
            <input type="hidden" name="id" value={contact.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="k-vorname">
                  {dict.newsletter.firstName}
                </label>
                <input
                  id="k-vorname"
                  name="vorname"
                  defaultValue={contact.firstName}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="k-nachname">
                  {dict.newsletter.lastName}
                </label>
                <input
                  id="k-nachname"
                  name="nachname"
                  defaultValue={contact.lastName}
                  className={inputCls}
                />
              </div>
            </div>
            <fieldset>
              <legend className={labelCls}>{d.interests}</legend>
              {checkboxGroup("interessen", interests, myInterests.map((x) => x.id))}
            </fieldset>
            <fieldset>
              <legend className={labelCls}>{d.tags}</legend>
              {checkboxGroup("tags", tags, myTags.map((x) => x.id))}
            </fieldset>
            <fieldset>
              <legend className={labelCls}>{d.segments}</legend>
              {checkboxGroup("segmente", segments, mySegments.map((x) => x.id))}
            </fieldset>
            <div>
              <label className={labelCls} htmlFor="k-notizen">
                {d.notes}
              </label>
              <textarea
                id="k-notizen"
                name="notizen"
                rows={4}
                defaultValue={contact.notes}
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              className="self-start rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
            >
              {dict.common.save}
            </button>
          </form>

          {!contact.anonymizedAt && (
            <form action={anonymizeContactAction} className="mt-6 border-t border-ink/10 pt-4">
              <input type="hidden" name="id" value={contact.id} />
              <p className="mb-2 text-sm text-ink-soft">{d.confirmAnonymize}</p>
              <button
                type="submit"
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
              >
                {d.anonymize}
              </button>
            </form>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">{d.activity}</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-ink-soft">{dict.common.none}</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {activity.map((a) => (
                <li key={a.id} className="rounded-lg border border-ink/5 bg-cream/50 p-2.5">
                  <span className="font-medium">
                    {d.activityTypes[a.type] ?? a.type}
                  </span>{" "}
                  <span className="text-ink-soft">
                    · {a.createdAt.toLocaleString("de-DE")}
                  </span>
                  {a.detail && <p className="mt-0.5 text-ink-soft">{a.detail}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
