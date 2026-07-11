"use client";

/**
 * Editor für eine Sequenz: Name + Schritte (Verzögerung, Betreff, Inhalt),
 * serialisiert als JSON.
 */
import { useState } from "react";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.sequences;

export interface StepRow {
  delayHours: number;
  subject: string;
  content: string;
}

const inputCls = "w-full rounded-lg border border-ink-soft/30 px-3 py-2 text-sm";
const btnSecondary =
  "rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-cream";

export function SequenceEditor({
  id,
  name,
  steps: initialSteps,
}: {
  id: number | null;
  name: string;
  steps: StepRow[];
}) {
  const [steps, setSteps] = useState<StepRow[]>(initialSteps);
  const update = (i: number, patch: Partial<StepRow>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const uid = id ?? "neu";

  return (
    <>
      {id !== null && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="schritte" value={JSON.stringify(steps)} />
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor={`seq-name-${uid}`}>
          {d.name}
        </label>
        <input
          id={`seq-name-${uid}`}
          name="name"
          required
          defaultValue={name}
          className={inputCls}
        />
      </div>
      <h3 className="mt-3 text-sm font-semibold">{d.steps}</h3>
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={i} className="rounded-xl border border-ink/10 p-3">
            <div className="grid gap-2 md:grid-cols-[10rem_1fr]">
              <div>
                <label
                  className="mb-1 block text-xs text-ink-soft"
                  htmlFor={`seq-${uid}-delay-${i}`}
                >
                  {d.stepDelay}
                </label>
                <input
                  id={`seq-${uid}-delay-${i}`}
                  type="number"
                  min={0}
                  value={s.delayHours}
                  onChange={(e) => update(i, { delayHours: Number(e.target.value) || 0 })}
                  className={inputCls}
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-xs text-ink-soft"
                  htmlFor={`seq-${uid}-subject-${i}`}
                >
                  {d.stepSubject}
                </label>
                <input
                  id={`seq-${uid}-subject-${i}`}
                  value={s.subject}
                  onChange={(e) => update(i, { subject: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="md:col-span-2">
                <label
                  className="mb-1 block text-xs text-ink-soft"
                  htmlFor={`seq-${uid}-content-${i}`}
                >
                  {d.stepContent}
                </label>
                <textarea
                  id={`seq-${uid}-content-${i}`}
                  rows={4}
                  value={s.content}
                  onChange={(e) => update(i, { content: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))}
              className={`${btnSecondary} mt-2`}
            >
              × {dict.common.delete}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() =>
          setSteps((prev) => [...prev, { delayHours: 24, subject: "", content: "" }])
        }
        className={`${btnSecondary} mt-2 self-start`}
      >
        + {d.addStep}
      </button>
    </>
  );
}
