/**
 * Authentifizierung für den Next.js-Kontext: HttpOnly-Session-Cookie,
 * Guards für Admin-Seiten. Kernlogik in auth-core.ts (testbar).
 */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSession,
  destroySession,
  hashPassword,
  validateSessionToken,
  verifyPassword,
  SESSION_LIFETIME_MS,
  type AdminUser,
} from "./auth-core";

export {
  createSession,
  destroySession,
  hashPassword,
  validateSessionToken,
  verifyPassword,
};
export type { AdminUser };

const SESSION_COOKIE = "session";

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_LIFETIME_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Angemeldeten Admin ermitteln (oder null). */
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(token);
}

/** Für Admin-Seiten: leitet ohne gültige Session zum Login um. */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

export async function logoutCurrentSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  await clearSessionCookie();
}
