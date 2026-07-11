"use client";

/**
 * Newsletter-Anmeldeformular (Rezeptseiten + Footer): E-Mail, Vor-/Nachname,
 * Interessen, Einwilligungs-Checkbox mit Link auf die Datenschutzerklärung.
 */
import Link from "next/link";
import { useActionState, useId } from "react";
import {
  subscribeAction,
  type NewsletterFormState,
} from "@/app/(public)/newsletter/actions";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.newsletter;

export function NewsletterForm({
  source,
  interests,
  compact = false,
}: {
  source: string;
  interests: Array<{ id: number; name: string }>;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState<NewsletterFormState, FormData>(
    subscribeAction,
    {},
  );
  const uid = useId();

  const inputCls =
    "w-full rounded-lg border border-ink-soft/30 bg-white px-3 py-2 text-sm";

  if (state.success) {
    return (
      <p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-900">
        {state.success}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="quelle" value={source} />
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </p>
      )}
      <div className={compact ? "flex flex-col gap-3" : "grid gap-3 sm:grid-cols-2"}>
        <div>
          <label htmlFor={`${uid}-vorname`} className="mb-1 block text-sm font-medium">
            {d.firstName}
          </label>
          <input
            id={`${uid}-vorname`}
            name="vorname"
            autoComplete="given-name"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor={`${uid}-nachname`} className="mb-1 block text-sm font-medium">
            {d.lastName}
          </label>
          <input
            id={`${uid}-nachname`}
            name="nachname"
            autoComplete="family-name"
            className={inputCls}
          />
        </div>
        <div className={compact ? "" : "sm:col-span-2"}>
          <label htmlFor={`${uid}-email`} className="mb-1 block text-sm font-medium">
            {d.email} *
          </label>
          <input
            id={`${uid}-email`}
            name="email"
            type="email"
            required
            autoComplete="email"
            className={inputCls}
          />
        </div>
      </div>

      {interests.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{d.interests}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {interests.map((i) => (
              <label key={i.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="interessen" value={i.id} />
                {i.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="einwilligung" value="ja" required className="mt-0.5" />
        <span>
          {d.consentPrefix}{" "}
          <Link href="/datenschutz" className="text-rose-primary underline underline-offset-2">
            {d.consentLinkText}
          </Link>
          {d.consentSuffix}
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-rose-primary px-5 py-2 font-semibold text-white hover:bg-rose-primary-dark disabled:opacity-60"
      >
        {d.submit}
      </button>
    </form>
  );
}
