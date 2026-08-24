/**
 * Regressionstest: Im öffentlichen Reisebericht werden ALLE ausgewählten
 * Gericht-Fotos gerendert — nicht nur das erste. (Vorher zeigte die Ansicht
 * hart `dish.images[0]`, sodass zusätzlich hochgeladene/ausgewählte Fotos im
 * Frontend verschwanden, obwohl sie im Admin sichtbar waren.)
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { frischeDb } from "./helfer/frische-db";
import { adminAnlegen } from "./helfer/saat";

frischeDb("dishimg");

let adminId: number;

beforeAll(async () => {
  adminId = (await adminAnlegen()).id;
});

/** Legt ein Medienbild mit einer 320er-Variante an und gibt die ID zurück. */
async function seedImage(fileKey: string): Promise<number> {
  const { db, schema } = await import("@/db");
  const [img] = await db
    .insert(schema.mediaImage)
    .values({
      fileKey,
      originalName: `${fileKey}.jpg`,
      altText: `Foto ${fileKey}`,
      width: 800,
      height: 600,
      sizeBytes: 1000,
      createdAt: new Date(),
    })
    .returning();
  await db.insert(schema.mediaVariant).values({ imageId: img.id, width: 320 });
  return img.id;
}

/**
 * Baut das Formular für einen veröffentlichten Bericht mit EINEM Restaurant
 * und EINEM Gericht. Gleich in allen vier Fällen: Status, leere
 * Beschreibungen, leere Zutatenliste. Alles, was sich zwischen den Fällen
 * unterscheidet, steht am Aufruf.
 */
function berichtFormular(felder: {
  titel: string;
  restaurant: string;
  stadt: string;
  gericht: string;
  imageIds: number[];
}): FormData {
  const fd = new FormData();
  fd.set("titel", felder.titel);
  fd.set("status", "veroeffentlicht");
  fd.set(
    "restaurants",
    JSON.stringify([
      {
        name: felder.restaurant,
        city: felder.stadt,
        description: "",
        dishes: [
          {
            name: felder.gericht,
            description: "",
            imageIds: felder.imageIds,
            ingredients: [],
          },
        ],
      },
    ]),
  );
  return fd;
}

describe("Reisebericht-Frontend: Gericht-Fotos", () => {
  it("rendert ALLE ausgewählten Gericht-Fotos, nicht nur das erste", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { TravelView } = await import("@/components/travel-view");

    const imgA = await seedImage("dishfoto-a");
    const imgB = await seedImage("dishfoto-b");
    const imgC = await seedImage("dishfoto-c");

    const fd = berichtFormular({
      titel: "Drei Fotos pro Gericht",
      restaurant: "Trattoria Tre",
      stadt: "Palermo",
      gericht: "Arancini",
      imageIds: [imgA, imgB, imgC],
    });
    const result = await saveTravelFromForm(fd, adminId);
    const id = (result as { travelId: number }).travelId;

    // Persistenz: alle drei Bilder hängen (geordnet) am Gericht.
    const full = await getFullTravelPost({ id });
    const dish = full!.restaurants[0].dishes[0];
    expect(dish.images.map((i) => i.fileKey)).toEqual([
      "dishfoto-a",
      "dishfoto-b",
      "dishfoto-c",
    ]);

    // Rendering: ALLE drei Fotos erscheinen im öffentlichen Markup.
    const markup = renderToStaticMarkup(
      await TravelView({ full: full!, interactive: false }),
    );
    expect(markup).toContain("dishfoto-a");
    expect(markup).toContain("dishfoto-b");
    expect(markup).toContain("dishfoto-c");
    // Genau drei <img> für dieses Gericht (je ein `src`-Attribut pro Bild;
    // `srcset` zählt nicht mit).
    expect(markup.match(/src="\/uploads\/dishfoto-/g)?.length).toBe(3);
    // Galerie-Lightbox: jedes Foto ist ein klickbarer Zoom-Button (öffnet das
    // Pop-up). Das Overlay selbst rendert erst nach Klick (Client-State).
    expect(markup.match(/cursor-zoom-in/g)?.length).toBe(3);
    expect(markup).toContain("vergrößern");
  });

  it("Regel C: GENAU ZWEI Fotos stehen gleichrangig, ohne Bühne", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { TravelView } = await import("@/components/travel-view");

    // Zwei Fotos: Bei dieser Zahl gibt es die Rangfolge nicht, die eine Bühne
    // behaupten würde — beide bekommen dasselbe Format. Ab DREI Fotos trägt
    // die Bühne wieder (zweiter Teil dieses Tests).
    const zwei = [await seedImage("regelc-a"), await seedImage("regelc-b")];
    const fd = berichtFormular({
      titel: "Zwei Fotos, keine Bühne",
      restaurant: "Bar Dos",
      stadt: "Sevilla",
      gericht: "Salmorejo",
      imageIds: zwei,
    });
    const id = ((await saveTravelFromForm(fd, adminId)) as { travelId: number })
      .travelId;
    const full = await getFullTravelPost({ id });
    const markup = renderToStaticMarkup(
      await TravelView({ full: full!, interactive: false }),
    );

    // Beide Fotos tragen dasselbe Seitenverhältnis (4/3) — keines ist Bühne.
    const seiten = markup.match(/aspect-\[4\/3\] w-full object-cover/g) ?? [];
    expect(seiten.length).toBe(2);
    // Und es gibt KEINE Bühne (16/9) in diesem Bericht.
    expect(markup).not.toContain("aspect-[16/9]");
  });

  it("Regel C: ab DREI Fotos trägt die Bühne wieder", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { TravelView } = await import("@/components/travel-view");

    const drei = [
      await seedImage("regelc-c"),
      await seedImage("regelc-d"),
      await seedImage("regelc-e"),
    ];
    const fd = berichtFormular({
      titel: "Drei Fotos, mit Bühne",
      restaurant: "Bar Tres",
      stadt: "Sevilla",
      gericht: "Espinacas",
      imageIds: drei,
    });
    const id = ((await saveTravelFromForm(fd, adminId)) as { travelId: number })
      .travelId;
    const full = await getFullTravelPost({ id });
    const markup = renderToStaticMarkup(
      await TravelView({ full: full!, interactive: false }),
    );

    // Genau EINE Bühne (16/9) …
    expect((markup.match(/aspect-\[16\/9\]/g) ?? []).length).toBe(1);
    // … und zwei quadratische Streifen-Fotos.
    expect(
      (markup.match(/aspect-square w-full object-cover/g) ?? []).length,
    ).toBe(2);
  });

  it("zeigt ein einzelnes Gericht-Foto unverändert (Regression der Single-Ansicht)", async () => {
    const { saveTravelFromForm } = await import("@/lib/travel-save");
    const { getFullTravelPost } = await import("@/lib/travel");
    const { TravelView } = await import("@/components/travel-view");

    const only = await seedImage("dishfoto-solo");
    const fd = berichtFormular({
      titel: "Ein Foto pro Gericht",
      restaurant: "Osteria Uno",
      stadt: "Catania",
      gericht: "Pasta alla Norma",
      imageIds: [only],
    });
    const id = ((await saveTravelFromForm(fd, adminId)) as { travelId: number })
      .travelId;
    const full = await getFullTravelPost({ id });
    const markup = renderToStaticMarkup(
      await TravelView({ full: full!, interactive: false }),
    );
    expect(markup.match(/src="\/uploads\/dishfoto-solo/g)?.length).toBe(1);
  });
});
