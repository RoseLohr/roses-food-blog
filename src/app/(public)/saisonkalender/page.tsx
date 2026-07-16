import type { Metadata } from "next";
import { SeasonCalendar } from "@/components/season-calendar";
import { PageTracker } from "@/components/page-tracker";
import { currentIsoWeek } from "@/lib/season";
import { clampWeek } from "@/lib/saisonkalender";
import { t } from "@/i18n/de";

const dict = t();

export const metadata: Metadata = {
  title: dict.seasonCalendar.title,
  description: dict.seasonCalendar.intro,
  alternates: { canonical: "/saisonkalender" },
};

export const dynamic = "force-dynamic";

export default async function SeasonCalendarPage() {
  // KW 53 kommt in manchen Jahren vor; der Kalender rastert auf 1–52.
  const currentWeek = clampWeek(currentIsoWeek());

  return (
    <main>
      <PageTracker contentType="seite" path="/saisonkalender" />
      <h1 className="font-display text-3xl font-bold md:text-4xl">
        {dict.seasonCalendar.title}
      </h1>
      <p className="mt-2 max-w-2xl text-ink-soft">{dict.seasonCalendar.intro}</p>
      <SeasonCalendar currentWeek={currentWeek} />
    </main>
  );
}
