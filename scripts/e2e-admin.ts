/**
 * E2E-Vorbereitung: legt einen Admin, eine Session, ein Editier-Rezept und
 * einen Editier-Reisebericht (beide Entwurf, damit die öffentlichen E2E-Tests
 * unberührt bleiben) an und schreibt { token, email, passwort, recipeId,
 * travelId } nach $DATA_DIR/e2e-session.json. Wird nach dem Seed aufgerufen.
 * Nur für E2E.
 */
import fs from "node:fs";
import path from "node:path";
import { and, asc, desc, ne } from "drizzle-orm";
import { db, schema } from "../src/db";
import { createSession, hashPassword } from "../src/lib/auth-core";
import { saveRecipeFromForm } from "../src/lib/recipe-save";
import { saveTravelFromForm } from "../src/lib/travel-save";

/**
 * Derselbe feste Zeitpunkt wie in scripts/seed.ts — nicht die Uhr.
 *
 * Das Editier-Rezept steht in der Admin-Rezeptliste unter „Zuletzt
 * bearbeitet". Dort trägt die Zelle zwar `data-referenz-maske`, aber eine Maske
 * deckt die PIXEL ab, nicht die BREITE (B31). Am 10.10.2026 war das Datum zum
 * ersten Mal seit Aufnahme der Basis zweistellig in Tag UND Monat, die Spalte
 * wurde breiter, „Aktionen" rutschte nach rechts — admin-rezepte und
 * admin-rezepte-meldung @ ipad-834 waren rot, ohne dass jemand die Seite
 * angefasst hatte.
 *
 * Die Saat war längst festgenagelt; dieser Weg nicht, weil er über die
 * PRODUKTIONS-Speicherfunktionen geht, und die nehmen zu Recht die Uhr. Sie
 * bekommen den Zeitpunkt deshalb als Parameter, wie `storeImage`.
 *
 * Gleichheit mit der Saat misst tests/saat-zeitpunkt.test.ts an der Datenbank:
 * Läuft dieser Wert auseinander, wird die Kontrolle rot.
 */
const NOW = new Date("2026-01-15T12:00:00");

/**
 * Ein ECHTES Passwort, damit ein Spec den Formular-Login durchlaufen kann
 * (tests/e2e/sitzung-verlaengerung.spec.ts: der Rückweg nach dem Login). Nur
 * in der E2E-Datenbank unter .pw-data; die Saat selbst kennt es nicht.
 */
const E2E_EMAIL = "e2e@rose.de";
const E2E_PASSWORT = "e2e-zugang-roses-blog";

async function main() {
  const [admin] = await db
    .insert(schema.adminUser)
    .values({
      email: E2E_EMAIL,
      passwordHash: await hashPassword(E2E_PASSWORT),
      name: "E2E",
      createdAt: NOW,
    })
    .returning();

  const fd = new FormData();
  fd.set("titel", "E2E Editor-Rezept");
  fd.set("teaser", "URSPRUNG Kurzbeschreibung.");
  fd.set("portionen", "4");
  fd.set("status", "entwurf");
  fd.set(
    "abschnitte",
    JSON.stringify([
      { name: "", ingredients: [{ name: "Mehl", amount: "1", unit: "kg", note: "" }], steps: ["Backen."] },
    ]),
  );
  fd.set("notizen", "[]");
  const res = await saveRecipeFromForm(fd, admin.id, NOW);
  if (!("recipeId" in res)) throw new Error("E2E: Rezept-Anlage fehlgeschlagen");

  // Editier-Reisebericht mit drei Bildblöcken: zwei Nachbarn (= eine Reihe)
  // und ein L-Bild (steht allein). Am Blockeditor lässt sich damit jede Rolle
  // des Stufenschalters prüfen, ohne den öffentlichen Beispielbericht anzufassen.
  const bilder = await db
    .select({ id: schema.mediaImage.id })
    .from(schema.mediaImage)
    .orderBy(asc(schema.mediaImage.id))
    .limit(3);
  if (bilder.length < 3) throw new Error("E2E: zu wenige Bilder für den Reise-Editor");
  const tfd = new FormData();
  tfd.set("titel", "E2E Editor-Reise");
  tfd.set("status", "entwurf");
  tfd.set("restaurants", "[]");
  tfd.set(
    "bloecke",
    JSON.stringify([
      { type: "text", markdown: "Ausgangstext." },
      // Drei Bilder als EINE Gruppe (Marke 1). Ohne Marke wären es drei
      // Einzelbilder — seit 08/2026 entsteht eine Gruppe nicht mehr dadurch,
      // dass Bildblöcke zufällig nebeneinanderstehen, sondern nur, weil
      // jemand sie ausgewählt hat. Diese Vorlage prüft den Editor an einer
      // Gruppe, also sagt sie das jetzt auch.
      { type: "bild", imageId: bilder[0].id, gruppe: 1 },
      { type: "bild", imageId: bilder[1].id, gruppe: 1 },
      { type: "bild", imageId: bilder[2].id, gruppe: 1 },
    ]),
  );
  const travelRes = await saveTravelFromForm(tfd, admin.id, NOW);
  if (!("travelId" in travelRes)) throw new Error("E2E: Reise-Anlage fehlgeschlagen");

  // Ein Zwischenstand (10/2026) an einem Saat-Rezept, das sonst keine
  // Aufnahme zeigt — nicht die Linsen-Bolognese (admin-rezept-abschnitte),
  // nicht das Editier-Rezept (admin-rezept-bearbeiten). Daran hängen die
  // Aufnahmen admin-rezept-zwischenstand (der Hinweis beim Öffnen) und
  // admin-rezept-wiederhergestellt (?zwischenstand=1). Gleicher Zeitpunkt wie
  // das Rezept: „nicht älter als" schließt den gleichen Augenblick ein.
  const [saatRezept] = await db
    .select({ id: schema.recipe.id, title: schema.recipe.title })
    .from(schema.recipe)
    .where(and(ne(schema.recipe.title, "Linsen-Bolognese"), ne(schema.recipe.id, res.recipeId)))
    .orderBy(desc(schema.recipe.id))
    .limit(1);
  if (!saatRezept) throw new Error("E2E: kein Saat-Rezept für den Zwischenstand");
  await db.insert(schema.rezeptZwischenstand).values({
    schluessel: `rezept:${saatRezept.id}`,
    recipeId: saatRezept.id,
    formular: JSON.stringify({
      id: [String(saatRezept.id)],
      titel: [`${saatRezept.title} (Zwischenstand)`],
      teaser: ["Ein Teaser, der noch nicht gespeichert ist."],
      portionen: ["6"],
      status: ["entwurf"],
      abschnitte: [JSON.stringify([{ name: "", ingredients: [], steps: [{ text: "Noch ein Schritt.", imageId: null }] }])],
      notizen: ["[]"],
    }),
    createdAt: NOW,
    updatedAt: NOW,
  });

  // Die Sitzung behält bewusst die Uhr: Ihr Ablauf ist kein angezeigter Wert,
  // sondern Gültigkeit — mit dem Saat-Zeitpunkt wäre sie seit Februar abgelaufen.
  const token = await createSession(admin.id);
  const dataDir = process.env.DATA_DIR ?? "./data";
  fs.writeFileSync(
    path.join(dataDir, "e2e-session.json"),
    JSON.stringify({
      token,
      email: E2E_EMAIL,
      passwort: E2E_PASSWORT,
      recipeId: res.recipeId,
      travelId: travelRes.travelId,
      zwischenstandRecipeId: saatRezept.id,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
