import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * E2E des Mehrfach-Foto-Eingangs im KI-Rezeptassistenten (Neu-Anlage):
 * Der Datei-Input existiert, akzeptiert MEHRERE Bilder, gewählte Fotos
 * erscheinen als Liste mit Entfernen-Button, und der Erzeugen-Button ist
 * bereits mit Fotos OHNE Text aktiv (vorher: nur Text möglich).
 * Der echte Modellaufruf wird hier bewusst nicht ausgelöst (kein API-Key im
 * Testdatenstand) — der Server-Pfad ist per vitest abgedeckt.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);
const a = t().admin.aiRecipe;

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

test("KI-Assistent: mehrere Fotos wählbar, Liste + Entfernen, Button ohne Text aktiv", async ({
  page,
}) => {
  await page.goto("/admin/rezepte/neu");

  const input = page.getByLabel(a.photosLabel);
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute("multiple", "");
  await expect(input).toHaveAttribute("accept", /image\/jpeg/);

  // Ohne Text und ohne Fotos: Erzeugen deaktiviert.
  const generate = page.getByRole("button", { name: a.generate });
  await expect(generate).toBeDisabled();

  // Zwei kleine PNGs wählen (1×1 px, echte Bilddaten).
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await input.setInputFiles([
    { name: "seite-1.png", mimeType: "image/png", buffer: png },
    { name: "seite-2.png", mimeType: "image/png", buffer: png },
  ]);

  // Beide Fotos gelistet, Erzeugen jetzt aktiv (Fotos ohne Text genügen).
  await expect(page.getByText("seite-1.png")).toBeVisible();
  await expect(page.getByText("seite-2.png")).toBeVisible();
  await expect(generate).toBeEnabled();

  // Entfernen wirkt: erstes Foto raus, zweites bleibt.
  await page.getByRole("button", { name: a.photoRemove("seite-1.png") }).click();
  await expect(page.getByText("seite-1.png")).toBeHidden();
  await expect(page.getByText("seite-2.png")).toBeVisible();
});
