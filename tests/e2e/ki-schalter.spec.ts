import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * KI-Assistent im Admin: der Kill-Switch muss über die Oberfläche in BEIDE
 * Richtungen schaltbar sein.
 *
 * Befund 08/2026: der Auto-Halt schaltet das Feature ab und die Fehlermeldung
 * verweist auf „Einstellungen → KI-Assistent" — dort gab es aber nur das
 * Schlüsselfeld. Einmal ausgelöst, war das Feature ohne Datenbankeingriff
 * nicht mehr einzuschalten. Dieser Test geht den ganzen Weg durch das echte
 * Formular: ausschalten → Hinweis erscheint → wieder einschalten → Hinweis weg.
 */
const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);

async function alsAdmin(page: Page) {
  await page.context().addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
}

const schalter = (page: Page) =>
  page.getByRole("checkbox", { name: /KI-Assistent eingeschaltet/ });

async function speichern(page: Page) {
  await page
    .locator("form", { has: page.locator("#anthropic_api_key") })
    .getByRole("button", { name: "Speichern" })
    .click();
  await page.waitForURL(/meldung=/);
}

test("Kill-Switch lässt sich im Panel aus- UND wieder einschalten", async ({ page }) => {
  await alsAdmin(page);
  await page.goto("/admin/einstellungen");

  const hinweis = page.getByText("Der Assistent ist derzeit abgeschaltet", {
    exact: false,
  });

  // Ausgangslage: eingeschaltet, kein Hinweis.
  await expect(schalter(page)).toBeChecked();
  await expect(hinweis).toHaveCount(0);

  // Abschalten — so, wie es auch der Auto-Halt tut.
  await schalter(page).uncheck();
  await speichern(page);
  await expect(schalter(page)).not.toBeChecked();
  await expect(hinweis).toBeVisible();

  // Und zurück: genau der Weg, den die Fehlermeldung verspricht.
  await schalter(page).check();
  await speichern(page);
  await expect(schalter(page)).toBeChecked();
  await expect(hinweis).toHaveCount(0);
});

test("Schlüsselquelle wird benannt und ein gespeicherter Schlüssel ist entfernbar", async ({
  page,
}) => {
  await alsAdmin(page);
  await page.goto("/admin/einstellungen");

  const loeschen = page.getByRole("button", {
    name: "Gespeicherten Schlüssel entfernen",
  });
  const quelle = (text: string | RegExp) =>
    page.locator('label[for="anthropic_api_key"]').filter({ hasText: text });

  // Ohne gespeicherten Schlüssel gibt es auch nichts zu entfernen.
  await expect(quelle("nicht gesetzt")).toBeVisible();
  await expect(loeschen).toHaveCount(0);

  // Schlüssel eintragen → Quelle „hier gespeichert", Entfernen erscheint.
  await page.locator("#anthropic_api_key").fill("sk-ant-e2e-testschluessel");
  await speichern(page);
  await expect(quelle(/hier gespeichert/)).toBeVisible();
  await expect(loeschen).toBeVisible();

  // Entfernen — ohne diesen Weg bliebe ein falscher Schlüssel für immer stehen
  // und verdeckte die Umgebungsvariable.
  // Entfernen muss auch dann greifen, wenn im Schlüsselfeld noch Text steht:
  // das Feld behält nach dem Speichern seinen Inhalt (unkontrolliertes Feld,
  // Client-Navigation). Ein Kästchen im Speichern-Formular hätte hier mal
  // gelöscht und mal nicht — deshalb eine eigene Aktion.
  await page.locator("#anthropic_api_key").fill("sk-ant-noch-im-feld");
  await loeschen.click();
  await page.waitForURL(/meldung=/);
  await expect(quelle("nicht gesetzt")).toBeVisible();
  await expect(loeschen).toHaveCount(0);
});
