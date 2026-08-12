import { test, expect } from "@playwright/test";

/**
 * Ansichts-Screenshots der Rezeptseite (Desktop, iPad, Handy) zur Abnahme des
 * Layouts: Zutaten und Zubereitung nebeneinander, Notizen zuletzt. Der
 * Equipment-Bereich ist öffentlich vorerst ausgeblendet — die Daten bleiben
 * aber erhalten (schema.org "tool").
 *
 * Bewusst KEIN Vergleichstest (kein toHaveScreenshot) — die Bilder dienen der
 * menschlichen Begutachtung vor dem Deployment. Die Struktur selbst wird
 * zusätzlich hart geprüft, damit „sieht gut aus" nicht die einzige Zusicherung
 * ist: Reihenfolge im Dokument und echte Nebeneinander-Anordnung (gleiche
 * Oberkante, unterschiedliche Spalten).
 */
const ZIEL = "tests/e2e/__screenshots__";

/**
 * Wählt ein Rezept, das im Datenbestand Equipment führt — erkennbar an
 * schema.org "tool" in den strukturierten Daten, denn sichtbar ist es nicht
 * mehr. Nur an so einem Rezept ist die Zusicherung „Equipment wird nicht
 * angezeigt" überhaupt aussagekräftig; sonst bestünde sie trivial.
 */
async function rezeptUrl(page: import("@playwright/test").Page) {
  await page.goto("/rezepte");
  const hrefs = await page.locator('a[href^="/rezepte/"]').evaluateAll((as) =>
    Array.from(new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!))),
  );
  expect(hrefs.length, "kein Rezept in der Übersicht gefunden").toBeGreaterThan(0);
  for (const href of hrefs) {
    await page.goto(href);
    if (await hatEquipmentInDaten(page)) return href;
  }
  throw new Error("kein Rezept mit Equipment gefunden — Seed unerwartet");
}

/** Liest die strukturierten Daten und prüft, ob dort Geräte hinterlegt sind. */
async function hatEquipmentInDaten(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some(
      (s) => {
        try {
          const daten = JSON.parse(s.textContent ?? "{}");
          const knoten = Array.isArray(daten) ? daten : [daten];
          return knoten.some(
            (k) => Array.isArray(k?.tool) && k.tool.length > 0,
          );
        } catch {
          // Kaputtes JSON-LD ist hier kein Treffer — der eigene JSON-LD-Test
          // deckt das ab; leer schlucken wäre sonst ein blinder Fleck.
          return false;
        }
      },
    ),
  );
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

test("Struktur: Zutaten neben Zubereitung, Notizen zuletzt, kein Equipment", async ({
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

    const zutaten = ueberschrift("zutaten");
    const zubereitung = ueberschrift("zubereitung");
    const notizen = ueberschrift("notiz") ?? ueberschrift("tipp");
    if (!zutaten || !zubereitung) return { fehler: "Überschriften fehlen" };

    const kasten = (el: Element | null) => el?.closest("section")?.getBoundingClientRect();
    const zutatenBox = kasten(zutaten)!;
    const zubereitungBox = kasten(zubereitung)!;

    return {
      // Ausgeblendet heißt: kein Wort davon im sichtbaren Artikel — weder als
      // Überschrift noch als Listeneintrag irgendwo anders.
      equipmentImText: /equipment|küchengerät/i.test(artikel.textContent ?? ""),
      // Nebeneinander: gleiche Oberkante, klar getrennte x-Bereiche.
      gleicheOberkante: Math.abs(zutatenBox.top - zubereitungBox.top) < 8,
      zutatenLinks: zutatenBox.left < zubereitungBox.left,
      keineUeberlappung: zutatenBox.right <= zubereitungBox.left + 1,
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
  if (ergebnis.notizenZuletzt !== null) expect(ergebnis.notizenZuletzt).toBe(true);

  // Equipment ist öffentlich ausgeblendet — obwohl dieses Rezept welches führt
  // (rezeptUrl wählt gezielt so eines aus).
  expect(
    ergebnis.equipmentImText,
    "Equipment ist wieder sichtbar",
  ).toBe(false);
  // … die Daten selbst sind aber NICHT verloren: sie stehen weiter in den
  // strukturierten Daten. Ausblenden darf kein Datenverlust sein.
  expect(await hatEquipmentInDaten(page)).toBe(true);

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

test("Mobil: die drei Zeiten stehen nebeneinander und bleiben einzeilig", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(await rezeptUrl(page));

  const zeiten = await page.evaluate(() => {
    const artikel = document.querySelector('article[id^="rezept-"]')!;
    const treffer = Array.from(artikel.querySelectorAll("p")).filter((p) =>
      /^(Vorbereitung|Kochzeit|Gesamtzeit)$/.test((p.textContent ?? "").trim()),
    );
    return treffer.map((p) => {
      const kasten = p.getBoundingClientRect();
      const zeilenhoehe = parseFloat(getComputedStyle(p).lineHeight);
      return {
        text: (p.textContent ?? "").trim(),
        oben: kasten.top,
        // Umbruch erkennen: mehr als eine Zeilenhöhe hoch = zweizeilig.
        umgebrochen: kasten.height > zeilenhoehe * 1.5,
      };
    });
  });

  expect(zeiten.length, "Zeit-Beschriftungen nicht gefunden").toBeGreaterThan(1);
  // Alle Beschriftungen auf derselben Höhe → eine Reihe, nicht gestapelt.
  const obersteKante = zeiten[0].oben;
  for (const z of zeiten) {
    expect(Math.abs(z.oben - obersteKante), `${z.text} steht nicht in der Reihe`)
      .toBeLessThan(2);
    expect(z.umgebrochen, `${z.text} bricht um`).toBe(false);
  }
});
