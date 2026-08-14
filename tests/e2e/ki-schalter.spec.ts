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

const einschalten = (page: Page) =>
  page.getByRole("button", { name: "KI-Assistent einschalten" });
const abschalten = (page: Page) =>
  page.getByRole("button", { name: "KI-Assistent abschalten" });
const zustand = (page: Page) => page.getByText(/^Zustand: /);

async function speichern(page: Page) {
  await page
    .locator("form", { has: page.locator("#anthropic_api_key") })
    .getByRole("button", { name: "Speichern" })
    .click();
  await page.waitForURL(/meldung=/);
}

async function schalten(page: Page, knopf: ReturnType<typeof einschalten>) {
  await knopf.click();
  await page.waitForURL(/meldung=/);
}

test("Kill-Switch lässt sich im Panel aus- UND wieder einschalten", async ({ page }) => {
  await alsAdmin(page);
  await page.goto("/admin/einstellungen");

  const hinweis = page.getByText("Der Assistent ist derzeit abgeschaltet", {
    exact: false,
  });

  // Ausgangslage: eingeschaltet, kein Hinweis.
  await expect(zustand(page)).toHaveText("Zustand: eingeschaltet");
  await expect(hinweis).toHaveCount(0);

  // Abschalten — so, wie es auch der Auto-Halt tut.
  await schalten(page, abschalten(page));
  await expect(zustand(page)).toHaveText("Zustand: abgeschaltet");
  await expect(hinweis).toBeVisible();

  // Und zurück: genau der Weg, den die Fehlermeldung verspricht.
  await schalten(page, einschalten(page));
  await expect(zustand(page)).toHaveText("Zustand: eingeschaltet");
  await expect(hinweis).toHaveCount(0);
});

test("Speichern nimmt einen zwischenzeitlichen Auto-Halt NICHT zurück", async ({
  browser,
}) => {
  // Befund gpt-5.6-sol (PR #61): trüge der Schalter als Feld im Speichern-
  // Formular mit, schriebe das nächste Speichern irgendeiner unbeteiligten
  // Einstellung den Zustand vom Seitenaufbau zurück — und öffnete den
  // fail-closed Kill-Switch ohne Absicht. Hier nachgestellt mit zwei
  // Sitzungen: A sieht „eingeschaltet", B schaltet ab, A speichert SMTP.
  const a = await browser.newPage();
  const b = await browser.newPage();
  await alsAdmin(a);
  await alsAdmin(b);

  await a.goto("/admin/einstellungen");
  await expect(zustand(a)).toHaveText("Zustand: eingeschaltet");

  await b.goto("/admin/einstellungen");
  await schalten(b, abschalten(b));
  await expect(zustand(b)).toHaveText("Zustand: abgeschaltet");

  // A weiß nichts davon und speichert eine völlig andere Einstellung.
  await a.locator("#smtp_host").fill("smtp.beispiel.test");
  await speichern(a);

  // Der Kill-Switch muss zu bleiben — in BEIDEN Sitzungen.
  await expect(zustand(a)).toHaveText("Zustand: abgeschaltet");
  await b.reload();
  await expect(zustand(b)).toHaveText("Zustand: abgeschaltet");

  // Aufräumen, damit die folgenden Tests eine eingeschaltete KI vorfinden.
  await schalten(b, einschalten(b));
  await a.close();
  await b.close();
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
