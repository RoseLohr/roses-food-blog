"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { t } from "@/i18n/de";

const dict = t();

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <h2 className="sr-only">{dict.auth.loginTitle}</h2>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          {dict.auth.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="w-full rounded-lg border border-ink-soft/30 px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          {dict.auth.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-ink-soft/30 px-3 py-2"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark disabled:opacity-60"
      >
        {dict.auth.loginButton}
      </button>
    </form>
  );
}
