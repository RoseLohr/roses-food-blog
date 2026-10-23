/**
 * Die Ablage des Zwischenstands (Tabelle rezept_zwischenstand) — eine Zeile je
 * Schlüssel, überschrieben, nie gedeutet. Die Regeln stehen in
 * recipe-zwischenstand.ts; hier wird nur geschrieben und gelesen.
 *
 * `bekannterStand` ist der Schutz vor zwei Tabs am selben Rezept: Jeder Editor
 * sagt, welchen Stand (ms) er zuletzt gesichert oder geladen hat. Liegt in der
 * Zeile ein jüngerer, hat ein anderer Tab inzwischen gesichert — dann wird
 * NICHT überschrieben, sondern „fremd" gemeldet. Sonst verschwände still, was
 * dort getippt wurde. Lesen und Schreiben stehen in einer Transaktion; der
 * Treiber ist synchron, also kommt nichts dazwischen.
 */
import "server-only";
import { desc, eq, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { aufbewahrungsgrenze, type ZwischenstandDaten } from "@/lib/recipe-zwischenstand";

export type Sicherung =
  | { ergebnis: "gesichert"; gespeichertAm: Date }
  | { ergebnis: "fremd"; gespeichertAm: Date };

export interface Zwischenstand {
  schluessel: string;
  recipeId: number | null;
  daten: ZwischenstandDaten;
  gespeichertAm: Date;
}

export async function zwischenstandSichern(eingabe: {
  schluessel: string;
  recipeId: number | null;
  daten: ZwischenstandDaten;
  jetzt: Date;
  bekannterStand: number;
}): Promise<Sicherung> {
  const { schluessel, recipeId, daten, jetzt, bekannterStand } = eingabe;
  return db.transaction((tx): Sicherung => {
    const vorhanden = tx
      .select({ updatedAt: schema.rezeptZwischenstand.updatedAt })
      .from(schema.rezeptZwischenstand)
      .where(eq(schema.rezeptZwischenstand.schluessel, schluessel))
      .get();
    if (vorhanden && vorhanden.updatedAt.getTime() > bekannterStand) {
      return { ergebnis: "fremd", gespeichertAm: vorhanden.updatedAt };
    }
    const formular = JSON.stringify(daten);
    tx.insert(schema.rezeptZwischenstand)
      .values({ schluessel, recipeId, formular, createdAt: jetzt, updatedAt: jetzt })
      .onConflictDoUpdate({
        target: schema.rezeptZwischenstand.schluessel,
        set: { recipeId, formular, updatedAt: jetzt },
      })
      .run();
    return { ergebnis: "gesichert", gespeichertAm: jetzt };
  });
}

function alsZwischenstand(zeile: typeof schema.rezeptZwischenstand.$inferSelect): Zwischenstand | null {
  let daten: unknown;
  try {
    daten = JSON.parse(zeile.formular);
  } catch (err) {
    // Eine Zeile, die kein JSON trägt, kann nur von außen kommen — sie wird
    // nicht angeboten, aber auch nicht still: Der Betrieb soll es sehen.
    console.error(`[zwischenstand] Zeile ${zeile.schluessel} trägt kein JSON:`, err);
    return null;
  }
  return {
    schluessel: zeile.schluessel,
    recipeId: zeile.recipeId,
    daten: daten as ZwischenstandDaten,
    gespeichertAm: zeile.updatedAt,
  };
}

export async function zwischenstandLaden(schluessel: string): Promise<Zwischenstand | null> {
  const zeile = db
    .select()
    .from(schema.rezeptZwischenstand)
    .where(eq(schema.rezeptZwischenstand.schluessel, schluessel))
    .get();
  return zeile ? alsZwischenstand(zeile) : null;
}

export type Verwerfung = { ergebnis: "verworfen" } | { ergebnis: "fremd"; gespeichertAm: Date };

/**
 * „Verwerfen" löscht nur, was der Redakteur gesehen hat: Liegt in der Zeile
 * ein jüngerer Stand als der bekannte (ein anderer Tab hat inzwischen
 * gesichert), bleibt sie — dieselbe Regel wie beim Sichern. Der Hinweis nennt
 * eine Uhrzeit; verworfen werden darf genau dieser Stand, nicht, was gerade
 * zufällig in der Zeile liegt. Keine Zeile: nichts zu vergleichen, nichts zu
 * löschen — kein Fehler, „Verwerfen" ist idempotent.
 */
export async function zwischenstandVerwerfen(eingabe: {
  schluessel: string;
  bekannterStand: number;
}): Promise<Verwerfung> {
  const { schluessel, bekannterStand } = eingabe;
  return db.transaction((tx): Verwerfung => {
    const vorhanden = tx
      .select({ updatedAt: schema.rezeptZwischenstand.updatedAt })
      .from(schema.rezeptZwischenstand)
      .where(eq(schema.rezeptZwischenstand.schluessel, schluessel))
      .get();
    if (vorhanden && vorhanden.updatedAt.getTime() > bekannterStand) {
      return { ergebnis: "fremd", gespeichertAm: vorhanden.updatedAt };
    }
    tx.delete(schema.rezeptZwischenstand).where(eq(schema.rezeptZwischenstand.schluessel, schluessel)).run();
    return { ergebnis: "verworfen" };
  });
}

/** Begonnene NEUE Rezepte — zum Fortsetzen auf /admin/rezepte/neu, jüngste zuerst. */
export async function offeneNeueZwischenstaende(): Promise<
  Array<{ schluessel: string; titel: string; gespeichertAm: Date }>
> {
  const zeilen = db
    .select()
    .from(schema.rezeptZwischenstand)
    .where(isNull(schema.rezeptZwischenstand.recipeId))
    .orderBy(desc(schema.rezeptZwischenstand.updatedAt))
    .all();
  return zeilen
    .map(alsZwischenstand)
    .filter((z): z is Zwischenstand => z !== null)
    .map((z) => ({
      schluessel: z.schluessel,
      // Roh, wie getippt — ein Zwischenstand deutet nichts, auch den Titel nicht.
      titel: z.daten.titel?.[0] ?? "",
      gespeichertAm: z.gespeichertAm,
    }));
}

/** Räumt ab, was länger als die Aufbewahrung nicht mehr gesichert wurde. Liefert die Anzahl. */
export async function zwischenstaendeAufraeumen(jetzt: Date = new Date()): Promise<number> {
  const ergebnis = db
    .delete(schema.rezeptZwischenstand)
    .where(lt(schema.rezeptZwischenstand.updatedAt, aufbewahrungsgrenze(jetzt)))
    .run();
  return ergebnis.changes;
}
