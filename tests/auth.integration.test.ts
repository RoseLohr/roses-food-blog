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

    const validated = await validateSessionToken(token, "admin-anfrage");
    expect(validated?.email).toBe("rose@example.de");

    // Token wird nur gehasht gespeichert
    const raw = await db.select().from(schema.session);
    expect(raw[0].id).not.toBe(token);

    await destroySession(token);
    expect(await validateSessionToken(token, "admin-anfrage")).toBeNull();
    expect(await validateSessionToken("f".repeat(64), "admin-anfrage")).toBeNull();
  });

  /**
   * Der Lebenszyklus gegen die echte Tabelle — jede Regel aus
   * src/lib/sitzung.ts einmal mit Zeilen, deren Zeitstempel direkt gesetzt
   * sind. Bis 10/2026 war davon nichts gepinnt.
   */
  it("Session: Ablauf, Verlängerung, Höchstdauer", async () => {
    const { createSession, validateSessionToken, tokenHash, hashPassword } =
      await import("@/lib/auth-core");
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const user = await adminAnlegen({
      email: "zeit@example.de",
      passwordHash: await hashPassword("streng-geheim-123"),
    });
    const TAG = 24 * 60 * 60 * 1000;
    const zeile = (token: string) =>
      db.select().from(schema.session).where(eq(schema.session.id, tokenHash(token))).get();
    const setze = (token: string, werte: { createdAt?: Date; expiresAt?: Date }) =>
      db.update(schema.session).set(werte).where(eq(schema.session.id, tokenHash(token))).run();

    // Abgelaufen: ungültig, und die Zeile ist weg.
    const abgelaufen = await createSession(user.id);
    setze(abgelaufen, { expiresAt: new Date(Date.now() - 1000) });
    expect(await validateSessionToken(abgelaufen, "admin-anfrage")).toBeNull();
    expect(zeile(abgelaufen)).toBeUndefined();

    // Frisch angelegt (14 Tage ab jetzt): nichts zu schreiben, die Zeile bleibt.
    const frisch = await createSession(user.id);
    const vorher = zeile(frisch)!.expiresAt.getTime();
    expect(await validateSessionToken(frisch, "admin-anfrage")).not.toBeNull();
    expect(zeile(frisch)!.expiresAt.getTime()).toBe(vorher);

    // Eine Stunde oder mehr hinter 14 Tagen ab jetzt — auch mit 8 Tagen Rest:
    // gleitet auf 14 Tage ab jetzt, wie das Cookie. (Bis 10/2026 erst unter
    // 7 Tagen Rest; dazwischen starb die Zeile vor dem Cookie.)
    const gleitend = await createSession(user.id);
    setze(gleitend, { expiresAt: new Date(Date.now() + 8 * TAG) });
    expect(await validateSessionToken(gleitend, "admin-anfrage")).not.toBeNull();
    const neu = zeile(gleitend)!.expiresAt.getTime();
    expect(Math.abs(neu - (Date.now() + 14 * TAG))).toBeLessThan(5000);

    // Älter als die Höchstdauer: ungültig, auch wenn das Ablaufdatum noch trüge.
    const uralt = await createSession(user.id);
    setze(uralt, { createdAt: new Date(Date.now() - 91 * TAG), expiresAt: new Date(Date.now() + TAG) });
    expect(await validateSessionToken(uralt, "admin-anfrage")).toBeNull();
    expect(zeile(uralt)).toBeUndefined();

    // Kurz vor der Höchstdauer: Die Verlängerung endet dort, nicht 14 Tage später.
    const spaet = await createSession(user.id);
    const login = new Date(Date.now() - 85 * TAG);
    setze(spaet, { createdAt: login, expiresAt: new Date(Date.now() + TAG) });
    expect(await validateSessionToken(spaet, "admin-anfrage")).not.toBeNull();
    expect(zeile(spaet)!.expiresAt.getTime()).toBe(login.getTime() + 90 * TAG);

    // Nur nachsehen (öffentliche Seite, Login-Seite): Die Zeile bleibt, wie
    // sie ist — auch wenn sie hinterherhinkt. Sonst gleitet die Zeile dort,
    // wo das Cookie nicht gleitet, und lebt bis zu 13 Tage länger als es.
    const nachsehen = await createSession(user.id);
    setze(nachsehen, { expiresAt: new Date(Date.now() + 8 * TAG) });
    expect(await validateSessionToken(nachsehen, "nur-nachsehen")).not.toBeNull();
    expect(Math.abs(zeile(nachsehen)!.expiresAt.getTime() - (Date.now() + 8 * TAG))).toBeLessThan(5000);
    // Abgelaufen ist abgelaufen — auch beim bloßen Nachsehen wird gelöscht.
    setze(nachsehen, { expiresAt: new Date(Date.now() - 1000) });
    expect(await validateSessionToken(nachsehen, "nur-nachsehen")).toBeNull();
    expect(zeile(nachsehen)).toBeUndefined();
  });
});
