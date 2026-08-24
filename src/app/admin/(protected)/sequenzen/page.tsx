import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import {
  deleteSequenceAction,
  saveSequenceAction,
  toggleSequenceAction,
} from "./actions";
import { SequenceEditor } from "./sequence-editor";
import { Meldung, meldungAus } from "@/components/admin/meldung";
import { Statuschip } from "@/components/admin/statuschip";
import { LoeschForm } from "@/components/admin/loesch-form";

const dict = t();
const d = dict.admin.sequences;

export const metadata: Metadata = { title: d.title };

export default async function SequencesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message = meldungAus(searchParams);

  const sequences = await db
    .select()
    .from(schema.sequence)
    .orderBy(asc(schema.sequence.name), asc(schema.sequence.id));
  const allSteps = await db
    .select()
    .from(schema.sequenceStep)
    .orderBy(asc(schema.sequenceStep.sortOrder));

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{d.title}</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">{d.hint}</p>
      <Meldung text={message} />

      <div className="flex max-w-3xl flex-col gap-8">
        {sequences.map((seq) => (
          <section key={seq.id} className="bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Statuschip ton={seq.active ? "gruen" : "grau"} gross>
                {seq.active ? d.active : d.paused}
              </Statuschip>
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
                <LoeschForm action={deleteSequenceAction} id={seq.id} gestalt="knopf" />
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
