/**
 * Server-Wrapper fürs Newsletter-Formular: lädt die Interessen
 * und rendert die Box (Rezeptseiten und Footer).
 */
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { NewsletterForm } from "./newsletter-form";
import { t } from "@/i18n/de";

const dict = t();

export async function NewsletterSection({
  source,
  compact = false,
}: {
  source: string;
  compact?: boolean;
}) {
  const interests = await db
    .select()
    .from(schema.interest)
    .orderBy(asc(schema.interest.name));

  return (
    <section
      aria-label={dict.newsletter.formTitle}
      className={
        compact
          ? ""
          : "mx-auto mt-12 max-w-3xl bg-rose-primary/5 p-6 md:p-8 print:hidden"
      }
    >
      <h2 className="font-display text-xl font-bold">
        {dict.newsletter.formTitle}
      </h2>
      <p className="mb-4 mt-1 text-sm text-ink-soft">
        {dict.newsletter.formIntro}
      </p>
      <NewsletterForm source={source} interests={interests} compact={compact} />
    </section>
  );
}
