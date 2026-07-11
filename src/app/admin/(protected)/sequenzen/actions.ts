"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.admin.sequences;

function back(message: string): never {
  redirect(`/admin/sequenzen?meldung=${encodeURIComponent(message)}`);
}

const stepsSchema = z.array(
  z.object({
    delayHours: z.number().int().min(0).max(24 * 365),
    subject: z.string().trim().min(1).max(300),
    content: z.string().trim().max(20000),
  }),
);

export async function saveSequenceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) back(dict.common.error);

  let steps: z.infer<typeof stepsSchema>;
  try {
    steps = stepsSchema.parse(JSON.parse(String(formData.get("schritte") ?? "[]")));
  } catch {
    back(dict.common.error);
  }

  let sequenceId: number;
  if (id) {
    await db.update(schema.sequence).set({ name }).where(eq(schema.sequence.id, id));
    sequenceId = id;
  } else {
    const [created] = await db
      .insert(schema.sequence)
      .values({ name, active: false, createdAt: new Date() })
      .returning();
    sequenceId = created.id;
  }

  // Schritte ersetzen (Logs hängen an Schritten → nur bei Änderungen neu
  // anlegen; einfachste robuste Variante: löschen und neu einfügen).
  await db.delete(schema.sequenceStep).where(eq(schema.sequenceStep.sequenceId, sequenceId));
  for (const [i, s] of steps.entries()) {
    await db.insert(schema.sequenceStep).values({
      sequenceId,
      sortOrder: i,
      delayHours: s.delayHours,
      subject: s.subject,
      content: s.content,
    });
  }
  back(d.saved);
}

export async function toggleSequenceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    const [seq] = await db.select().from(schema.sequence).where(eq(schema.sequence.id, id));
    if (seq) {
      await db
        .update(schema.sequence)
        .set({ active: !seq.active })
        .where(eq(schema.sequence.id, id));
    }
  }
  back(d.saved);
}

export async function deleteSequenceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    await db.delete(schema.sequenceStep).where(eq(schema.sequenceStep.sequenceId, id));
    await db.delete(schema.sequence).where(eq(schema.sequence.id, id));
  }
  back(d.deleted);
}
