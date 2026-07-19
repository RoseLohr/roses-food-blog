import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { imageUrl, variantWidthsByImage } from "@/lib/media";
import { MediaThumb } from "@/components/admin/media-thumb";
import { t } from "@/i18n/de";
import {
  deleteImageAction,
  updateAltTextAction,
  uploadImageAction,
} from "./actions";

const dict = t();
const m = dict.admin.media;

export const metadata: Metadata = { title: m.title };

/** Upload-Datum als DD-MM-YY. */
function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

export default async function MediaPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;
  const view = searchParams.ansicht === "liste" ? "liste" : "kacheln";

  const images = await db
    .select()
    .from(schema.mediaImage)
    .orderBy(desc(schema.mediaImage.createdAt));
  const widthsById = await variantWidthsByImage(images.map((i) => i.id));

  const thumb = (img: (typeof images)[number]) =>
    imageUrl(img.fileKey, widthsById.get(img.id)?.[0] ?? 320);
  const full = (img: (typeof images)[number]) => {
    const widths = widthsById.get(img.id) ?? [];
    return imageUrl(img.fileKey, widths.at(-1) ?? 320);
  };

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{m.title}</h1>
      {message && (
        <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <form
        action={uploadImageAction}
        className="mb-8 flex max-w-xl flex-col gap-3 bg-white p-5 shadow-sm"
      >
        <h2 className="text-lg font-semibold">{m.upload}</h2>
        <p className="text-sm text-ink-soft">{m.uploadHint}</p>
        <label className="text-sm font-medium" htmlFor="upload-file">
          {m.upload}
        </label>
        <input
          id="upload-file"
          name="datei"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className="border border-ink-soft/30 px-3 py-2"
        />
        <label className="text-sm font-medium" htmlFor="upload-alt">
          {m.altText}
        </label>
        <input
          id="upload-alt"
          name="altText"
          placeholder={m.altTextHint}
          className="border border-ink-soft/30 px-3 py-2"
        />
        <button
          type="submit"
          className="self-start rounded-lg bg-rose-primary px-4 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {m.upload}
        </button>
      </form>

      {/* Ansicht umschalten: Kacheln / Liste */}
      <div className="mb-4 flex items-center gap-1 text-sm">
        <Link
          href="/admin/medien?ansicht=kacheln"
          aria-current={view === "kacheln"}
          className={`px-3 py-1.5 ${
            view === "kacheln"
              ? "bg-rose-primary font-semibold text-white"
              : "border border-ink/20 hover:bg-cream"
          }`}
        >
          {m.viewTiles}
        </Link>
        <Link
          href="/admin/medien?ansicht=liste"
          aria-current={view === "liste"}
          className={`px-3 py-1.5 ${
            view === "liste"
              ? "bg-rose-primary font-semibold text-white"
              : "border border-ink/20 hover:bg-cream"
          }`}
        >
          {m.viewList}
        </Link>
      </div>

      {images.length === 0 ? (
        <p className="text-ink-soft">{m.empty}</p>
      ) : view === "liste" ? (
        <ul className="flex flex-col gap-2">
          {images.map((img) => (
            <li
              key={img.id}
              className="flex items-center gap-4 bg-white p-3 shadow-sm"
            >
              <div className="h-16 w-16 shrink-0">
                <MediaThumb
                  thumbUrl={thumb(img)}
                  fullUrl={full(img)}
                  alt={img.altText}
                  className="h-16 w-16 object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={img.fileKey}>
                  {img.originalName}
                </p>
                <p className="text-xs text-ink-soft">
                  {img.width}×{img.height} · {m.uploadedOn}{" "}
                  {formatDate(img.createdAt)}
                </p>
                <form
                  action={updateAltTextAction}
                  className="mt-1.5 flex max-w-md gap-1"
                >
                  <input type="hidden" name="id" value={img.id} />
                  <input type="hidden" name="ansicht" value={view} />
                  <input
                    name="altText"
                    defaultValue={img.altText}
                    placeholder={m.altText}
                    className="w-full min-w-0 border border-ink-soft/30 px-2 py-1 text-xs"
                  />
                  <button
                    type="submit"
                    className="rounded border border-ink/20 px-2 py-1 text-xs hover:bg-cream"
                  >
                    {dict.common.save}
                  </button>
                </form>
              </div>
              <form action={deleteImageAction} className="shrink-0">
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
      ) : (
        // Kacheln — ~20 % kleiner als zuvor (mehr Spalten)
        <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {images.map((img) => (
            <li key={img.id} className="bg-white p-2.5 shadow-sm">
              <div className="mb-2">
                <MediaThumb
                  thumbUrl={thumb(img)}
                  fullUrl={full(img)}
                  alt={img.altText}
                  className="aspect-square w-full object-cover"
                />
              </div>
              <p className="truncate text-xs text-ink-soft" title={img.originalName}>
                {img.originalName}
              </p>
              <p className="text-[0.7rem] text-ink-soft">
                {img.width}×{img.height} · {formatDate(img.createdAt)}
              </p>
              <form action={updateAltTextAction} className="mt-2 flex gap-1">
                <input type="hidden" name="id" value={img.id} />
                <label className="sr-only" htmlFor={`alt-${img.id}`}>
                  {m.altText}
                </label>
                <input
                  id={`alt-${img.id}`}
                  name="altText"
                  defaultValue={img.altText}
                  placeholder={m.altText}
                  className="w-full min-w-0 border border-ink-soft/30 px-2 py-1 text-xs"
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
