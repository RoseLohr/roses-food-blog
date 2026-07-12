"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import {
  createSession,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/request";
import { t } from "@/i18n/de";

const dict = t();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const ip = await getClientIp();
  const limited = rateLimit(`login:${ip}`, 10, 15 * 60 * 1000);
  if (!limited.ok) return { error: dict.common.tooManyRequests };

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: dict.auth.invalidCredentials };

  const users = await db
    .select()
    .from(schema.adminUser)
    .where(eq(schema.adminUser.email, parsed.data.email))
    .limit(1);
  const user = users[0];
  // Auch bei unbekannter E-Mail einen echten Hash prüfen (Timing-Angleichung).
  // Gültiger argon2id-PHC-String, damit argon2Verify echte Arbeit leistet.
  const DUMMY_HASH =
    "$argon2id$v=19$m=19456,t=2,p=1$LE313si0DPpZI0S8FoNLng$r/Vw4KZsRdlb+dBARHNGeIhY6nb9bfT18oQuAj4LJRc";
  const ok = await verifyPassword(
    user?.passwordHash ?? DUMMY_HASH,
    parsed.data.password,
  );
  if (!user || !ok) return { error: dict.auth.invalidCredentials };

  const token = await createSession(user.id);
  await setSessionCookie(token);
  redirect("/admin");
}
