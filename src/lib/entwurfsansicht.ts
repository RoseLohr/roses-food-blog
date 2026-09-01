/**
 * WER darf einen Entwurf sehen — und wie diese Antwort durch den Code reist.
 *
 * ── DIE AUFGABE ─────────────────────────────────────────────────────────────
 *
 * Ein angemeldeter Admin soll den Blog mit seinen Entwürfen ansehen können:
 * auf der Startseite, in den Listen, auf den Detailseiten — jeweils mit einer
 * Plakette „Entwurf". Ein anonymer Besucher sieht davon NICHTS.
 *
 * ── WARUM KEIN `boolean` ────────────────────────────────────────────────────
 *
 * Weil ein Wahrheitswert an der Aufrufstelle nichts sagt. `karten(true)` ist
 * nicht lesbar, `karten(false)` genauso wenig, und ein vertauschtes Paar fällt
 * niemandem auf. Ein `sichtbarkeit: "auch-entwuerfe"` sagt sich selbst, und
 * ein Tippfehler darin ist ein Typfehler.
 *
 * ── WARUM KEIN VORGABEWERT ──────────────────────────────────────────────────
 *
 * Das ist die eigentliche Absicherung. Ein optionaler Parameter mit der
 * Vorgabe „nur veröffentlicht" sähe sicher aus und wäre es nicht: Er macht
 * genau die Aufrufstellen unsichtbar, an denen jemand später etwas ändert.
 * Umgekehrt wäre eine Vorgabe „auch Entwürfe" ein Leck ab dem ersten
 * vergessenen Argument.
 *
 * Deshalb ist der Parameter PFLICHT. Wer eine Liste lädt, muss sagen, für wen.
 * Der Übersetzer zählt die Stellen — nicht die Aufmerksamkeit des Lesers. Und
 * wer eine neue Abfrage schreibt, wird an Ort und Stelle gefragt, statt still
 * die bequeme Hälfte zu erben.
 *
 * ── WOHER DIE ANTWORT KOMMT ─────────────────────────────────────────────────
 *
 * `sichtbarkeitFuerBesucher()` ist die EINZIGE Stelle, die dafür die Session
 * liest. Sie gibt einen Wert zurück, keinen Benutzer: Für diese Frage geht
 * niemanden an, WER angemeldet ist — und `getCurrentAdmin()` liefert die
 * vollständige admin_user-Zeile samt Passwort-Hash, die hier nirgends
 * hingehört und nirgends weitergereicht wird.
 *
 * ── WAS DIESER SCHALTER NICHT TUT ───────────────────────────────────────────
 *
 * Er wirkt AUSSCHLIESSLICH auf die Zeilen, die die Datenbank liefert. Er ist
 * kein Anzeige-Schalter: Ein Entwurf, den jemand nicht sehen darf, wird nicht
 * geladen — nicht geladen und dann ausgeblendet. Der Unterschied ist nicht
 * kosmetisch. Alles, was eine Server-Komponente an eine Client-Komponente
 * reicht, steht im RSC-Payload und im HTML; „laden und verbergen" hieße, den
 * Entwurf im Quelltext mitzuliefern.
 *
 * Ebenso wenig wirkt er auf MASCHINENLESBARE Ausgaben. sitemap.xml, llms.txt,
 * robots.txt, die Suche, die Weltkarte, die Navigation, „ähnliche Rezepte",
 * der Newsletter und die Druckansicht bleiben ohne Ausnahme bei
 * veröffentlichten Inhalten — auch dann, wenn gerade ein Admin angemeldet ist.
 * Sie richten sich an Dritte oder verlassen die Sitzung; eine Vorschau hat
 * dort nichts zu suchen. `loadSeoContent()` bekommt deshalb bewusst KEINEN
 * Parameter dieser Art.
 */
