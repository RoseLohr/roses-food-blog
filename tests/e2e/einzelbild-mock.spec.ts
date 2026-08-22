/**
 * SCHRITT 1 — Der Entwurf für Bilder OHNE Gruppe, an echtem Chromium gemessen.
 *
 * Geprüft wird nicht „sieht aus wie", sondern die drei Zusagen, an denen die
 * ALTE Fassung gescheitert ist:
 *
 *  1. Die Breite folgt der Stufe (s = 1/3, m = 1/2, l = 2/3 der Spalte) und
 *     überschreitet die Spalte NIE — auch nicht zusammen mit dem Abstand. Die
 *     alte Fassung addierte `margin-right: 1.5rem` ZUR Breite; 2/3 + 1/3 + zwei
 *     Abstände waren mehr als 100 %, und der zweite Float musste umbrechen.
 *  2. Der Text läuft wirklich daneben — nicht darunter.
 *  3. Zwei Bilder DERSELBEN Seite stehen untereinander, ein linkes und ein
 *     rechtes dürfen nebeneinander. Kein anderer Fall darf eine Zeile teilen.
 */
import path from "node:path";
import { expect, test } from "@playwright/test";

const MOCK = `file://${path.resolve(process.cwd(), "tests/e2e/mocks/einzelbild.html")}`;

const STUFEN = [
  { name: "s", anteil: 1 / 3 },
  { name: "m", anteil: 1 / 2 },
  { name: "l", anteil: 2 / 3 },
] as const;
const SPALTEN = [360, 600, 816, 1100];

/**
 * Der Kasten der ERSTEN ZEILE eines Absatzes.
 *
 * Nicht der Absatz selbst: Sein Blockkasten läuft über die volle Spalte, ein
 * Float verkürzt nur die ZEILENKÄSTEN darin. Wer den Absatz misst, misst den
 * Umfluss nicht — der zweite Anlauf dieses Prüfstands ist genau darüber
 * gestolpert (erwartet „> 291", gemessen „20" = linker Spaltenrand).
 */
async function ersteZeile(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const p = document.querySelector("p")!;
    const bereich = document.createRange();
    bereich.selectNodeContents(p);
    const r = bereich.getClientRects()[0];
    return { links: r.left + scrollX, rechts: r.right + scrollX, oben: r.top + scrollY };
  });
}

/** Die Inhaltsspalte selbst — gemessen, nicht aus den Kindern erschlossen. */
async function spaltenkasten(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const r = document.getElementById("spalte")!.getBoundingClientRect();
    return { links: r.left + scrollX, rechts: r.right + scrollX, breite: r.width };
  });
}

/** Kasten eines Elements im Dokument (nicht im Viewport). */
async function kaesten(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".einzelbild, p")).map((e) => {
      const r = e.getBoundingClientRect();
      return {
        art: e.classList.contains("einzelbild") ? "bild" : "text",
        seite: e.dataset.seite ?? "",
        groesse: e.dataset.groesse ?? "",
        links: r.left + scrollX,
        rechts: r.right + scrollX,
        oben: r.top + scrollY,
        unten: r.bottom + scrollY,
        breite: r.width,
      };
    }),
  );
}

