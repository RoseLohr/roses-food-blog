"use client";

/**
 * Slider-Editor: Liste der Slides (Bild, verlinktes Rezept, Unterschrift,
 * Reihenfolge per Hoch/Runter), serialisiert als JSON in ein Hidden-Field.
 *
 * Bis 10/2026 trug er eine EIGENE Abschrift der Tausch-Rechnung, seine Pfeile
 * waren am Rand nicht abgeschaltet, und die Folien waren über den Index
 * verschlüsselt UND beschrieben. Jede Folie hat einen Bild-Picker — ein
 * Upload, der erst nach einem Verschieben zurückkam, setzte das Bild in die
 * Folie, die inzwischen an der alten Stelle stand (tests/e2e/slider-reihenfolge
 * .spec.ts). Jetzt: dieselben Helfer und Pfeile wie im übrigen Admin.
 */
import { useState } from "react";
import { ImagePicker, type ImageChoice } from "@/components/admin/image-picker";
import { Verschiebeknoepfe } from "@/components/admin/verschiebeknoepfe";
import { btnSecondary } from "@/components/admin/knopf-stil";
import {
  geaendertNach,
  neuerSchluessel,
  ohneEintrag,
  schluessellos,
  verschobenNach,
} from "@/lib/reihenfolge";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.homepage;

export interface SlideRow {
  imageId: number;
  recipeId: number | null;
  caption: string;
}

/** Eine Folie im Editor — mit Identität, die das Formular nie verlässt. */
interface KartenFolie extends SlideRow {
  schluessel: string;
}

const alsKarte = (f: SlideRow): KartenFolie => ({ ...f, schluessel: neuerSchluessel("folie") });

const inputCls = "w-full border border-ink-soft/30 px-3 py-2 text-sm";

export function SliderEditor({
  initial,
  images,
  recipes,
}: {
  initial: SlideRow[];
  images: ImageChoice[];
  recipes: Array<{ id: number; title: string }>;
}) {
  const [slides, setSlides] = useState<KartenFolie[]>(() => initial.map(alsKarte));

  /** Eine Folie ändern — über ihren Schlüssel, aus dem aktuellen Stand. */
  const aendere = (fKey: string, aendern: (f: KartenFolie) => KartenFolie) =>
    setSlides((prev) => geaendertNach(prev, fKey, aendern));

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="slides" value={JSON.stringify(slides.map(schluessellos))} />
      {slides.map((s, i) => {
        const fKey = s.schluessel;
        return (
        <div key={fKey} className="flex flex-col gap-3 border border-ink/10 p-3">
          <ImagePicker
            legend={d.sliderImage}
            options={images}
            value={s.imageId ? [s.imageId] : []}
            onChange={(ids) => {
              const imageId = ids[0];
              if (imageId !== undefined) aendere(fKey, (f) => ({ ...f, imageId }));
            }}
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
                onChange={(e) => {
                  const recipeId = e.target.value ? Number(e.target.value) : null;
                  aendere(fKey, (f) => ({ ...f, recipeId }));
                }}
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
                onChange={(e) => {
                  const caption = e.target.value;
                  aendere(fKey, (f) => ({ ...f, caption }));
                }}
                className={inputCls}
              />
            </div>
            <div className="flex items-end gap-1">
              <Verschiebeknoepfe
                stelle={i}
                anzahl={slides.length}
                verschiebe={(r) => setSlides((prev) => verschobenNach(prev, fKey, r))}
                nachOben={d.moveUp}
                nachUnten={d.moveDown}
              />
              <button
                type="button"
                onClick={() => setSlides((prev) => ohneEintrag(prev, fKey))}
                aria-label={`${dict.common.delete} ${i + 1}`}
                className={btnSecondary}
              >
                ×
              </button>
            </div>
          </div>
        </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          setSlides((prev) => [
            ...prev,
            alsKarte({ imageId: images[0]?.id ?? 0, recipeId: null, caption: "" }),
          ])
        }
        className={`${btnSecondary} self-start`}
      >
        + {d.addSlide}
      </button>
    </div>
  );
}
