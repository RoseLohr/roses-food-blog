"use client";

/**
 * Schlankes Newsletter-Anmeldeformular (Teal-Band im Footer): nur
 * E-Mail-Adresse + Einwilligungs-Checkbox mit Link auf die
 * Datenschutzerklärung. Name & Interessen kommen erst nach der Bestätigung.
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

export function NewsletterForm({ source }: { source: string }) {
  const [state, formAction, pending] = useActionState<NewsletterFormState, FormData>(
    subscribeAction,
    {},
  );
  const uid = useId();

  if (state.success) {
    return (
      <p role="status" className="nl-box__note">
        {state.success}
      </p>
    );
  }

  return (
    <form action={formAction} className="nl-box__form">
      <input type="hidden" name="quelle" value={source} />
      {state.error && (
        <p role="alert" className="nl-box__note nl-box__note--error">
          {state.error}
        </p>
      )}
      <div className="nl-box__row">
        <label htmlFor={`${uid}-email`} className="sr-only">
          {d.email}
        </label>
        <input
          id={`${uid}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={d.email}
          className="nl-box__input"
        />
        <button type="submit" disabled={pending} className="nl-box__btn">
          {d.submit}
        </button>
      </div>

      <label className="nl-box__consent">
        <input type="checkbox" name="einwilligung" value="ja" required />
        <span>
          {d.consentPrefix}{" "}
          <Link href="/datenschutz">{d.consentLinkText}</Link>
          {d.consentSuffix}
        </span>
      </label>
    </form>
  );
}
