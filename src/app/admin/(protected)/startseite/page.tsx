import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { thumbUrl } from "@/lib/media";
import { ImagePicker } from "@/components/admin/image-picker";
import { t } from "@/i18n/de";
import { saveHomepageAction } from "./actions";
import { SliderEditor, type SlideRow } from "./slider-editor";

const dict = t();
const d = dict.admin.homepage;

export const metadata: Metadata = { title: d.title };

const inputCls = "w-full rounded-lg border border-ink-soft/30 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";

export default async function HomepageAdminPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const message =
    typeof searchParams.meldung === "string" ? searchParams.meldung : null;

  const [config] = await db
    .select()
    .from(schema.homepageConfig)
    .where(eq(schema.homepageConfig.id, 1));
  const sliderItems = await db
    .select()
    .from(schema.sliderItem)
    .orderBy(asc(schema.sliderItem.sortOrder));
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
  const recipes = await db
    .select({ id: schema.recipe.id, title: schema.recipe.title })
    .from(schema.recipe)
    .orderBy(asc(schema.recipe.title));

  const initialSlides: SlideRow[] = sliderItems.map((s) => ({
    imageId: s.imageId,
    recipeId: s.recipeId,
    caption: s.caption,
  }));

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{d.title}</h1>
      {message && (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}

      <form action={saveHomepageAction} className="flex max-w-3xl flex-col gap-6">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="hp-intervall">
                {d.intervalLabel}
              </label>
              <input
                id="hp-intervall"
                name="intervall"
                type="number"
                min={2}
                max={60}
                defaultValue={config?.sliderIntervalSeconds ?? 6}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="hp-beliebteste">
                {d.popularCountLabel}
              </label>
              <input
                id="hp-beliebteste"
                name="beliebteste"
                type="number"
                min={1}
                max={12}
                defaultValue={config?.popularCount ?? 6}
                className={inputCls}
              />
            </div>
            <ImagePicker
              name="aboutBild"
              legend={d.aboutImageLabel}
              options={imageChoices}
              selectedIds={
                config?.aboutTeaserImageId ? [config.aboutTeaserImageId] : []
              }
              multiple={false}
            />
            <div>
              <label className={labelCls} htmlFor="hp-about-link">
                {d.aboutLinkLabel}
              </label>
              <input
                id="hp-about-link"
                name="aboutLink"
                defaultValue={config?.aboutTeaserLink ?? "/ueber-mich"}
                className={inputCls}
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls} htmlFor="hp-about-text">
                {d.aboutTextLabel}
              </label>
              <textarea
                id="hp-about-text"
                name="aboutText"
                rows={3}
                defaultValue={config?.aboutTeaserText ?? ""}
                className={inputCls}
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">{d.sliderTitle}</h2>
          <SliderEditor
            initial={initialSlides}
            images={imageChoices}
            recipes={recipes}
          />
        </section>

        <button
          type="submit"
          className="self-start rounded-lg bg-rose-primary px-5 py-2 font-semibold text-white hover:bg-rose-primary-dark"
        >
          {dict.common.save}
        </button>
      </form>
    </>
  );
}
