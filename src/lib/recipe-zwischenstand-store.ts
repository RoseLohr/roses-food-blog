/**
 * Die Ablage des Zwischenstands (Tabelle rezept_zwischenstand) — höchstens
 * eine Zeile je Schlüssel, nie gedeutet. Die Regeln stehen in
 * recipe-zwischenstand.ts; hier wird nur gelesen. Das Schreiben folgt.
 * Angeboten wird nur, was sich in den Editor laden ließe (`ladbareDatenAus`).
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ladbareDatenAus, type ZwischenstandDaten } from "@/lib/recipe-zwischenstand";

const zeilen = schema.rezeptZwischenstand;

export interface Zwischenstand {
  schluessel: string;
  recipeId: number | null;
  daten: ZwischenstandDaten;
  stand: string;
  gesichertAm: Date;
}

function alsZwischenstand(zeile: typeof zeilen.$inferSelect): Zwischenstand | null {
  const daten = ladbareDatenAus(zeile.formular);
  if (daten === null) {
    // Kein Formular, oder eines, das der Editor nicht aufnehmen kann. Die
    // Zeile wird nicht angeboten, aber auch nicht still: Der Betrieb soll es
    // sehen. Der Inhalt bleibt aus dem Log; er kann alles sein.
    console.error(`[zwischenstand] Zeile ${zeile.schluessel} lässt sich nicht laden und wird nicht angeboten.`);
    return null;
  }
  return {
    schluessel: zeile.schluessel,
    recipeId: zeile.recipeId,
    daten,
    stand: zeile.stand,
    gesichertAm: zeile.gesichertAm,
  };
}

export async function zwischenstandLaden(schluessel: string): Promise<Zwischenstand | null> {
  const zeile = db.select().from(zeilen).where(eq(zeilen.schluessel, schluessel)).get();
  return zeile ? alsZwischenstand(zeile) : null;
}