import "server-only";
import { eq, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { getCurrentAdmin } from "@/lib/auth";
import { VEROEFFENTLICHT } from "@/db/schema";

/** Der gespeicherte Status eines veröffentlichten Inhalts. */
// Der Wert selbst steht im Schema (siehe dort, warum). Hier steht die Regel,
// die ihn auswertet — und sie reicht ihn weiter, damit Aufrufstellen der Regel
// nicht zwei Adressen kennen muessen.
export { VEROEFFENTLICHT };

/**
 * Für wen wird geladen?
 *
 * Zwei Werte, ausgeschrieben. `"nur-veroeffentlicht"` ist das, was jede
 * Ausgabe an Dritte trägt; `"auch-entwuerfe"` gilt allein für die Ansicht
 * eines angemeldeten Admins im Browser.
 */
export type Sichtbarkeit = "nur-veroeffentlicht" | "auch-entwuerfe";

/**
 * Was der aktuelle Besucher sehen darf.
 *
 * Die EINZIGE Stelle im öffentlichen Bereich, die dafür die Sitzung liest.
 * Aufzurufen in der Server-Komponente, bevor geladen wird — nicht im Layout:
 * Ein Layout rendert neben seinen `children` und kann deren Datenabfrage nicht
 * beeinflussen.
 */
export async function sichtbarkeitFuerBesucher(): Promise<Sichtbarkeit> {
  return (await getCurrentAdmin()) ? "auch-entwuerfe" : "nur-veroeffentlicht";
}

/**
 * Darf dieser Datensatz gezeigt werden?
 *
 * Für Einzelabrufe, bei denen erst die Zeile da ist und dann die Frage kommt
 * (Detailseiten laden über den Slug). Ein Inhalt, der nicht gezeigt werden
 * darf, führt dort zu `notFound()` — nicht zu einer Seite mit leerem Inhalt:
 * Ein 404 verrät nicht, dass es den Slug gibt.
 */
export function darfGezeigtWerden(
  status: string,
  sichtbarkeit: Sichtbarkeit,
): boolean {
  return status === VEROEFFENTLICHT || sichtbarkeit === "auch-entwuerfe";
}

/**
 * Ist dieser Inhalt ein Entwurf?
 *
 * Die Gegenfrage zu `darfGezeigtWerden`, und sie hat einen eigenen Namen,
 * weil sie eine andere Sache entscheidet: nicht OB gezeigt wird, sondern WIE.
 * Ein Entwurf, der auf dem Bildschirm des Angemeldeten steht, bekommt die
 * Plakette — und er bekommt KEINE strukturierten Daten.
 *
 * Warum das zusammengehört: JSON-LD ist eine Ausgabe für MASCHINEN, genau wie
 * Sitemap und llms.txt. Dass die Seite nur der Angemeldete öffnen kann, ist
 * kein Grund, in ihr einen unveröffentlichten Beitrag als `Recipe` mit URL,
 * Bild und (fehlendem) Erscheinungsdatum zu beschreiben. Wer die Seite mit
 * einem Werkzeug liest — Erweiterung, Lesezeichendienst, Link-Vorschau —,
 * bekäme sonst maschinenlesbar etwas, das es öffentlich nicht gibt.
 */
export function istEntwurf(status: string): boolean {
  return status !== VEROEFFENTLICHT;
}

/**
 * Die WHERE-Bedingung für eine Statusspalte — oder `undefined`, wenn nicht
 * eingeschränkt werden soll.
 *
 * `undefined` ist hier kein Versehen, sondern die Form, die drizzles `and()`
 * erwartet: Es lässt undefinierte Glieder weg. Wichtig ist die Aufrufform —
 * das Ergebnis gehört IN ein `and(...)` neben die übrigen Bedingungen, nie
 * allein in ein `.where()`, wo aus `undefined` „gar kein Filter" würde.
 */
export function statusBedingung(
  spalte: AnyColumn,
  sichtbarkeit: Sichtbarkeit,
): SQL | undefined {
  return sichtbarkeit === "auch-entwuerfe"
    ? undefined
    : eq(spalte, VEROEFFENTLICHT);
}
