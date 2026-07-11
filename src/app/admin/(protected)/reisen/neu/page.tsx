import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { buildTravelEditorProps } from "../editor-data";
import { TravelEditor } from "../travel-editor";

const dict = t();

export const metadata: Metadata = { title: dict.admin.travel.newPost };

export default async function NewTravelPage() {
  await requireAdmin();
  const props = await buildTravelEditorProps(null);

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{dict.admin.travel.newPost}</h1>
      <TravelEditor {...props!} />
    </>
  );
}
