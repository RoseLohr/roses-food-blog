import type { Metadata } from "next";
import Link from "next/link";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();

export const metadata: Metadata = {
  title: dict.newsletter.unsubscribePageTitle,
  robots: { index: false, follow: false },
};

// Rendert die (öffentliche) Layout-Fußzeile inkl. Newsletter-Box, deren
// Sichtbarkeit aus den Einstellungen (DB) gelesen wird — daher zur Laufzeit
// rendern statt zur Build-Zeit statisch vorzurendern.
export const dynamic = "force-dynamic";

export default async function UnsubscribedPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const ok = searchParams.status === "abgemeldet";

  return (
    <main className="mx-auto max-w-xl py-12 text-center">
      <h1 className="font-display text-3xl font-bold">
        {dict.newsletter.unsubscribePageTitle}
      </h1>
      <p
        role="status"
        className={`mt-6 p-5 ${
          ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"
        }`}
      >
        {ok
          ? dict.newsletter.unsubscribeSuccess
          : dict.newsletter.unsubscribeInvalid}
      </p>
      <Link
        href="/"
        className="mt-6 inline-block font-semibold text-rose-primary underline-offset-2 hover:underline"
      >
        {getSiteName()} →
      </Link>
    </main>
  );
}
