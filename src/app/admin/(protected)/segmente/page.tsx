import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { QuickAddCheckboxes } from "@/components/admin/quick-add-checkboxes";
import {
  contactIdsForSegment,
  ruleInterestIdsForSegment,
} from "@/lib/segments";
import { t } from "@/i18n/de";
import {
  createInterestAction,
  createTagAction,
  deleteInterestAction,
  deleteSegmentAction,
  deleteTagAction,
  saveSegmentAction,
  toggleInterestPublicAction,
} from "./actions";

const dict = t();
const d = dict.admin.segments;

export const metadata: Metadata = { title: d.title };

const inputCls = "w-full min-w-0 border border-ink-soft/30 px-3 py-2 text-sm";

function SimpleList({
  title,
  entries,
  createAction,
  deleteAction,
  newLabel,
  hint,
  toggle,
}: {
  title: string;
  entries: Array<{ id: number; name: string; toggled?: boolean }>;
  createAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  newLabel: string;
  /** Erklärtext unter der Überschrift (optional) */
  hint?: string;
  /** Umschalt-Badge je Eintrag (optional), z. B. „öffentlich" */
  toggle?: { label: string; action: (formData: FormData) => Promise<void> };
}) {
  return (
    <section className="bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-sm text-ink-soft">{hint}</p>}
      <ul className="mb-4 flex flex-wrap gap-2">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-1 bg-cream px-3 py-1 text-sm">
            {e.name}
            {toggle && (
              <form action={toggle.action} className="inline">
                <input type="hidden" name="id" value={e.id} />
                <button
                  type="submit"
                  aria-pressed={e.toggled === true}
                  title={dict.admin.segments.interestPublicHint}
                  className={
                    e.toggled
                      ? "ml-1 rounded-full bg-leaf px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-white"
                      : "ml-1 rounded-full border border-ink/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-soft"
                  }
                >
                  {toggle.label}
                </button>
              </form>
            )}
            <form action={deleteAction} className="inline">
              <input type="hidden" name="id" value={e.id} />
              <button
                type="submit"
                aria-label={`${e.name} ${dict.common.delete}`}
                className="ml-1 font-bold text-red-700"
              >
                ×
              </button>
            </form>
          </li>
        ))}
      </ul>
      <form action={createAction} className="flex gap-2">
        <label className="sr-only" htmlFor={`neu-${title}`}>
          {newLabel}
        </label>
        <input id={`neu-${title}`} name="name" required placeholder={newLabel} className={inputCls} />
        <button
          type="submit"
          className="rounded-lg bg-rose-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.common.create}
        </button>
      </form>
    </section>
  );
}

export default async function SegmentsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  const [segments, interests, tags] = await Promise.all([
    db.select().from(schema.segment).orderBy(asc(schema.segment.name)),
    db.select().from(schema.interest).orderBy(asc(schema.interest.name)),
    db.select().from(schema.contactTag).orderBy(asc(schema.contactTag.name)),
  ]);
  const memberCounts = new Map<number, number>();
  const ruleIdsBySegment = new Map<number, number[]>();
  for (const s of segments) {
    memberCounts.set(s.id, (await contactIdsForSegment(s.id)).length);
    ruleIdsBySegment.set(s.id, await ruleInterestIdsForSegment(s.id));
  }

  const segmentForm = (segment: (typeof segments)[number] | null) => {
    const selectedRules = segment ? (ruleIdsBySegment.get(segment.id) ?? []) : [];
    return (
      <form
        action={saveSegmentAction}
        className="flex flex-col gap-3 border border-ink/10 p-4"
      >
        {segment && <input type="hidden" name="id" value={segment.id} />}
        <div className="flex items-center justify-between gap-3">
          <label className="sr-only" htmlFor={`seg-name-${segment?.id ?? "neu"}`}>
            {d.name}
          </label>
          <input
            id={`seg-name-${segment?.id ?? "neu"}`}
            name="name"
            required
            defaultValue={segment?.name ?? ""}
            placeholder={d.newSegment}
            className={inputCls}
          />
          {segment && (
            <span className="shrink-0 bg-cream px-3 py-1 text-sm">
              {memberCounts.get(segment.id)} {d.members}
            </span>
          )}
        </div>
        <div>
          <QuickAddCheckboxes
            name="regelInteressen"
            legend={d.ruleInterests}
            options={interests}
            selectedIds={selectedRules}
            kind="interest"
          />
          <p className="mt-1 text-xs text-ink-soft">{d.ruleHint}</p>
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-lg bg-rose-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-primary-dark"
          >
            {segment ? dict.common.save : dict.common.create}
          </button>
        </div>
      </form>
    );
  };

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{d.title}</h1>
      {message && (
        <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <section className="bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">{d.title}</h2>
          <div className="flex flex-col gap-4">
            {segments.map((s) => (
              <div key={s.id}>
                {segmentForm(s)}
                <form action={deleteSegmentAction} className="mt-1 text-right">
                  <input type="hidden" name="id" value={s.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-700 underline-offset-2 hover:underline"
                  >
                    {dict.common.delete}
                  </button>
                </form>
              </div>
            ))}
            <h3 className="mt-2 text-sm font-semibold text-ink-soft">
              {d.newSegment}
            </h3>
            {segmentForm(null)}
          </div>
        </section>

        <div className="flex flex-col gap-6">
          <SimpleList
            title={d.interestsTitle}
            entries={interests.map((i) => ({ ...i, toggled: i.isPublic }))}
            createAction={createInterestAction}
            deleteAction={deleteInterestAction}
            newLabel={d.newInterest}
            hint={d.interestPublicHint}
            toggle={{
              label: d.interestPublic,
              action: toggleInterestPublicAction,
            }}
          />
          <SimpleList
            title={d.tagsTitle}
            entries={tags}
            createAction={createTagAction}
            deleteAction={deleteTagAction}
            newLabel={d.newTag}
          />
        </div>
      </div>
    </>
  );
}
