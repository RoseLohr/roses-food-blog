import type { Metadata } from "next";
import { TravelFilterList } from "@/components/travel-filter-list";
import { t } from "@/i18n/de";

const dict = t();

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ wert: string }>;
}): Promise<Metadata> {
  const { wert } = await props.params;
  return {
    title: `${wert} – ${dict.travelList.title}`,
    alternates: { canonical: `/reisen/stadt/${encodeURIComponent(wert)}` },
  };
}

export default async function TravelByCityPage(props: {
  params: Promise<{ wert: string }>;
}) {
  const { wert } = await props.params;
  return <TravelFilterList dimension="stadt" value={wert} />;
}
