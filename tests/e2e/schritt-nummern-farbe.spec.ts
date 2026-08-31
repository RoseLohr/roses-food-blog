import { test, expect } from "@playwright/test";
import { t } from "@/i18n/de";

/**
 * Die Nummern der Zubereitungsschritte tragen DIESELBE Fläche wie der
 * „Lies mehr"-Knopf auf der Startseite (Wunsch 08/2026).
 *
 * Gemessen wird die AUSGERECHNETE Farbe beider Flächen, nicht der
 * Klassenname. Ein Test auf `bg-leaf` hielte nur fest, was im Quelltext
 * steht — er bliebe grün, wenn jemand das Token dahinter verschiebt und die
 * beiden Flächen damit auseinanderlaufen. Genau das soll er verhindern.
 *
 * Beide Klassen lösen heute auf #277a70 auf (--color-leaf und
 * --color-rose-primary), und im Nachtmodus fasst sie EINE Flächenregel
 * zusammen (`[data-theme="dark"] .bg-rose-primary, .bg-leaf`). Der Test
 * misst die Gleichheit, nicht den Wert — er hält auch, wenn die Marke
 * irgendwann eine andere Farbe bekommt.
 */
test("Schritt-Nummern tragen die Fläche des „Lies mehr\"-Knopfes", async ({
  page,
}) => {
  await page.goto("/");
  const knopf = page.getByRole("link", { name: t().home.aboutMore });
  await expect(knopf).toBeVisible();
  const knopfFlaeche = await knopf.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );

  await page.goto("/rezepte/linsen-bolognese-mit-vollkornnudeln");
  const nummer = page.locator("ol li > span[aria-hidden]").first();
  await expect(nummer).toBeVisible();
  const nummerFlaeche = await nummer.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );

  expect(
    nummerFlaeche,
    `Die Schritt-Nummer trägt ${nummerFlaeche}, der Knopf ${knopfFlaeche} — ` +
      "beide Flächen sollen gleich sein.",
  ).toBe(knopfFlaeche);
});
