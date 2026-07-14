import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { thumbUrl } from "@/lib/media";
import { ImagePicker } from "@/components/admin/image-picker";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { t } from "@/i18n/de";
import { savePageAction } from "../actions";

const dict = t();
const d = dict.admin.pages;

export const metadata: Metadata = { title: d.editPage };

const inputCls = "w-full border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";

export default async function EditPagePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const isNew = id === "neu";
  const pageId = isNew ? null : Number(id);
  if (!isNew && !Number.isInteger(pageId)) notFound();

  const page = pageId
    ? (await db.select().from(schema.page).where(eq(schema.page.id, pageId)))[0]
    : null;
  if (!isNew && !page) notFound();

  const imageRows = await db
    .select({
      id: schema.mediaImage.id,
      originalName: schema.mediaImage.originalName,
      altText: schema.mediaImage.altText,
      fileKey: schema.mediaImage.fileKey,
      variantWidths: schema.mediaImage.variantWidths,
    })
    .from(schema.mediaImage)
    .orderBy(asc(schema.mediaImage.originalName));
  const imageChoices = imageRows.map((i) => ({
    id: i.id,
    label: i.altText || i.originalName,
    thumbUrl: thumbUrl(i.fileKey, i.variantWidths),
  }));

  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {isNew ? d.newPage : `${d.editPage}: ${page!.title}`}
      </h1>
      {message && (
        <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}
      <form
        action={savePageAction}
        className="flex max-w-3xl flex-col gap-4 bg-white p-5 shadow-sm"
      >
        {page && <input type="hidden" name="id" value={page.id} />}
        <div>
          <label className={labelCls} htmlFor="s-titel">
            {d.fieldTitle} *
          </label>
          <input id="s-titel" name="titel" required defaultValue={page?.title ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="s-slug">
            {d.fieldSlug}
          </label>
          <input id="s-slug" name="slug" defaultValue={page?.slug ?? ""} className={inputCls} />
        </div>
        <RichTextEditor
          name="inhalt"
          label={d.fieldContent}
          initialMarkdown={page?.content ?? ""}
          minHeightClass="min-h-64"
        />
        <ImagePicker
          name="titelbild"
          legend={d.fieldHeroImage}
          options={imageChoices}
          selectedIds={page?.heroImageId ? [page.heroImageId] : []}
          multiple={false}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="s-seo-titel">
              {dict.admin.recipes.fieldSeoTitle}
            </label>
            <input id="s-seo-titel" name="seoTitel" defaultValue={page?.seoTitle ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="s-seo-beschreibung">
              {dict.admin.recipes.fieldSeoDescription}
            </label>
            <input
              id="s-seo-beschreibung"
              name="seoBeschreibung"
              defaultValue={page?.seoDescription ?? ""}
              className={inputCls}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium" htmlFor="s-status">
            {dict.admin.recipes.fieldStatus}
          </label>
          <select
            id="s-status"
            name="status"
            defaultValue={page?.status ?? "entwurf"}
            className="border border-ink-soft/30 px-3 py-2 text-sm"
          >
            <option value="entwurf">{dict.admin.recipes.statusDraft}</option>
            <option value="veroeffentlicht">
              {dict.admin.recipes.statusPublished}
            </option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-rose-primary px-5 py-2 font-semibold text-white hover:bg-rose-primary-dark"
          >
            {dict.common.save}
          </button>
        </div>
      </form>
    </>
  );
}
