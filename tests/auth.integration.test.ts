/**
 * Integrationstest Auth: Passwort-Hashing und Session-Lebenszyklus
 * gegen eine echte SQLite-Datei in einem Temp-Verzeichnis.
 */
import { describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("auth");

describe("Auth", () => {
  it("hasht und verifiziert Passwörter mit argon2id", async () => {
    const { hashPassword, verifyPassword } = await import("@/lib/auth-core");
    const h = await hashPassword("streng-geheim-123");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "streng-geheim-123")).toBe(true);
    expect(await verifyPassword(h, "falsch")).toBe(false);
    expect(await verifyPassword("kaputt", "egal")).toBe(false);
  });

  it("Session: erstellen, validieren, zerstören", async () => {
    const { createSession, validateSessionToken, destroySession, hashPassword } =
      await import("@/lib/auth-core");
    const { db, schema } = await import("@/db");

    const user = await adminAnlegen({
      passwordHash: await hashPassword("streng-geheim-123"),
    });

    const token = await createSession(user.id);
    expect(token).toHaveLength(64);

    const validated = await validateSessionToken(token);
    expect(validated?.email).toBe("rose@example.de");

    // Token wird nur gehasht gespeichert
    const raw = await db.select().from(schema.session);
    expect(raw[0].id).not.toBe(token);

    await destroySession(token);
    expect(await validateSessionToken(token)).toBeNull();
    expect(await validateSessionToken("f".repeat(64))).toBeNull();
  });
});
