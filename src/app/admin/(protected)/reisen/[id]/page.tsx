import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { buildTravelEditorProps } from "../editor-data";
import { TravelEditor } from "../travel-editor";

const dict = t();

export const metadata: Metadata = { title: dict.admin.travel.editPost };

export default async function EditTravelPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const travelId = Number(id);
  if (!Number.isInteger(travelId)) notFound();

  const editorProps = await buildTravelEditorProps(travelId);
  if (!editorProps) notFound();

  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {dict.admin.travel.editPost}: {editorProps.initial.title}
      </h1>
      <TravelEditor {...editorProps} message={message} />
    </>
  );
}
