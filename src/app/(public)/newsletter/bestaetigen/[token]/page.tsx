import type { Metadata } from "next";
import Link from "next/link";
import { confirmContact } from "@/lib/newsletter";
import { rateLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/request";
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
  const result = limited ? "ungueltig" : await confirmContact(token);

  const messages = {
    bestaetigt: dict.newsletter.confirmSuccess,
    bereits_aktiv: dict.newsletter.confirmAlready,
    ungueltig: dict.newsletter.confirmInvalid,
  } as const;

  return (
    <main className="mx-auto max-w-xl py-12 text-center">
      <h1 className="font-display text-3xl font-bold">
        {dict.newsletter.confirmPageTitle}
      </h1>
      <p
        role="status"
        className={`mt-6 rounded-2xl p-5 ${
          result === "ungueltig"
            ? "bg-red-50 text-red-900"
            : "bg-green-50 text-green-900"
        }`}
      >
        {messages[result]}
      </p>
      <Link
        href="/"
        className="mt-6 inline-block font-semibold text-rose-primary underline-offset-2 hover:underline"
      >
        {dict.site.name} →
      </Link>
    </main>
  );
}
