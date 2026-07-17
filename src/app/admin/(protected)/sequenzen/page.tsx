import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import {
  deleteSequenceAction,
  saveSequenceAction,
  toggleSequenceAction,
} from "./actions";
import { SequenceEditor } from "./sequence-editor";

const dict = t();
const d = dict.admin.sequences;

export const metadata: Metadata = { title: d.title };

export default async function SequencesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  const sequences = await db
    .select()
    .from(schema.sequence)
    .orderBy(asc(schema.sequence.name));
  const allSteps = await db
    .select()
    .from(schema.sequenceStep)
    .orderBy(asc(schema.sequenceStep.sortOrder));

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{d.title}</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">{d.hint}</p>
      {message && (
        <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <div className="flex max-w-3xl flex-col gap-8">
        {sequences.map((seq) => (
          <section key={seq.id} className="bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span
                className={
                  seq.active
                    ? "bg-green-100 px-3 py-1 text-sm text-green-900"
                    : "bg-gray-200 px-3 py-1 text-sm text-gray-700"
                }
              >
                {seq.active ? d.active : d.paused}
              </span>
              <div className="flex gap-2">
                <form action={toggleSequenceAction}>
                  <input type="hidden" name="id" value={seq.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-cream"
                  >
                    {seq.active ? d.pause : d.activate}
                  </button>
                </form>
                <form action={deleteSequenceAction}>
                  <input type="hidden" name="id" value={seq.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                  >
                    {dict.common.delete}
                  </button>
                </form>
              </div>
            </div>
            <form action={saveSequenceAction} className="flex flex-col gap-2">
              <SequenceEditor
                id={seq.id}
                name={seq.name}
                steps={allSteps
                  .filter((s) => s.sequenceId === seq.id)
                  .map((s) => ({
                    delayHours: s.delayHours,
                    subject: s.subject,
                    content: s.content,
                  }))}
              />
              <button
                type="submit"
                className="mt-2 self-start rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
              >
                {dict.common.save}
              </button>
            </form>
          </section>
        ))}

        <section className="bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">{d.newSequence}</h2>
          <form action={saveSequenceAction} className="flex flex-col gap-2">
            <SequenceEditor id={null} name="" steps={[]} />
            <button
              type="submit"
              className="mt-2 self-start rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
            >
              {dict.common.create}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
