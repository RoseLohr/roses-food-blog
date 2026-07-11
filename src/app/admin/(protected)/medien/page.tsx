import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { imageUrl } from "@/lib/media";
import { t } from "@/i18n/de";
import {
  deleteImageAction,
  updateAltTextAction,
  uploadImageAction,
} from "./actions";

const dict = t();

export const metadata: Metadata = { title: dict.admin.media.title };

export default async function MediaPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;
  const images = await db
    .select()
    .from(schema.mediaImage)
    .orderBy(desc(schema.mediaImage.createdAt));

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{dict.admin.media.title}</h1>
      {message && (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <form
        action={uploadImageAction}
        className="mb-8 flex max-w-xl flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm"
      >
        <h2 className="text-lg font-semibold">{dict.admin.media.upload}</h2>
        <p className="text-sm text-ink-soft">{dict.admin.media.uploadHint}</p>
        <label className="text-sm font-medium" htmlFor="upload-file">
          {dict.admin.media.upload}
        </label>
        <input
          id="upload-file"
          name="datei"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className="rounded-lg border border-ink-soft/30 px-3 py-2"
        />
        <label className="text-sm font-medium" htmlFor="upload-alt">
          {dict.admin.media.altText}
        </label>
        <input
          id="upload-alt"
          name="altText"
          placeholder={dict.admin.media.altTextHint}
          className="rounded-lg border border-ink-soft/30 px-3 py-2"
        />
        <button
          type="submit"
          className="self-start rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.admin.media.upload}
        </button>
      </form>

      {images.length === 0 ? (
        <p className="text-ink-soft">{dict.admin.media.empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {images.map((img) => (
            <li key={img.id} className="rounded-2xl bg-white p-3 shadow-sm">
              <img
                src={imageUrl(img.fileKey, JSON.parse(img.variantWidths)[0] ?? 320)}
                alt={img.altText}
                width={320}
                height={Math.round((320 / img.width) * img.height)}
                loading="lazy"
                className="mb-2 aspect-square w-full rounded-lg object-cover"
              />
              <p className="truncate text-xs text-ink-soft" title={img.originalName}>
                {img.originalName} · {img.width}×{img.height}
              </p>
              <form action={updateAltTextAction} className="mt-2 flex gap-1">
                <input type="hidden" name="id" value={img.id} />
                <label className="sr-only" htmlFor={`alt-${img.id}`}>
                  {dict.admin.media.altText}
                </label>
                <input
                  id={`alt-${img.id}`}
                  name="altText"
                  defaultValue={img.altText}
                  placeholder={dict.admin.media.altText}
                  className="w-full min-w-0 rounded border border-ink-soft/30 px-2 py-1 text-xs"
                />
                <button
                  type="submit"
                  className="rounded border border-ink/20 px-2 py-1 text-xs hover:bg-cream"
                >
                  {dict.common.save}
                </button>
              </form>
              <form action={deleteImageAction} className="mt-1">
                <input type="hidden" name="id" value={img.id} />
                <button
                  type="submit"
                  className="text-xs text-red-700 underline-offset-2 hover:underline"
                >
                  {dict.common.delete}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
