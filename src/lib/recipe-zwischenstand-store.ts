/**
 * Die Ablage des Zwischenstands (Tabelle rezept_zwischenstand) — höchstens
 * eine Zeile je Schlüssel, überschrieben, nie gedeutet. Die Regeln stehen in
 * recipe-zwischenstand.ts; hier wird nur geschrieben und gelesen.
 * Abgelegt und angeboten wird nach derselben Regel (`istLadbar`): nur, was
 * sich in den Editor laden ließe.
 *
 * `bekannterStand` ist der Schutz vor zwei Tabs am selben Rezept: Der Aufrufer
 * nennt den Stand, den er zuletzt gesichert oder geladen hat (null: keinen).
 * Trägt die Zeile einen ANDEREN, kennt er sie nicht — ein anderer Tab hat
 * gesichert, oder die Antwort auf die eigene Sicherung kam nie an. Dann wird
 * NICHT überschrieben, sondern „fremd" gemeldet; sonst verschwände still, was
 * dort gesichert wurde. Ausgenommen ist eine Zeile, die sich nicht laden
 * lässt (zeileLesen): Die kennt niemand, sie wird überschrieben. Und nennt er
 * einen Stand, obwohl es KEINE Zeile mehr gibt, wird nichts angelegt („weg"):
 * Die Zeile, die er fortsetzen will, ist fort — etwa beim Speichern
 * abgeräumt oder mit ihrem Rezept gelöscht.
 * Die Entscheidung trifft `sicherungsurteil`. Jede Sicherung bekommt einen
 * neuen, zufälligen Stand, der an keiner Uhr und keinem Zähler hängt. Lesen
 * und Schreiben stehen in einer Transaktion; der Treiber ist synchron, also
 * kommt nichts dazwischen.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  istLadbar,
  istZwischenstandSchluessel,
  ladbareDatenAus,
  rezeptnummerAus,
  sicherungsurteil,
  type ZwischenstandDaten,
} from "@/lib/recipe-zwischenstand";

type Transaktion = Parameters<Parameters<typeof db.transaction>[0]>[0];
const zeilen = schema.rezeptZwischenstand;

/**
 * Stand und Zeitpunkt der Zeile zum Schlüssel, und ob sie sich laden lässt
 * (`ladbareDatenAus` — dieselbe Regel, nach der `zwischenstandLaden` anbietet).
 * Eine Zeile, die niemand laden kann, bekommt niemand zu sehen, also kennt
 * niemand ihren Stand: Sie zählt nicht als „fremd" und sperrt das Sichern
 * nicht.
 */
function zeileLesen(
  tx: Transaktion,
  schluessel: string,
): { stand: string; gesichertAm: Date; ladbar: boolean } | null {
  const zeile = tx
    .select({ stand: zeilen.stand, gesichertAm: zeilen.gesichertAm, formular: zeilen.formular })
    .from(zeilen)
    .where(eq(zeilen.schluessel, schluessel))
    .get();
  return zeile
    ? { stand: zeile.stand, gesichertAm: zeile.gesichertAm, ladbar: ladbareDatenAus(zeile.formular) !== null }
    : null;
}

/**
 * „gesichert": der neue Stand der Zeile. „fremd": Stand und Zeitpunkt der Zeile,
 * die geblieben ist. „weg": Es gibt keine Zeile, und es wurde keine angelegt.
 */
export type Sicherung =
  | { ergebnis: "gesichert" | "fremd"; stand: string; gesichertAm: Date }
  | { ergebnis: "weg"; stand: null; gesichertAm: null };

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
  bekannterStand: string | null;
}): Promise<Sicherung> {
  const { schluessel, daten, jetzt, bekannterStand } = eingabe;
  // Woran die Zeile hängt, sagt ihr Schlüssel. Was keiner ist, wird nicht als
  // „neues Rezept" abgelegt.
  if (!istZwischenstandSchluessel(schluessel)) throw new Error("Zwischenstand: kein gültiger Schlüssel.");
  // Abgelegt wird nur, was sich laden ließe — dieselbe Regel, nach der angeboten
  // wird. Sonst bekäme der Aufrufer einen Stand für eine Zeile, die niemand zu
  // sehen bekommt und die jeder andere ohne Stand überschreibt.
  if (!istLadbar(daten)) throw new Error("Zwischenstand: Das Formular ließe sich nicht laden.");
  const formular = JSON.stringify(daten);
  return db.transaction((tx): Sicherung => {
    const zeile = zeileLesen(tx, schluessel);
    const urteil = sicherungsurteil(zeile, bekannterStand);
    if (urteil === "weg") return { ergebnis: "weg", stand: null, gesichertAm: null };
    if (zeile && urteil === "fremd") return { ergebnis: "fremd", stand: zeile.stand, gesichertAm: zeile.gesichertAm };
    const stand = randomUUID();
    tx.insert(zeilen)
      .values({ schluessel, recipeId: rezeptnummerAus(schluessel), formular, stand, gesichertAm: jetzt })
      .onConflictDoUpdate({ target: zeilen.schluessel, set: { formular, stand, gesichertAm: jetzt } })
      .run();
    return { ergebnis: "gesichert", stand, gesichertAm: jetzt };
  });
}

function alsZwischenstand(zeile: typeof zeilen.$inferSelect): Zwischenstand | null {
  const daten = ladbareDatenAus(zeile.formular);
  if (daten === null) {
    // Kein Formular, oder eines, das der Editor nicht aufnehmen kann: Die
    // Ablage legt beides nicht ab — die Zeile kommt von außen oder aus einer
    // früheren Fassung der Regel. Sie wird nicht angeboten, aber auch nicht
    // still: Der Betrieb soll es sehen. Der Inhalt bleibt aus dem Log; er
    // kann alles sein.
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
