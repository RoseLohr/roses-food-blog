/**
 * Der Ausschnitt ist an JEDEM Bild einstellbar, das der Admin auswählt —
 * auch in Reisen und Rezepten.
 *
 * ── DER MISSSTAND ──────────────────────────────────────────────────────────
 *
 * Der `ImagePicker` bringt den Ausschnitt-Editor längst mit: unter jedem
 * gewählten Bild steht ein Knopf „Ausschnitt". Er erscheint aber nur, wenn die
 * Auswahlmöglichkeit eine `fullUrl` trägt — das Modal braucht die große
 * Variante als Klickfläche.
 *
 * `listImageChoices()` liefert sie. Drei Stellen bauten ihre Auswahlliste
 * jedoch selbst und ließen `fullUrl`, `focusX` und `focusY` weg: der
 * Reise-Editor, der Rezept-Editor und die Zutaten-Seite. Folge: dort kein
 * Knopf, und die kleine Vorschau zeigte stur die Bildmitte statt des
 * eingestellten Ausschnitts.
 *
 * Die Wurzel ist die Abschrift, nicht der fehlende Knopf. Deshalb prüft dieser
 * Test nicht „ist ein Knopf da", sondern die BEIDEN Hälften, aus denen er
 * entsteht:
 *   1. Die Auswahllisten der Editoren führen Vollbild UND Fokus mit.
 *   2. Der `ImagePicker` macht daraus den Knopf — und lässt ihn weg, wenn die
 *      Vollvariante fehlt. Ohne diese zweite Hälfte wäre der Test grün für
 *      Daten, die niemand anzeigt.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ImageChoice } from "@/components/admin/image-picker";
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";

frischeDb("ausschnitt");

/** Ein Bild mit einem Ausschnitt, der NICHT die Mitte ist. */
const FOKUS_X = 20;
const FOKUS_Y = 80;
let bildId: number;

beforeAll(async () => {
  const { db, schema } = await import("@/db");
  const [img] = await db
    .insert(schema.mediaImage)
    .values({
      fileKey: "ausschnitt-eins",
      originalName: "ausschnitt-eins.jpg",
      altText: "Foto mit eigenem Ausschnitt",
      width: 1600,
      height: 900,
      sizeBytes: 1000,
      focusX: FOKUS_X,
      focusY: FOKUS_Y,
      createdAt: new Date(),
    })
    .returning();
  await db
    .insert(schema.mediaVariant)
    .values([
      { imageId: img.id, width: 320 },
      { imageId: img.id, width: 1280 },
    ]);
  bildId = img.id;
});

describe("Auswahllisten der Editoren", () => {
  it("Reise-Editor: Bild bringt Vollvariante und Fokus mit", async () => {
    const { buildTravelEditorProps } = await import(
      "@/app/admin/(protected)/reisen/editor-data"
    );
    const props = await buildTravelEditorProps(null);
    const wahl = props?.images.find((i) => i.id === bildId);
    expect(wahl?.fullUrl).toBeTruthy();
    expect(wahl?.focusX).toBe(FOKUS_X);
    expect(wahl?.focusY).toBe(FOKUS_Y);
  });

  it("Reise-Editor: die Originalmaße bleiben erhalten", async () => {
    // Der Reise-Editor rechnet daraus die Pixelzeile am Bildblock aus. Sie
    // fiele lautlos weg, wenn die gemeinsame Liste sie nicht mitführte.
    const { buildTravelEditorProps } = await import(
      "@/app/admin/(protected)/reisen/editor-data"
    );
    const props = await buildTravelEditorProps(null);
    const wahl = props?.images.find((i) => i.id === bildId);
    expect(wahl?.width).toBe(1600);
    expect(wahl?.height).toBe(900);
  });

  it("Rezept-Editor: Bild bringt Vollvariante und Fokus mit", async () => {
    const { buildEditorProps } = await import(
      "@/app/admin/(protected)/rezepte/editor-data"
    );
    const props = await buildEditorProps(null);
    const wahl = props?.images.find((i) => i.id === bildId);
    expect(wahl?.fullUrl).toBeTruthy();
    expect(wahl?.focusX).toBe(FOKUS_X);
    expect(wahl?.focusY).toBe(FOKUS_Y);
  });

});

describe("ImagePicker macht daraus den Knopf", () => {
  /** Rendert den Picker mit genau einem gewählten Bild. */
  async function markup(wahl: ImageChoice): Promise<string> {
    const { ImagePicker } = await import("@/components/admin/image-picker");
    const { createElement } = await import("react");
    return renderToStaticMarkup(
      createElement(ImagePicker, {
        legend: "Titelbild",
        options: [wahl],
        multiple: false,
        value: [wahl.id],
        onChange: () => {},
      }),
    );
  }

  const basis: ImageChoice = { id: 1, label: "Foto", thumbUrl: "/m/foto-320.webp" };

  it("mit Vollvariante steht der Ausschnitt-Knopf da", async () => {
    const { t } = await import("@/i18n/de");
    const html = await markup({ ...basis, fullUrl: "/m/foto-1280.webp", focusX: FOKUS_X, focusY: FOKUS_Y });
    expect(html).toContain(t().admin.media.focusButton);
  });

  it("ohne Vollvariante fehlt er — die Kontrolle zum Fall darüber", async () => {
    const { t } = await import("@/i18n/de");
    const html = await markup(basis);
    expect(html).not.toContain(t().admin.media.focusButton);
  });

  it("die Vorschau zeigt den eingestellten Ausschnitt, nicht die Mitte", async () => {
    const html = await markup({ ...basis, fullUrl: "/m/foto-1280.webp", focusX: FOKUS_X, focusY: FOKUS_Y });
    expect(html).toContain(`${FOKUS_X}% ${FOKUS_Y}%`);
  });
});
