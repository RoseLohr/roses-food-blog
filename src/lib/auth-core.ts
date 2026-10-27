/**
 * Auth-Kernlogik ohne Next.js-Abhängigkeiten (testbar):
 * argon2id-Hashing und DB-Sessions mit Token-Hash (SHA-256).
 */
import { argon2id, argon2Verify } from "hash-wasm";
import crypto from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  SITZUNG_DAUER_MS,
  neuesAblaufdatum,
  sitzungsZustand,
  type SitzungsAnlass,
} from "@/lib/sitzung";

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
    expiresAt: new Date(Date.now() + SITZUNG_DAUER_MS),
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
  anlass: SitzungsAnlass,
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
  // Die Regeln stehen in src/lib/sitzung.ts — auch die Höchstdauer ab Login,
  // die eine gleitende Sitzung begrenzt. Das Browser-Cookie erneuert der
  // Proxy (src/proxy.ts); hier geht es nur um die Zeile. Abgelaufen ist
  // abgelaufen, egal aus welchem Anlass gelesen wird; GLEITEN darf die Zeile
  // nur bei einer Admin-Anfrage — dort, wo auch das Cookie gleitet.
  const jetzt = new Date();
  const zustand = sitzungsZustand(row.session, jetzt);
  if (zustand === "abgelaufen") {
    await db.delete(schema.session).where(eq(schema.session.id, row.session.id));
    return null;
  }
  if (zustand === "verlaengern" && anlass === "admin-anfrage") {
    await db
      .update(schema.session)
      .set({ expiresAt: neuesAblaufdatum(row.session.createdAt, jetzt) })
      .where(eq(schema.session.id, row.session.id));
  }
  return row.user;
}
