import { test, expect, type Page } from "@playwright/test";

/**
 * Das Einzelbild im Reisebericht — an der ECHTEN Seite, nicht am Prüfstand.
 *
 * Der Entwurf ist in tests/e2e/einzelbild-mock.spec.ts an einer isolierten
 * Seite gemessen worden: vier Spaltenbreiten × drei Größen × zwei Seiten.
 * Das belegt die CSS-Mechanik, aber nicht, dass sie im Bericht ankommt —
 * zwischen beiden liegen Tailwind-Utilities, die Prosa-Klasse, das
 * Inhaltsverzeichnis und die Frage, ob der Renderer die Angaben überhaupt
 * durchreicht. Genau diese Lücke prüft diese Datei.
 *
 * Gemessen wird GEOMETRIE (Breiten, Kanten, Zeilenanfänge), nicht der
 * Klassenname: Ein Umbenennen darf nicht rot färben, ein verlorener Umfluss
 * schon.
 *
 * Die Saat stellt beide Fälle nebeneinander (scripts/seed.ts):
 *   • ein Drittel der Spalte, LINKS  — der Text fließt rechts daneben
 *   • die halbe Spalte, RECHTS       — der Text fließt links daneben
 *   • daneben unverändert drei Gruppen, die NICHT umflossen werden
 */
const BERICHT = "/reisen/streetfood-und-trattorien-in-sizilien";

/**
 * Die Breite der Inhaltsspalte, in der ein Einzelbild schwimmt — also die
 * Breite seines Elternelements. Der Anteil rechnet sich gegen SIE, nicht
 * gegen das Blatt: Das Blatt trägt noch Innenabstand.
 */
async function spaltenbreite(bild: ReturnType<Page["locator"]>) {
  return bild.evaluate(
    (el) => (el.parentElement as HTMLElement).getBoundingClientRect().width,
  );
}

