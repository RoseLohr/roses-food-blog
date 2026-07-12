"use client";

/**
 * Slider-Editor: Liste der Slides (Bild, verlinktes Rezept, Unterschrift,
 * Reihenfolge per Hoch/Runter), serialisiert als JSON in ein Hidden-Field.
 */
import { useState } from "react";
import { ImagePicker, type ImageChoice } from "@/components/admin/image-picker";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.homepage;

export interface SlideRow {
  imageId: number;
  recipeId: number | null;
  caption: string;
}

const inputCls = "w-full rounded-lg border border-ink-soft/30 px-3 py-2 text-sm";
const btnSecondary =
  "rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-cream";

export function SliderEditor({
  initial,
  images,
  recipes,
}: {
  initial: SlideRow[];
  images: ImageChoice[];
  recipes: Array<{ id: number; title: string }>;
}) {
  const [slides, setSlides] = useState<SlideRow[]>(initial);

  const update = (i: number, patch: Partial<SlideRow>) =>
    setSlides((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const move = (i: number, dir: -1 | 1) =>
    setSlides((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="slides" value={JSON.stringify(slides)} />
      {slides.map((s, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border border-ink/10 p-3">
          <ImagePicker
            legend={d.sliderImage}
            options={images}
            value={s.imageId ? [s.imageId] : []}
            onChange={(ids) =>
              ids[0] !== undefined && update(i, { imageId: ids[0] })
            }
            multiple={false}
            clearable={false}
          />
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="mb-1 block text-xs text-ink-soft" htmlFor={`slide-rezept-${i}`}>
                {d.sliderRecipe}
              </label>
              <select
                id={`slide-rezept-${i}`}
                value={s.recipeId ?? ""}
                onChange={(e) =>
                  update(i, {
                    recipeId: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className={inputCls}
              >
                <option value="">{d.sliderNoRecipe}</option>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
              <a
                href="/admin/rezepte/neu"
                target="_blank"
                rel="noopener"
                className="mt-1 inline-block text-xs text-leaf underline-offset-2 hover:underline"
              >
                + {dict.quickAdd.newRecipeHint}
              </a>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-soft" htmlFor={`slide-text-${i}`}>
                {d.sliderCaption}
              </label>
              <input
                id={`slide-text-${i}`}
                value={s.caption}
                onChange={(e) => update(i, { caption: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="flex items-end gap-1">
              <button type="button" onClick={() => move(i, -1)} aria-label={`${d.moveUp} ${i + 1}`} className={btnSecondary}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} aria-label={`${d.moveDown} ${i + 1}`} className={btnSecondary}>
                ↓
              </button>
              <button
                type="button"
                onClick={() => setSlides((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label={`${dict.common.delete} ${i + 1}`}
                className={btnSecondary}
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setSlides((prev) => [
            ...prev,
            { imageId: images[0]?.id ?? 0, recipeId: null, caption: "" },
          ])
        }
        className={`${btnSecondary} self-start`}
      >
        + {d.addSlide}
      </button>
    </div>
  );
}
