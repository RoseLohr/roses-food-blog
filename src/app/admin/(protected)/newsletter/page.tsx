import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getNewsletterVisible } from "@/lib/settings";
import { t } from "@/i18n/de";
import { saveNewsletterDisplayAction } from "./actions";

const dict = t();
const d = dict.admin.newsletterDisplay;

export const metadata: Metadata = { title: d.title };

export default async function NewsletterDisplayPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  const visible = getNewsletterVisible();

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{d.title}</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-soft">{d.intro}</p>
      {message && (
        <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <form
        action={saveNewsletterDisplayAction}
        className="max-w-2xl bg-white p-5 shadow-sm"
      >
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="sichtbar"
            value="ja"
            defaultChecked={visible}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-medium">{d.toggleLabel}</span>
            <span className="mt-1 block text-sm text-ink-soft">
              {d.toggleHint}
            </span>
          </span>
        </label>

        <p className="mt-4 text-sm font-medium text-ink-soft">
          {visible ? d.statusVisible : d.statusHidden}
        </p>

        <button
          type="submit"
          className="mt-5 rounded-lg bg-rose-primary px-5 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.common.save}
        </button>
      </form>
    </>
  );
}
