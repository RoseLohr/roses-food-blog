"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";

const dict = t();

const slidesSchema = z.array(
  z.object({
    imageId: z.number().int().positive(),
    recipeId: z.number().int().positive().nullable(),
    caption: z.string().trim().max(200).default(""),
  }),
);

export async function saveHomepageAction(formData: FormData): Promise<void> {
  await requireAdmin();

  let slides: z.infer<typeof slidesSchema>;
  try {
    slides = slidesSchema.parse(JSON.parse(String(formData.get("slides") ?? "[]")));
  } catch {
    redirect(`/admin/startseite?meldung=${encodeURIComponent(dict.common.error)}`);
  }

  const interval = Math.min(
    60,
    Math.max(2, Number(formData.get("intervall")) || 6),
  );
  const popularCount = Math.min(
    12,
    Math.max(1, Number(formData.get("beliebteste")) || 6),
  );
  const latestCount = Math.min(
    12,
    Math.max(1, Number(formData.get("neueste")) || 6),
  );
  const aboutImageId = formData.get("aboutBild")
    ? Number(formData.get("aboutBild"))
    : null;

  await db
    .insert(schema.homepageConfig)
    .values({
      id: 1,
      sliderIntervalSeconds: interval,
      popularCount,
      latestCount,
      aboutTeaserImageId: aboutImageId,
      aboutTeaserText: String(formData.get("aboutText") ?? "").trim(),
      aboutTeaserLink:
        String(formData.get("aboutLink") ?? "").trim() || "/ueber-mich",
    })
    .onConflictDoUpdate({
      target: schema.homepageConfig.id,
      set: {
        sliderIntervalSeconds: interval,
        popularCount,
        latestCount,
        aboutTeaserImageId: aboutImageId,
        aboutTeaserText: String(formData.get("aboutText") ?? "").trim(),
        aboutTeaserLink:
          String(formData.get("aboutLink") ?? "").trim() || "/ueber-mich",
      },
    });

  await db.delete(schema.sliderItem);
  for (const [i, s] of slides.entries()) {
    await db.insert(schema.sliderItem).values({
      imageId: s.imageId,
      recipeId: s.recipeId,
      caption: s.caption,
      sortOrder: i,
    });
  }

  redirect(
    `/admin/startseite?meldung=${encodeURIComponent(dict.admin.homepage.saved)}`,
  );
}
