/**
 * Wiederkehrende Testdaten.
 *
 * ── WARUM HIER NUR DYNAMISCH IMPORTIERT WIRD ──────────────────────────────
 *
 * `src/db/index.ts` legt die Verbindung beim AUSWERTEN des Moduls an. Diese
 * Datei wird von Testdateien am MODULANFANG importiert — also möglicherweise
 * bevor `frischeDb()` `DATA_DIR` gesetzt hat. Ein statisches
 * `import { db } from "@/db"` hier würde die Verbindung an die falsche Datei
 * binden, und zwar für die ganze Testdatei. Deshalb holt jede Funktion `@/db`
 * erst beim Aufruf, und `tests/frische-db-helfer.test.ts` hält das fest.
 */

/** Ein Redakteur, wie ihn acht Testdateien brauchen. */
export async function adminAnlegen(
  abweichend: { email?: string; name?: string; passwordHash?: string } = {},
) {
  const { db, schema } = await import("@/db");
  const [admin] = await db
    .insert(schema.adminUser)
    .values({
      email: "rose@example.de",
      passwordHash: "x",
      name: "Rose",
      createdAt: new Date(),
      ...abweichend,
    })
    .returning();
  return admin;
}
