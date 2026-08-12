import { test, expect } from "@playwright/test";

/**
 * Ansichts-Screenshots der Rezeptseite (Desktop und iPad) zur Abnahme des
 * neuen Layouts: Equipment als eigener, getönter Bereich; darunter Zutaten und
 * Zubereitung nebeneinander; Notizen zuletzt.
 *
 * Bewusst KEIN Vergleichstest (kein toHaveScreenshot) — die Bilder dienen der
 * menschlichen Begutachtung vor dem Deployment. Die Struktur selbst wird
 * zusätzlich hart geprüft, damit „sieht gut aus" nicht die einzige Zusicherung
 * ist: Reihenfolge im Dokument und echte Nebeneinander-Anordnung (gleiche
 * Oberkante, unterschiedliche Spalten).
 */
const ZIEL = "tests/e2e/__screenshots__";

/**
 * Bevorzugt ein Rezept MIT Equipment — sonst zeigt der Screenshot genau den
 * neuen Bereich nicht. Fällt auf das erste Rezept zurück, falls keines
 * Equipment führt.
 */
async function rezeptUrl(page: import("@playwright/test").Page) {
  await page.goto("/rezepte");
  const hrefs = await page.locator('a[href^="/rezepte/"]').evaluateAll((as) =>
    Array.from(new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!))),
  );
  expect(hrefs.length, "kein Rezept in der Übersicht gefunden").toBeGreaterThan(0);
  for (const href of hrefs) {
    await page.goto(href);
    const hatEquipment = await page.evaluate(() => {
      const artikel = document.querySelector('article[id^="rezept-"]');
      if (!artikel) return false;
      return Array.from(artikel.querySelectorAll("h2")).some((h) =>
        /equipment|gerät/i.test(h.textContent ?? ""),
      );
    });
    if (hatEquipment) return href;
  }
  return hrefs[0];
}

