/**
 * E2E-Vorbereitung: legt einen Admin, eine Session, ein Editier-Rezept und
 * einen Editier-Reisebericht (beide Entwurf, damit die öffentlichen E2E-Tests
 * unberührt bleiben) an und schreibt { token, recipeId, travelId } nach
 * $DATA_DIR/e2e-session.json. Wird nach dem Seed aufgerufen. Nur für E2E.
 */
import fs from "node:fs";
import path from "node:path";
import { asc } from "drizzle-orm";
import { db, schema } from "../src/db";
import { createSession } from "../src/lib/auth-core";
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

async function main() {
  const [admin] = await db
    .insert(schema.adminUser)
    .values({
      email: "e2e@rose.de",
      passwordHash: "x",
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

  // Die Sitzung behält bewusst die Uhr: Ihr Ablauf ist kein angezeigter Wert,
  // sondern Gültigkeit — mit dem Saat-Zeitpunkt wäre sie seit Februar abgelaufen.
  const token = await createSession(admin.id);
  const dataDir = process.env.DATA_DIR ?? "./data";
  fs.writeFileSync(
    path.join(dataDir, "e2e-session.json"),
    JSON.stringify({
      token,
      recipeId: res.recipeId,
      travelId: travelRes.travelId,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
