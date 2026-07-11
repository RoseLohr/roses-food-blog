/**
 * Integrationstest Auth: Passwort-Hashing und Session-Lebenszyklus
 * gegen eine echte SQLite-Datei in einem Temp-Verzeichnis.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-auth-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", {
    env: { ...process.env, DATA_DIR: tmp },
  });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

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

    const [user] = await db
      .insert(schema.adminUser)
      .values({
        email: "rose@example.de",
        passwordHash: await hashPassword("streng-geheim-123"),
        name: "Rose",
        createdAt: new Date(),
      })
      .returning();

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
