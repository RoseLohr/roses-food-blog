import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getFullTravelPost } from "@/lib/travel";
import { TravelView } from "@/components/travel-view";
import { t } from "@/i18n/de";

const dict = t();

export const metadata: Metadata = { title: dict.admin.recipes.preview };

export default async function TravelPreviewPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const travelId = Number(id);
  if (!Number.isInteger(travelId)) notFound();
  const full = await getFullTravelPost({ id: travelId });
  if (!full) notFound();

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4 bg-amber-100 p-3 text-sm text-amber-900">
        <p>{dict.admin.travel.previewBanner}</p>
        <Link
          href={`/admin/reisen/${travelId}`}
          className="shrink-0 font-semibold underline-offset-2 hover:underline"
        >
          {dict.common.back}
        </Link>
      </div>
      <div className="bg-white p-6 shadow-sm md:p-10">
        <TravelView full={full} />
      </div>
    </>
  );
}
