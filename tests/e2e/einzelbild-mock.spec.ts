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
 *  3. KEIN Einzelbild teilt sich seine Zeile mit einem anderen — und was für
 *     den Text übrig bleibt, ist immer noch Text. Hier stand zuerst „ein
 *     linkes und ein rechtes dürfen nebeneinander"; die Messung unten hat
 *     diese Zusage widerlegt (s+m lässt 48,7 px von 816 übrig, also fünf
 *     Zeichen je Zeile). Die Zusage ist deshalb ersetzt, nicht aufgeweicht.
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
          // Unter 640 px Fenster greift die Handy-Regel: volle Breite, kein
          // Umfluss. Das stand vorher NICHT in diesem Prüfstand, weil er eine
          // Abschrift der Regeln prüfte, in der die Medienabfrage fehlte —
          // aufgefallen, als er auf die ausgelieferte Datei umgestellt wurde.
          if (spalte + 40 < 640) {
            const spalteM = await spaltenkasten(page);
            expect(await page.evaluate(() =>
              getComputedStyle(document.querySelector(".einzelbild")!).float,
            )).toBe("none");
            expect(bild.breite).toBeCloseTo(spalteM.breite, 0);
            // Und der Text steht DARUNTER, nicht daneben.
            expect(text.oben).toBeGreaterThanOrEqual(bild.unten - 0.5);
            return;
          }
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

  test("auch ein linkes und ein rechtes Bild teilen sich keine Zeile", async ({
    page,
  }) => {
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
    // Genau dieser Fall stand hier vorher mit umgekehrter Erwartung. Er sah
    // gut aus — bis daneben ein halbbreites Bild stand.
    expect(b.oben).toBeGreaterThanOrEqual(a.unten - 0.5);
  });

  /**
   * Die eigentliche Zusage, und die einzige, die zählt: Egal wie zwei
   * Einzelbilder eingestellt sind, für den Text bleibt eine LESBARE Spalte.
   *
   * Gemessen wird die schmalste Zeilenbox des Absatzes ohne seine letzte —
   * die ist naturgemäß kurz und sagt über den Umfluss nichts. Vor dieser
   * Änderung fiel s+m hier mit 48,7 px durch.
   */
  const PAARE = [
    ["s", "s"],
    ["s", "m"],
    ["m", "s"],
    ["s", "l"],
    ["m", "m"],
    ["l", "s"],
    ["m", "l"],
    ["l", "l"],
  ] as const;
  for (const [links, rechts] of PAARE) {
    test(`${links} links + ${rechts} rechts lässt eine lesbare Textspalte`, async ({
      page,
    }) => {
      await page.goto(MOCK);
      await page.evaluate(
        ([a, b]) =>
          window.aufbauen(
            [
              { art: "bild", groesse: a, seite: "links" },
              { art: "bild", groesse: b, seite: "rechts" },
              { art: "text", text: "Lorem ipsum ".repeat(200) },
            ],
            816,
          ),
        [links, rechts] as [string, string],
      );
      const enge = await page.evaluate(() => {
        const p = document.querySelector("p")!;
        const bereich = document.createRange();
        bereich.selectNodeContents(p);
        // Ein Viertel der Spalte: die Grenze, unter die das breiteste
        // Einzelbild (l = 2/3) den Text nicht drückt — 816 − 544 − 20 = 252.
        return [...bereich.getClientRects()]
          .slice(0, -1)
          .filter((z) => z.width < 816 * 0.25).length;
      });
      // GEZÄHLT, nicht am Minimum gemessen: Am Übergang von einem Float zum
      // nächsten liegt IMMER eine kurze Zeile — der Zeilenkasten überlappt
      // beide. Das ist normaler Satz, kein Befund, und ein Mindestwert würde
      // genau daran hängenbleiben (dieser Prüfstand tat das im ersten Anlauf).
      //
      // Der Unterschied, um den es geht, steht in den gemessenen Zahlen für
      // s links + m rechts:
      //   vorher (beide teilen die Zeile):  50 49 50 49 50 49 50 49 377 …
      //   jetzt  (clear: both):            486 484 486 484 486 484 486 49 …
      // Acht Zeilen à fünf Zeichen sind der Befund; eine ist der Übergang.
      // Bei zwei Bildern gibt es höchstens zwei solche Übergänge.
      expect(enge).toBeLessThanOrEqual(2);
    });
  }

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
