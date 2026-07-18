import type { Metadata } from "next";
import Link from "next/link";
import { confirmContact, getOfferedInterests } from "@/lib/newsletter";
import { NewsletterWelcome } from "@/components/newsletter-welcome";
import { rateLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/request";
import { getSiteName } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();

export const metadata: Metadata = {
  title: dict.newsletter.confirmPageTitle,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ConfirmPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const ip = await getClientIp();
  const limited = !rateLimit(`confirm:${ip}`, 10, 60_000).ok;
  const result = limited
    ? ({ outcome: "ungueltig" } as const)
    : await confirmContact(token);

  // Frisch bestätigt → freundlicher Willkommensschritt (Name & Interessen,
  // optional). Der Kontakt wird über seinen Abmelde-Token ergänzt.
  if (result.outcome === "bestaetigt" && result.profile) {
    const interests = await getOfferedInterests();
    return (
      <main className="mx-auto max-w-xl py-12">
        <NewsletterWelcome
          token={result.profile.unsubscribeToken}
          interests={interests}
          firstName={result.profile.firstName}
          lastName={result.profile.lastName}
          selectedInterestIds={result.profile.interestIds}
          siteName={getSiteName()}
        />
      </main>
    );
  }

  const messages = {
    bereits_aktiv: dict.newsletter.confirmAlready,
    ungueltig: dict.newsletter.confirmInvalid,
  } as const;
  const message =
    result.outcome === "bereits_aktiv"
      ? messages.bereits_aktiv
      : messages.ungueltig;

  return (
    <main className="mx-auto max-w-xl py-12 text-center">
      <h1 className="font-display text-3xl font-bold">
        {dict.newsletter.confirmPageTitle}
      </h1>
      <p
        role="status"
        className={`mt-6 p-5 ${
          result.outcome === "ungueltig"
            ? "bg-red-50 text-red-900"
            : "bg-green-50 text-green-900"
        }`}
      >
        {message}
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