test.describe("Einzelbild: Größe und Ausrichtung", () => {
  for (const spalte of SPALTEN) {
    for (const stufe of STUFEN) {
      for (const seite of ["links", "rechts"] as const) {
        test(`${stufe.name} ${seite} @ ${spalte}px`, async ({ page }) => {
          await page.goto(MOCK);
          await page.setViewportSize({ width: spalte + 40, height: 900 });
          await page.evaluate(
            ([sp, gr, se]) =>
              window.aufbauen(
                [
                  { art: "bild", groesse: gr, seite: se },
                  { art: "text", text: "Lorem ipsum ".repeat(60) },
                ],
                sp,
              ),
            [spalte, stufe.name, seite] as [number, string, string],
          );

          const [bild, text] = await kaesten(page);
          // Die Spalte wird GEMESSEN, nicht aus den Kindern erschlossen: Der
          // erste Anlauf leitete sie aus den Rändern von Bild und Text ab und
          // maß dadurch die Einrückung der <figure>-Vorgabe mit.
          const spalteK = await spaltenkasten(page);

          // 1. Die Breite folgt der Stufe.
          expect(bild.breite / spalteK.breite).toBeCloseTo(stufe.anteil, 2);
          // …und liegt vollständig INNERHALB der Spalte.
          expect(bild.links).toBeGreaterThanOrEqual(spalteK.links - 0.5);
          expect(bild.rechts).toBeLessThanOrEqual(spalteK.rechts + 0.5);

          // 2. Der Text läuft DANEBEN: Seine erste Zeile liegt auf Höhe des
          //    Bildes und beginnt (bzw. endet) an dessen Kante.
          expect(text.oben).toBeLessThan(bild.unten);
          const zeile = await ersteZeile(page);
          expect(zeile.oben).toBeLessThan(bild.unten);
          if (seite === "links") {
            expect(zeile.links).toBeGreaterThanOrEqual(bild.rechts - 0.5);
            expect(zeile.rechts).toBeLessThanOrEqual(spalteK.rechts + 0.5);
          } else {
            expect(zeile.rechts).toBeLessThanOrEqual(bild.links + 0.5);
            expect(zeile.links).toBeGreaterThanOrEqual(spalteK.links - 0.5);
          }
        });
      }
    }
  }

  test("zwei Bilder DERSELBEN Seite stehen untereinander", async ({ page }) => {
    await page.goto(MOCK);
    await page.evaluate(() =>
      window.aufbauen(
        [
          { art: "bild", groesse: "s", seite: "links" },
          { art: "bild", groesse: "s", seite: "links" },
          { art: "text", text: "Lorem ipsum ".repeat(80) },
        ],
        816,
      ),
    );
    const [a, b] = await kaesten(page);
    // Genau das ist die Zusage: KEINE gemeinsame Zeile. Ohne `clear` stünden
    // zwei Drittelbilder nebeneinander, und niemand hätte das angesagt.
    expect(b.oben).toBeGreaterThanOrEqual(a.unten - 0.5);
  });

  test("ein linkes und ein rechtes Bild dürfen nebeneinander", async ({ page }) => {
    await page.goto(MOCK);
    await page.evaluate(() =>
      window.aufbauen(
        [
          { art: "bild", groesse: "s", seite: "links" },
          { art: "bild", groesse: "s", seite: "rechts" },
          { art: "text", text: "Lorem ipsum ".repeat(80) },
        ],
        816,
      ),
    );
    const [a, b] = await kaesten(page);
    expect(a.oben).toBeCloseTo(b.oben, 0);
    // Und sie überlappen sich nicht.
    expect(a.rechts).toBeLessThanOrEqual(b.links + 0.5);
  });

  test("auch die größte Stufe auf beiden Seiten überläuft die Spalte nicht", async ({
    page,
  }) => {
    // Der Fall, an dem die alte Fassung starb: zwei Bilder, zusammen mehr als
    // die Spalte. Hier stehen sie untereinander statt umzubrechen — aber
    // geprüft wird, dass KEINES über den Rand hinausragt.
    await page.goto(MOCK);
    await page.evaluate(() =>
      window.aufbauen(
        [
          { art: "bild", groesse: "l", seite: "links" },
          { art: "bild", groesse: "l", seite: "rechts" },
          { art: "text", text: "Lorem ipsum ".repeat(80) },
        ],
        816,
      ),
    );
    const alle = await kaesten(page);
    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(ueberlauf, "waagerechter Überlauf").toBe(false);
    for (const k of alle) expect(k.breite).toBeLessThanOrEqual(816.5);
  });
});
