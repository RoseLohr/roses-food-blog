import type { Metadata } from "next";
import { TravelFilterList } from "@/components/travel-filter-list";
import { decodeFilterValue } from "@/lib/travel";
import { t } from "@/i18n/de";

const dict = t();

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ wert: string }>;
}): Promise<Metadata> {
  const { wert } = await props.params;
  const value = decodeFilterValue(wert);
  return {
    title: `${value} – ${dict.travelList.title}`,
    alternates: { canonical: `/reisen/stadt/${encodeURIComponent(value)}` },
  };
}

export default async function TravelByCityPage(props: {
  params: Promise<{ wert: string }>;
}) {
  const { wert } = await props.params;
  return <TravelFilterList dimension="stadt" value={wert} />;
}
