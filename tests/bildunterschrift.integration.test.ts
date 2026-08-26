/**
 * Der Alt-Text als sichtbare Bildunterschrift — je Foto einschaltbar, im
 * Reisebericht und NUR dort.
 *
 * ── WAS HIER GEPRÜFT WIRD ──────────────────────────────────────────────────
 *
 * 1. Standardmäßig steht keine Unterschrift da. Das ist die eigentliche
 *    Zusage: Der Alt-Text ist zuerst eine Beschreibung für Menschen, die das
 *    Bild nicht sehen können, und wird nicht ungefragt zum Fließtext.
 * 2. Eingeschaltet steht sie da — am Einzelbild UND an einem Foto in einer
 *    Gruppe.
 * 3. In EINER Gruppe entscheidet jedes Foto für sich. Das ist der Fall, an dem
 *    sich eine Abkürzung („eine Angabe für die ganze Karte") verraten würde.
 * 4. Restaurant- und Gericht-Fotos bekommen KEINE — sie waren ausdrücklich
 *    ausgenommen. Ohne diese Kontrolle wäre der Test grün für eine Änderung,
 *    die überall Unterschriften setzt.
 * 5. Ein Foto ohne Alt-Text bekommt keinen leeren Kasten untergeschoben.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("bildunterschrift");

const ALT_A = "Teller mit Pasta alla Norma von schräg oben";
const ALT_B = "Gasse mit Wäscheleinen im Gegenlicht";
let adminId: number;
let bildA: number;
let bildB: number;
let bildOhneText: number;

/** Ein Medienbild mit Variante; ohne Variante rendert nichts. */
async function seedBild(fileKey: string, altText: string): Promise<number> {
  const { db, schema } = await import("@/db");
  const [img] = await db
    .insert(schema.mediaImage)
    .values({
      fileKey,
      originalName: `${fileKey}.jpg`,
      altText,
      width: 1200,
      height: 800,
      sizeBytes: 1000,
      createdAt: new Date(),
    })
    .returning();
  await db.insert(schema.mediaVariant).values({ imageId: img.id, width: 320 });
  return img.id;
}

beforeAll(async () => {
  adminId = (await adminAnlegen()).id;
  bildA = await seedBild("unterschrift-a", ALT_A);
  bildB = await seedBild("unterschrift-b", ALT_B);
  bildOhneText = await seedBild("unterschrift-ohne", "");
});

/** Bericht aus einer Blockfolge bauen und rendern. */
async function markup(bloecke: unknown[], restaurants: unknown[] = []): Promise<string> {
  const { saveTravelFromForm } = await import("@/lib/travel-save");
  const { getFullTravelPost } = await import("@/lib/travel");
  const { TravelView } = await import("@/components/travel-view");

  const fd = new FormData();
  fd.set("titel", `Unterschrift ${Math.abs(JSON.stringify(bloecke).length)}-${bloecke.length}`);
  fd.set("status", "veroeffentlicht");
  fd.set("bloecke", JSON.stringify(bloecke));
  fd.set("restaurants", JSON.stringify(restaurants));
  const { travelId } = (await saveTravelFromForm(fd, adminId)) as { travelId: number };
  const full = await getFullTravelPost({ id: travelId });
  return renderToStaticMarkup(await TravelView({ full: full!, interactive: false }));
}

/** Steht der Text als <figcaption> da — und nicht bloß im alt-Attribut? */
function alsUnterschrift(html: string, text: string): boolean {
  return new RegExp(`<figcaption[^>]*>${text}</figcaption>`).test(html);
}

describe("Bildunterschrift im Reisebericht", () => {
  it("steht standardmäßig NICHT da", async () => {
    const html = await markup([{ type: "bild", imageId: bildA }]);
    // Als Alt-Text ist er sehr wohl vorhanden — nur eben nicht sichtbar.
    expect(html).toContain(`alt="${ALT_A}"`);
    expect(alsUnterschrift(html, ALT_A)).toBe(false);
  });

  it("steht am Einzelbild, sobald sie eingeschaltet ist", async () => {
    const html = await markup([
      { type: "bild", imageId: bildA, bildunterschrift: true },
    ]);
    expect(alsUnterschrift(html, ALT_A)).toBe(true);
  });

  it("steht auch an einem Foto INNERHALB einer Gruppe", async () => {
    const html = await markup([
      { type: "bild", imageId: bildA, gruppe: 1, bildunterschrift: true },
      { type: "bild", imageId: bildB, gruppe: 1, bildunterschrift: true },
    ]);
    expect(alsUnterschrift(html, ALT_A)).toBe(true);
    expect(alsUnterschrift(html, ALT_B)).toBe(true);
  });

  it("in einer Gruppe entscheidet JEDES Foto für sich", async () => {
    // Der Fall, an dem sich eine Abkürzung verriete: Wer die Angabe an der
    // Karte statt am Foto führte, bekäme hier zwei Unterschriften oder keine.
    const html = await markup([
      { type: "bild", imageId: bildA, gruppe: 1, bildunterschrift: true },
      { type: "bild", imageId: bildB, gruppe: 1, bildunterschrift: false },
    ]);
    expect(alsUnterschrift(html, ALT_A)).toBe(true);
    expect(alsUnterschrift(html, ALT_B)).toBe(false);
  });

  it("ein Foto ohne Alt-Text bekommt keinen leeren Kasten", async () => {
    const html = await markup([
      { type: "bild", imageId: bildOhneText, bildunterschrift: true },
    ]);
    expect(html).not.toContain("<figcaption");
  });

  it("Restaurant- und Gericht-Fotos bekommen keine Unterschrift", async () => {
    // Ausdrücklich ausgenommen. Ohne diese Kontrolle wäre alles darüber auch
    // für eine Änderung grün, die Unterschriften überall setzt.
    const html = await markup(
      [],
      [
        {
          name: "Trattoria",
          city: "Palermo",
          description: "",
          imageIds: [bildA],
          dishes: [
            { name: "Norma", description: "", imageIds: [bildB], ingredients: [] },
          ],
        },
      ],
    );
    expect(html).toContain(`alt="${ALT_A}"`);
    expect(alsUnterschrift(html, ALT_A)).toBe(false);
    expect(alsUnterschrift(html, ALT_B)).toBe(false);
  });
});
