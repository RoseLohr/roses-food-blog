/**
 * Auth-Kernlogik ohne Next.js-Abhängigkeiten (testbar):
 * argon2id-Hashing und DB-Sessions mit Token-Hash (SHA-256).
 */
import { argon2id, argon2Verify } from "hash-wasm";
import crypto from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";

export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000; // 14 Tage
export const RENEW_BELOW_MS = 7 * 24 * 60 * 60 * 1000;

// argon2id via hash-wasm (WebAssembly). Bewusst NICHT @node-rs/argon2: dessen
// native Binärdatei nutzt CPU-Befehle (SIMD), die auf alten CPUs ohne SSE4.2
// (z. B. Intel Atom/Bonnell) einen SIGILL auslösen. WASM läuft prozessor-
// unabhängig; das Ausgabeformat ist Standard-PHC ($argon2id$...), also
// kompatibel zu evtl. vorhandenen @node-rs/argon2-Hashes.
const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 2,
  memorySize: 19456, // KiB
  hashLength: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: crypto.randomBytes(16),
    ...ARGON2_PARAMS,
    outputType: "encoded",
  });
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: passwordHash });
  } catch {
    return false;
  }
}

export function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(adminUserId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await db.insert(schema.session).values({
    id: tokenHash(token),
    adminUserId,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
    createdAt: new Date(),
  });
  // Abgelaufene Sessions bei Gelegenheit aufräumen
  await db.delete(schema.session).where(lt(schema.session.expiresAt, new Date()));
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(schema.session).where(eq(schema.session.id, tokenHash(token)));
}

export type AdminUser = typeof schema.adminUser.$inferSelect;

export async function validateSessionToken(
  token: string,
): Promise<AdminUser | null> {
  const rows = await db
    .select({ session: schema.session, user: schema.adminUser })
    .from(schema.session)
    .innerJoin(
      schema.adminUser,
      eq(schema.session.adminUserId, schema.adminUser.id),
    )
    .where(eq(schema.session.id, tokenHash(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.session.expiresAt.getTime() < Date.now()) {
    await db.delete(schema.session).where(eq(schema.session.id, row.session.id));
    return null;
  }
  if (row.session.expiresAt.getTime() - Date.now() < RENEW_BELOW_MS) {
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) })
      .where(eq(schema.session.id, row.session.id));
  }
  return row.user;
}
