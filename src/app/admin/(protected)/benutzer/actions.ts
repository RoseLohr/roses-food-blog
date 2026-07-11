"use server";

import { count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";

const dict = t();

function back(message: string): never {
  redirect(`/admin/benutzer?meldung=${encodeURIComponent(message)}`);
}

const createSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10),
});

export async function createUserAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) back(dict.admin.users.passwordTooShort);

  const existing = await db
    .select({ id: schema.adminUser.id })
    .from(schema.adminUser)
    .where(eq(schema.adminUser.email, parsed.data.email));
  if (existing.length > 0) back(dict.admin.users.exists);

  await db.insert(schema.adminUser).values({
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash: await hashPassword(parsed.data.password),
    createdAt: new Date(),
  });
  back(dict.admin.users.created);
}

export async function deleteUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) back(dict.common.error);
  if (id === admin.id) back(dict.admin.users.cannotDeleteSelf);

  const [total] = await db.select({ n: count() }).from(schema.adminUser);
  if (total.n <= 1) back(dict.admin.users.lastAdmin);

  await db.delete(schema.adminUser).where(eq(schema.adminUser.id, id));
  back(dict.common.saved);
}
