/**
 * Die Ablage des Zwischenstands (Tabelle rezept_zwischenstand) — höchstens
 * eine Zeile je Schlüssel, überschrieben, nie gedeutet. Die Regeln stehen in
 * recipe-zwischenstand.ts; hier wird nur geschrieben und gelesen.
 * Angeboten wird nur, was sich in den Editor laden ließe (`ladbareDatenAus`).
 * Dass auch nur das abgelegt wird, prüft die Ablage noch nicht; das folgt.
 *
 * Jede Sicherung bekommt einen neuen, zufälligen Stand, der an keiner Uhr und
 * keinem Zähler hängt. Noch nicht: Der Stand schützt noch nichts — die Ablage
 * überschreibt, was liegt, wer es auch gesichert hat. Der Schutz vor zwei
 * Tabs folgt im nächsten Schritt.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  istZwischenstandSchluessel,
  ladbareDatenAus,
  rezeptnummerAus,
  type ZwischenstandDaten,
} from "@/lib/recipe-zwischenstand";

const zeilen = schema.rezeptZwischenstand;

/** „gesichert": der neue Stand der Zeile. */
export type Sicherung = { ergebnis: "gesichert"; stand: string; gesichertAm: Date };

export interface Zwischenstand {
  schluessel: string;
  recipeId: number | null;
  daten: ZwischenstandDaten;
  stand: string;
  gesichertAm: Date;
}

export async function zwischenstandSichern(eingabe: {
  schluessel: string;
  daten: ZwischenstandDaten;
  jetzt: Date;
}): Promise<Sicherung> {
  const { schluessel, daten, jetzt } = eingabe;
  // Woran die Zeile hängt, sagt ihr Schlüssel. Was keiner ist, wird nicht als
  // „neues Rezept" abgelegt.
  if (!istZwischenstandSchluessel(schluessel)) throw new Error("Zwischenstand: kein gültiger Schlüssel.");
  const formular = JSON.stringify(daten);
  const stand = randomUUID();
  db.insert(zeilen)
    .values({ schluessel, recipeId: rezeptnummerAus(schluessel), formular, stand, gesichertAm: jetzt })
    .onConflictDoUpdate({ target: zeilen.schluessel, set: { formular, stand, gesichertAm: jetzt } })
    .run();
  return { ergebnis: "gesichert", stand, gesichertAm: jetzt };
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
