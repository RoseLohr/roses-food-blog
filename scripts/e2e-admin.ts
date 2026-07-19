/**
 * E2E-Vorbereitung: legt einen Admin, eine Session und ein Editier-Rezept
 * (Entwurf, damit die öffentlichen E2E-Tests unberührt bleiben) an und schreibt
 * { token, recipeId } nach $DATA_DIR/e2e-session.json. Wird von
 * tests/e2e/global-setup.ts nach dem Seed aufgerufen. Ausschließlich für E2E.
 */
import fs from "node:fs";
import path from "node:path";
import { db, schema } from "../src/db";
import { createSession } from "../src/lib/auth-core";
import { saveRecipeFromForm } from "../src/lib/recipe-save";

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

  const token = await createSession(admin.id);
  const dataDir = process.env.DATA_DIR ?? "./data";
  fs.writeFileSync(
    path.join(dataDir, "e2e-session.json"),
    JSON.stringify({ token, recipeId: res.recipeId }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