test.describe("Reisebericht: Einzelbilder werden umflossen", () => {
  test("Größe: der Anteil an der Inhaltsspalte stimmt (1/3 und 1/2)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BERICHT);

    const bilder = page.locator("article .einzelbild");
    await expect(bilder).toHaveCount(2);

    const drittel = bilder.nth(0);
    const haelfte = bilder.nth(1);

    const spalte = await spaltenbreite(drittel);
    expect(spalte).toBeGreaterThan(400);

    const b1 = (await drittel.boundingBox())!;
    const b2 = (await haelfte.boundingBox())!;
    // Ein halbes Pixel Toleranz — mehr braucht ein Prozentwert nicht, und
    // mehr würde eine vertauschte Stufe (1/3 ↔ 1/2) durchgehen lassen.
    expect(b1.width).toBeCloseTo(spalte / 3, 0);
    expect(b2.width).toBeCloseTo(spalte / 2, 0);
  });

  test("Seite: das eine steht links, das andere rechts in der Spalte", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BERICHT);

    const links = page.locator("article .einzelbild").nth(0);
    const rechts = page.locator("article .einzelbild").nth(1);

    expect(await links.evaluate((el) => getComputedStyle(el).float)).toBe(
      "left",
    );
    expect(await rechts.evaluate((el) => getComputedStyle(el).float)).toBe(
      "right",
    );

    const spalte = await links.evaluate((el) => {
      const r = (el.parentElement as HTMLElement).getBoundingClientRect();
      return { x: r.x, rechts: r.x + r.width };
    });
    const bl = (await links.boundingBox())!;
    const br = (await rechts.boundingBox())!;
    expect(Math.abs(bl.x - spalte.x)).toBeLessThan(2);
    expect(Math.abs(br.x + br.width - spalte.rechts)).toBeLessThan(2);
  });

  test("der Text läuft wirklich daneben — und darunter weiter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BERICHT);

    const bild = page.locator("article .einzelbild").nth(0);
    const kasten = (await bild.boundingBox())!;
    const spalte = await spaltenbreite(bild);

    // Die ZEILENKÄSTEN des folgenden Textes. Der Block danach reicht über die
    // ganze Spalte — sichtbar verkürzt sind nur die Zeilen. Deshalb wird der
    // Bereich über den ersten ABSATZ gelegt und nicht über seinen Container:
    // dessen erster Rechteck-Eintrag ist der Blockkasten selbst (gemessen
    // x=232 w=816), und daran ist dieser Test im ersten Anlauf hängen
    // geblieben — er hätte einen verlorenen Umfluss nicht gemerkt.
    const zeilen = await bild.evaluate((el) => {
      const nachbar = el.nextElementSibling as HTMLElement;
      const absaetze = [...nachbar.querySelectorAll("p")];
      return absaetze.flatMap((p) => {
        const bereich = document.createRange();
        bereich.selectNodeContents(p);
        return [...bereich.getClientRects()].map((r) => ({
          x: r.x,
          breite: r.width,
          y: r.y,
        }));
      });
    });
    expect(zeilen.length).toBeGreaterThan(5);

    // Die erste Textzeile beginnt RECHTS neben dem Bild …
    expect(zeilen[0].x).toBeGreaterThan(kasten.x + kasten.width - 1);
    // … und liegt auf seiner Höhe, nicht darunter.
    expect(zeilen[0].y).toBeLessThan(kasten.y + kasten.height);

    // Unterhalb des Bildes läuft der Text wieder über die volle Spalte: Der
    // Umfluss endet mit dem Bild, er drängt den Text nicht dauerhaft ein.
    //
    // Gesucht wird dafür im ganzen Bericht und nicht im Absatz daneben: Das
    // Bild ist hier HÖHER als der Absatz, der es umfließt (409 px gegen
    // sieben Zeilen), also hat jener Absatz gar keine Zeile unterhalb. Das
    // ist keine Schwäche der Umsetzung, sondern die Länge des Saat-Textes —
    // der erste Anlauf dieses Tests hat sie für einen Fehler gehalten.
    const unten = await page.evaluate(
      ([grenze, mindest]) => {
        const absaetze = [
          ...document.querySelectorAll<HTMLElement>("article .prose-content p"),
        ];
        return absaetze
          .flatMap((p) => {
            const bereich = document.createRange();
            bereich.selectNodeContents(p);
            return [...bereich.getClientRects()];
          })
          .filter((r) => r.y > grenze)
          .some((r) => r.width > mindest);
      },
      [kasten.y + kasten.height, spalte * 0.8] as [number, number],
    );
    expect(unten, "keine Zeile unterhalb des Bildes läuft voll durch").toBe(
      true,
    );
  });

  test("Gruppenbilder werden NICHT umflossen — die Regel gilt nur einzeln", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BERICHT);

    const gruppen = page.locator("article .bildgruppe");
    await expect(gruppen).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      const g = gruppen.nth(i);
      expect(
        await g.evaluate((el) => getComputedStyle(el).float),
        `Gruppe ${i} schwimmt`,
      ).toBe("none");
      // Volle Spaltenbreite — eine Gruppe teilt sich die Zeile mit nichts.
      const spalte = await spaltenbreite(g);
      const box = (await g.boundingBox())!;
      expect(Math.abs(box.width - spalte)).toBeLessThan(2);
    }
  });

  test("mobil steht das Einzelbild über die volle Breite, ohne Umfluss", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(BERICHT);

    // Unter 640 px wäre ein Drittel der Spalte rund 100 px breit; daneben
    // stünden zwei Wörter je Zeile. Dieselbe Entscheidung trifft dort schon
    // das Inhaltsverzeichnis.
    for (const i of [0, 1]) {
      const bild = page.locator("article .einzelbild").nth(i);
      expect(await bild.evaluate((el) => getComputedStyle(el).float)).toBe(
        "none",
      );
      const spalte = await spaltenbreite(bild);
      const box = (await bild.boundingBox())!;
      expect(Math.abs(box.width - spalte), `Bild ${i} nicht voll breit`).toBeLessThan(2);
    }
  });

  test("ein Einzelbild öffnet sich groß — allein, ohne Blättern", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BERICHT);

    const bild = page.locator("article .einzelbild").first();
    await expect(bild.locator("img")).toHaveCount(1);
    await bild.locator("button:has(img)").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Ein Einzelbild ist keine Gruppe: Es gibt nichts zu blättern.
    await expect(dialog.getByRole("button", { name: /weiter|nächst/i })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