for (const [name, breite, hoehe] of [
  ["desktop-1280", 1280, 1400],
  ["ipad-quer-1024", 1024, 1366],
  ["ipad-hoch-834", 834, 1194],
  ["mobil-390", 390, 844],
] as const) {
  test(`Rezept-Layout: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: breite, height: hoehe });
    const url = await rezeptUrl(page);
    await page.goto(url);

    const artikel = page.locator('article[id^="rezept-"]');
    await expect(artikel).toBeVisible();
    // Bilder fertig laden lassen, damit der Screenshot nichts Halbes zeigt.
    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images)
          .filter((i) => !i.complete)
          .map((i) => new Promise((r) => i.addEventListener("load", r, { once: true }))),
      ),
    );
    await page.screenshot({
      path: `${ZIEL}/rezept-${name}.png`,
      fullPage: true,
    });
  });
}

test("Struktur: Equipment abgesetzt, Zutaten neben Zubereitung, Notizen zuletzt", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto(await rezeptUrl(page));

  const ergebnis = await page.evaluate(() => {
    const artikel = document.querySelector('article[id^="rezept-"]');
    if (!artikel) return { fehler: "kein Artikel" };
    const ueberschrift = (text: string) =>
      Array.from(artikel.querySelectorAll("h2")).find((h) =>
        (h.textContent ?? "").toLowerCase().includes(text),
      ) ?? null;

    const equip = ueberschrift("equipment") ?? ueberschrift("gerät");
    const zutaten = ueberschrift("zutaten");
    const zubereitung = ueberschrift("zubereitung");
    const notizen = ueberschrift("notiz") ?? ueberschrift("tipp");
    if (!zutaten || !zubereitung) return { fehler: "Überschriften fehlen" };

    const kasten = (el: Element | null) => el?.closest("section")?.getBoundingClientRect();
    const zutatenBox = kasten(zutaten)!;
    const zubereitungBox = kasten(zubereitung)!;

    return {
      equipmentVorhanden: Boolean(equip),
      // Getönter, eigener Bereich?
      equipmentGetoent: equip
        ? getComputedStyle(equip.closest("section")!).backgroundColor
        : null,
      // Nebeneinander: gleiche Oberkante, klar getrennte x-Bereiche.
      gleicheOberkante: Math.abs(zutatenBox.top - zubereitungBox.top) < 8,
      zutatenLinks: zutatenBox.left < zubereitungBox.left,
      keineUeberlappung: zutatenBox.right <= zubereitungBox.left + 1,
      // Dokumentreihenfolge Equipment → Zutaten → Notizen
      equipmentVorZutaten: equip
        ? !!(equip.compareDocumentPosition(zutaten) & Node.DOCUMENT_POSITION_FOLLOWING)
        : null,
      notizenZuletzt: notizen
        ? !!(zubereitung.compareDocumentPosition(notizen) & Node.DOCUMENT_POSITION_FOLLOWING)
        : null,
      // Portionen/Kalorien gehören unter „Zutaten", die Schwierigkeit unter
      // „Zubereitung" — und nirgends sonst (kein doppelter Chip-Block mehr).
      zutatenSpalte: zutaten.closest("section")!.textContent ?? "",
      zubereitungSpalte: zubereitung.closest("section")!.textContent ?? "",
      schwierigkeitGesamt: (artikel.textContent ?? "").split("Schwierigkeit")
        .length - 1,
      kcalImArtikel: (artikel.textContent ?? "").includes("kcal"),
    };
  });

  expect(ergebnis.fehler).toBeUndefined();
  expect(ergebnis.gleicheOberkante, "Zutaten und Zubereitung stehen nicht nebeneinander").toBe(true);
  expect(ergebnis.zutatenLinks).toBe(true);
  expect(ergebnis.keineUeberlappung).toBe(true);
  if (ergebnis.equipmentVorhanden) {
    expect(ergebnis.equipmentVorZutaten).toBe(true);
    // Getönt = nicht transparent und nicht reines Weiß.
    expect(ergebnis.equipmentGetoent).not.toBe("rgba(0, 0, 0, 0)");
    expect(ergebnis.equipmentGetoent).not.toBe("rgb(255, 255, 255)");
  }
  if (ergebnis.notizenZuletzt !== null) expect(ergebnis.notizenZuletzt).toBe(true);

  // Portionen (mit Rechner) und Kalorien stehen in der Zutaten-Spalte …
  expect(ergebnis.zutatenSpalte).toContain("Portionen");
  // Kalorien sind optional (nicht jedes Rezept führt sie) — wenn sie im
  // Artikel stehen, dann in der Zutaten-Spalte.
  if (ergebnis.kcalImArtikel) {
    expect(ergebnis.zutatenSpalte).toMatch(/kcal pro Portion/);
  }
  expect(ergebnis.zutatenSpalte).not.toContain("Schwierigkeit");
  // … die Schwierigkeit in der Zubereitungs-Spalte, und zwar genau einmal
  // im ganzen Artikel (der frühere Chip-Block darf nicht zurückkehren).
  expect(ergebnis.zubereitungSpalte).toContain("Schwierigkeit");
  expect(ergebnis.schwierigkeitGesamt).toBe(1);
});

test("Mobil bleibt gestapelt (keine gequetschten Spalten)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(await rezeptUrl(page));
  const gestapelt = await page.evaluate(() => {
    const artikel = document.querySelector('article[id^="rezept-"]')!;
    const h = (t: string) =>
      Array.from(artikel.querySelectorAll("h2")).find((x) =>
        (x.textContent ?? "").toLowerCase().includes(t),
      );
    const a = h("zutaten")?.closest("section")?.getBoundingClientRect();
    const b = h("zubereitung")?.closest("section")?.getBoundingClientRect();
    if (!a || !b) return null;
    return b.top >= a.bottom - 1; // untereinander
  });
  expect(gestapelt).toBe(true);
});
