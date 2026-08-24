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

async function main() {
  const [admin] = await db
    .insert(schema.adminUser)
    .values({
      email: "e2e@rose.de",
      passwordHash: "x",
      name: "E2E",
      createdAt: new Date(),
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
  const res = await saveRecipeFromForm(fd, admin.id);
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
      { type: "bild", imageId: bilder[0].id },
      { type: "bild", imageId: bilder[1].id },
      { type: "bild", imageId: bilder[2].id },
    ]),
  );
  const travelRes = await saveTravelFromForm(tfd, admin.id);
  if (!("travelId" in travelRes)) throw new Error("E2E: Reise-Anlage fehlgeschlagen");

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
