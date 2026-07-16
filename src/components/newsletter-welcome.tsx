"use client";

/**
 * Willkommensschritt auf der Bestätigungsseite: fragt nach dem Double-Opt-in
 * optional Vorname, Nachname und Interessen ab (helle Karte im Blog-Stil).
 * Alles freiwillig — „Überspringen" führt zurück zur Startseite. Der Kontakt
 * wird über seinen (versteckten) Abmelde-Token ergänzt.
 */
import Link from "next/link";
import { useActionState, useId } from "react";
import {
  saveProfileAction,
  type ProfileFormState,
} from "@/app/(public)/newsletter/actions";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.newsletter;

export function NewsletterWelcome({
  token,
  interests,
  firstName,
  lastName,
  selectedInterestIds,
}: {
  token: string;
  interests: Array<{ id: number; name: string }>;
  firstName: string;
  lastName: string;
  selectedInterestIds: number[];
}) {
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(
    saveProfileAction,
    {},
  );
  const uid = useId();

  const Badge = (
    <span className="nl-welcome__badge">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden
      >
        <path d="M20 6 L9 17 L4 12" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {d.welcomeBadge}
    </span>
  );

  if (state.success) {
    return (
      <div className="nl-welcome">
        {Badge}
        <h1 className="nl-welcome__title">{d.welcomeTitle}</h1>
        <p className="nl-welcome__intro">{state.success}</p>
        <Link
          href="/"
          className="font-semibold text-rose-primary underline-offset-2 hover:underline"
        >
          {dict.site.name} →
        </Link>
      </div>
    );
  }

  return (
    <div className="nl-welcome">
      {Badge}
      <h1 className="nl-welcome__title">{d.welcomeTitle}</h1>
      <p className="nl-welcome__intro">{d.welcomeIntro}</p>

      <form action={formAction} className="nl-welcome__form">
        <input type="hidden" name="token" value={token} />
        {state.error && (
          <p role="alert" className="bg-red-50 p-3 text-sm text-red-800">
            {state.error}
          </p>
        )}

        <div className="nl-welcome__names">
          <div>
            <label className="nl-welcome__lab" htmlFor={`${uid}-vorname`}>
              {d.firstName}
            </label>
            <input
              id={`${uid}-vorname`}
              name="vorname"
              autoComplete="given-name"
              defaultValue={firstName}
              className="nl-welcome__input"
            />
          </div>
          <div>
            <label className="nl-welcome__lab" htmlFor={`${uid}-nachname`}>
              {d.lastName}
            </label>
            <input
              id={`${uid}-nachname`}
              name="nachname"
              autoComplete="family-name"
              defaultValue={lastName}
              className="nl-welcome__input"
            />
          </div>
        </div>

        {interests.length > 0 && (
          <fieldset>
            <legend className="nl-welcome__legend">{d.interests}</legend>
            <div className="nl-welcome__pills">
              {interests.map((i) => (
                <label key={i.id} className="nl-welcome__pill">
                  <input
                    type="checkbox"
                    name="interessen"
                    value={i.id}
                    defaultChecked={selectedInterestIds.includes(i.id)}
                  />
                  {i.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="nl-welcome__actions">
          <button type="submit" disabled={pending} className="nl-welcome__btn">
            {d.welcomeSave}
          </button>
          <Link href="/" className="nl-welcome__skip">
            {d.welcomeSkip}
          </Link>
        </div>
      </form>
    </div>
  );
}
