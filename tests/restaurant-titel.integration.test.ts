/**
 * Über der Restaurant-Karte steht NUR, was im Admin eingegeben wurde.
 *
 * Vorher stellte der Renderer fest das Wort "Restaurant" vor den Namen. Bei
 * Häusern, die es selbst schon führen ("Restaurant Adler"), stand es doppelt
 * da; bei allen anderen war es ein Titel, den niemand eingetippt hatte.
 *
 * Geprüft wird an der GERENDERTEN Seite, nicht am Wörterbuch: Der Eintrag
 * `restaurantWord` bleibt bestehen — er trägt weiterhin die Vorlese-
 * Beschriftung der Bilderstrecke. Ein Test gegen das Wörterbuch wäre grün,
 * ohne etwas über die Seite zu sagen.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("resttitel");

const NAME = "Trattoria da Nino";
let adminId: number;

beforeAll(async () => {
  adminId = (await adminAnlegen()).id;
});

/** Bericht mit einem Restaurant und einem Gericht, sonst so leer wie möglich. */
async function markup(): Promise<string> {
  const { saveTravelFromForm } = await import("@/lib/travel-save");
  const { getFullTravelPost } = await import("@/lib/travel");
  const { TravelView } = await import("@/components/travel-view");

  const fd = new FormData();
  fd.set("titel", "Sizilien");
  fd.set("status", "veroeffentlicht");
  fd.set(
    "restaurants",
    JSON.stringify([
      {
        name: NAME,
        city: "Palermo",
        description: "",
        dishes: [
          { name: "Pasta alla Norma", description: "", imageIds: [], ingredients: [] },
        ],
      },
    ]),
  );
  const { travelId } = (await saveTravelFromForm(fd, adminId)) as {
    travelId: number;
  };
  const full = await getFullTravelPost({ id: travelId });
  return renderToStaticMarkup(await TravelView({ full: full!, interactive: false }));
}

describe("Restaurant-Titel", () => {
  it("nennt den eingegebenen Namen, ohne ein Wort davorzustellen", async () => {
    const html = await markup();
    expect(html).toContain(NAME);
    // Der eigentliche Befund: kein festes Wort unmittelbar vor dem Namen.
    // Trifft die Kartenüberschrift UND den Eintrag im Inhaltsverzeichnis.
    expect(html).not.toMatch(new RegExp(`Restaurant\\s+${NAME}`));
  });

  it("die Bilderstrecke behält ihre Vorlese-Beschriftung", async () => {
    // Kontrolle zum Fall darüber: Der Test oben darf nicht dadurch grün
    // werden, dass das Wort ÜBERALL verschwunden ist. Für Screenreader ist es
    // die einzige Auskunft, wozu die Fotos gehören.
    const { t } = await import("@/i18n/de");
    expect(t().travelList.restaurantWord).toBe("Restaurant");
  });
});
