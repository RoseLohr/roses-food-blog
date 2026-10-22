/**
 * Authentifizierung für den Next.js-Kontext: HttpOnly-Session-Cookie,
 * Guards für Admin-Seiten. Kernlogik in auth-core.ts (testbar).
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSession,
  destroySession,
  hashPassword,
  validateSessionToken,
  verifyPassword,
  type AdminUser,
} from "./auth-core";
import {
  PFAD_KOPF,
  SITZUNGS_COOKIE,
  sichererRueckweg,
  sitzungsCookieOptionen,
} from "./sitzung";

export {
  createSession,
  destroySession,
  hashPassword,
  validateSessionToken,
  verifyPassword,
};
export type { AdminUser };

/**
 * Beim Login gesetzt — und seit 10/2026 bei jeder Admin-Anfrage vom Proxy
 * erneuert (src/proxy.ts), mit denselben Attributen aus src/lib/sitzung.ts.
 */
export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(
    SITZUNGS_COOKIE,
    token,
    sitzungsCookieOptionen(process.env.NODE_ENV === "production"),
  );
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SITZUNGS_COOKIE);
}

/** Angemeldeten Admin ermitteln (oder null). */
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const token = (await cookies()).get(SITZUNGS_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(token);
}

/**
 * Für Admin-Seiten: leitet ohne gültige Session zum Login um — mit dem Weg
 * zurück. Den angefragten Pfad liefert der Proxy im Kopf `x-pfad`; ohne ihn
 * (oder mit einem, der nicht in den Admin zeigt) landet der Login auf /admin.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    const zurueck = sichererRueckweg((await headers()).get(PFAD_KOPF));
    redirect(zurueck ? `/admin/login?zurueck=${encodeURIComponent(zurueck)}` : "/admin/login");
  }
  return admin;
}

export async function logoutCurrentSession(): Promise<void> {
  const token = (await cookies()).get(SITZUNGS_COOKIE)?.value;
  if (token) await destroySession(token);
  await clearSessionCookie();
}
