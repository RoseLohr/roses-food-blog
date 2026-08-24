/**
 * Seed-Daten: Taxonomien, Zutaten (mit generierten Platzhalterbildern),
 * Beispielrezepte, eine Beispielreise (mit Inhalts-Blöcken), Startseiten-
 * Konfiguration, statische Seiten, Interessen und die Willkommenssequenz.
 *
 * Idempotent: bricht ab, wenn bereits Rezepte existieren.
 * Aufruf: npm run db:seed   (vorher npm run db:migrate)
 */
import sharp from "sharp";
import { db, schema } from "../src/db";
import type { TaxonomyType } from "../src/db/schema";
import { slugify } from "../src/lib/slug";
import { storeImage } from "../src/lib/media";

const NOW = new Date();

async function placeholder(label: string, color: string, w = 1280, h = 850) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="${color}"/>
    <circle cx="${w / 2}" cy="${h / 2 - 40}" r="120" fill="rgba(255,255,255,0.35)"/>
    <text x="50%" y="72%" text-anchor="middle" font-family="sans-serif"
      font-size="64" fill="#ffffff">${label}</text>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  const img = await storeImage(buf, `${slugify(label)}.png`, label);
  return img.id;
}

async function main() {
  const existing = await db.select().from(schema.recipe).limit(1);
  if (existing.length > 0) {
    console.log("[seed] Rezepte vorhanden — Seed übersprungen.");
    return;
  }

  console.log("[seed] Lege Taxonomien an ...");
  const tax = async (
    type: TaxonomyType,
    names: string[],
  ): Promise<Record<string, number>> => {
    const rows = await db
      .insert(schema.taxonomy)
      .values(names.map((name) => ({ type, name, slug: slugify(name) })))
      .returning();
    return Object.fromEntries(rows.map((r) => [r.name, r.id]));
  };

  const categories = await tax("kategorie", [
    "Hauptgericht",
    "Dessert",
    "Frühstück",
    "Salat",
    "Suppe",
    "Gebäck",
  ]);
  const tags = await tax("schlagwort", [
    "schnell",
    "meal prep",
    "sommerlich",
    "herzhaft",
    "süß",
  ]);
  const diets = await tax("ernaehrungsform", [
    "Vegetarisch",
    "Vegan",
    "Glutenfrei",
    "Laktosefrei",
  ]);
  const cuisines = await tax("kueche", [
    "Italienisch",
    "Asiatisch",
    "Deutsch",
    "Mediterran",
    "Orientalisch",
  ]);
  const equipments = await tax("geraet", [
    "Backofen",
    "Pfanne",
    "Topf",
    "Mixer",
    "Auflaufform",
  ]);

  console.log("[seed] Lege Zutaten mit Platzhalterbildern an ...");
  const ingredientDefs: Array<[string, string]> = [
    ["Tomate", "#c0392b"],
    ["Rote Linsen", "#d35400"],
    ["Zwiebel", "#8e6e53"],
    ["Knoblauch", "#a89f91"],
    ["Karotte", "#e67e22"],
    ["Haferflocken", "#b8a07e"],
    ["Banane", "#f1c40f"],
    ["Blaubeeren", "#34495e"],
    ["Kichererbsen", "#c8a951"],
    ["Spinat", "#27ae60"],
    ["Feta", "#ecf0f1"],
    ["Zitrone", "#f4d03f"],
    ["Olivenöl", "#7d8c3f"],
    ["Reis", "#d5cdb8"],
    ["Kokosmilch", "#e8e4d8"],
    ["Ingwer", "#c9a66b"],
  ];
  const ing: Record<string, number> = {};
  for (const [name, color] of ingredientDefs) {
    const imageId = await placeholder(name, color, 640, 640);
    const [row] = await db
      .insert(schema.ingredient)
      .values({ name, slug: slugify(name), imageId })
      .returning();
    ing[name] = row.id;
  }

  console.log("[seed] Lege Beispielrezepte an ...");

  interface SeedRecipe {
    title: string;
    teaser: string;
    color: string;
    prep: number;
    cook: number;
    servings: number;
    difficulty: "leicht" | "mittel" | "schwer";
    kcal: number;
    tips: string;
    categories: string[];
    tags: string[];
    diets: string[];
    cuisines: string[];
    equipment: string[];
    sections: Array<{
      name: string;
      ingredients: Array<[string, number | null, string, string?]>;
      steps: string[];
    }>;
    notes?: Array<{ text: string; isPublic: boolean }>;
  }

  const seedRecipes: SeedRecipe[] = [
    {
      title: "Linsen-Bolognese mit Vollkornnudeln",
      teaser:
        "Herzhafte vegane Bolognese aus roten Linsen — in 40 Minuten auf dem Tisch und voller Proteine.",
      color: "#a04000",
      prep: 15,
      cook: 25,
      servings: 4,
      difficulty: "leicht",
      kcal: 520,
      tips: "Die Sauce lässt sich hervorragend einfrieren. Für extra Tiefe einen Schuss Sojasauce zugeben.",
      categories: ["Hauptgericht"],
      tags: ["schnell", "meal prep", "herzhaft"],
      diets: ["Vegan", "Vegetarisch", "Laktosefrei"],
      cuisines: ["Italienisch"],
      equipment: ["Topf", "Pfanne"],
      sections: [
        {
          name: "Sauce",
          ingredients: [
            ["Rote Linsen", 250, "g"],
            ["Tomate", 800, "g", "gehackt, aus der Dose"],
            ["Zwiebel", 1, "Stück", "fein gewürfelt"],
            ["Knoblauch", 2, "Zehen"],
            ["Karotte", 2, "Stück", "fein gerieben"],
            ["Olivenöl", 2, "EL"],
          ],
          steps: [
            "Zwiebel und Knoblauch im Olivenöl glasig dünsten.",
            "Karotten zugeben und 3 Minuten mitbraten.",
            "Linsen und Tomaten zugeben, 20 Minuten sanft köcheln lassen.",
            "Mit Salz, Pfeffer und einer Prise Zucker abschmecken.",
          ],
        },
        {
          name: "Fertigstellen",
          ingredients: [],
          steps: [
            "Nudeln nach Packungsanweisung kochen.",
            "Sauce über die Nudeln geben und servieren.",
          ],
        },
      ],
      notes: [
        { text: "Schmeckt am nächsten Tag noch besser.", isPublic: true },
        {
          text: "Foto-Shooting für dieses Rezept im Herbst wiederholen.",
          isPublic: false,
        },
      ],
    },
    {
      title: "Overnight Oats mit Blaubeeren und Banane",
      teaser:
        "Cremiges Frühstück zum Vorbereiten: Haferflocken über Nacht einweichen, morgens toppen — fertig.",
      color: "#5b2c6f",
      prep: 10,
      cook: 0,
      servings: 2,
      difficulty: "leicht",
      kcal: 380,
      tips: "Statt Blaubeeren passen auch Himbeeren oder geraspelter Apfel mit Zimt.",
      categories: ["Frühstück"],
      tags: ["schnell", "süß", "meal prep"],
      diets: ["Vegetarisch"],
      cuisines: ["Deutsch"],
      equipment: ["Mixer"],
      sections: [
        {
          name: "",
          ingredients: [
            ["Haferflocken", 100, "g"],
            ["Banane", 1, "Stück", "zerdrückt"],
            ["Blaubeeren", 125, "g"],
            ["Kokosmilch", 200, "ml"],
          ],
          steps: [
            "Haferflocken, zerdrückte Banane und Kokosmilch verrühren.",
            "Über Nacht (mindestens 4 Stunden) kalt stellen.",
            "Vor dem Servieren mit Blaubeeren toppen.",
          ],
        },
      ],
    },
    {
      title: "Kichererbsen-Spinat-Curry",
      teaser:
        "Wärmendes Curry mit Kichererbsen, Spinat und Kokosmilch — mild, sättigend und in 35 Minuten fertig.",
      color: "#1e8449",
      prep: 10,
      cook: 25,
      servings: 4,
      difficulty: "mittel",
      kcal: 450,
      tips: "Wer es schärfer mag, gibt eine gehackte Chili zu Zwiebel und Ingwer.",
      categories: ["Hauptgericht"],
      tags: ["herzhaft", "meal prep"],
      diets: ["Vegan", "Vegetarisch", "Glutenfrei", "Laktosefrei"],
      cuisines: ["Asiatisch", "Orientalisch"],
      equipment: ["Topf"],
      sections: [
        {
          name: "Curry",
          ingredients: [
            ["Kichererbsen", 400, "g", "abgetropft"],
            ["Spinat", 200, "g", "frisch"],
            ["Kokosmilch", 400, "ml"],
            ["Zwiebel", 1, "Stück"],
            ["Ingwer", 20, "g", "fein gerieben"],
            ["Knoblauch", 2, "Zehen"],
            ["Reis", 250, "g", "als Beilage"],
          ],
          steps: [
            "Reis nach Packungsanweisung kochen.",
            "Zwiebel, Knoblauch und Ingwer anschwitzen, Currypulver kurz mitrösten.",
            "Kichererbsen und Kokosmilch zugeben, 15 Minuten köcheln.",
            "Spinat unterheben, zusammenfallen lassen, abschmecken und mit Reis servieren.",
          ],
        },
      ],
    },
    {
      title: "Griechischer Salat mit Feta und Zitronen-Dressing",
      teaser:
        "Knackiger Sommersalat mit Tomaten, Feta und einem frischen Zitronen-Olivenöl-Dressing.",
      color: "#2874a6",
      prep: 20,
      cook: 0,
      servings: 2,
      difficulty: "leicht",
      kcal: 320,
      tips: "Der Salat schmeckt am besten, wenn das Dressing 10 Minuten durchziehen kann.",
      categories: ["Salat"],
      tags: ["schnell", "sommerlich"],
      diets: ["Vegetarisch", "Glutenfrei"],
      cuisines: ["Mediterran"],
      equipment: [],
      sections: [
        {
          name: "Salat",
          ingredients: [
            ["Tomate", 400, "g", "in Spalten"],
            ["Feta", 150, "g", "gewürfelt"],
            ["Zwiebel", 0.5, "Stück", "in feinen Ringen"],
          ],
          steps: ["Tomaten, Zwiebel und Feta in einer Schüssel mischen."],
        },
        {
          name: "Dressing",
          ingredients: [
            ["Zitrone", 0.5, "Stück", "Saft davon"],
            ["Olivenöl", 3, "EL"],
          ],
          steps: [
            "Zitronensaft, Olivenöl, Salz und Pfeffer verrühren.",
            "Dressing über den Salat geben und vorsichtig mischen.",
          ],
        },
      ],
    },
  ];

  for (const r of seedRecipes) {
    const heroImageId = await placeholder(r.title.split(" ")[0], r.color);
    const [rec] = await db
      .insert(schema.recipe)
      .values({
        title: r.title,
        slug: slugify(r.title),
        teaser: r.teaser,
        heroImageId,
        prepMinutes: r.prep,
        cookMinutes: r.cook,
        servings: r.servings,
        difficulty: r.difficulty,
        kcal: r.kcal,
        tips: r.tips,
        seoTitle: r.title,
        seoDescription: r.teaser,
        status: "veroeffentlicht",
        publishedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning();

    for (const [i, s] of r.sections.entries()) {
      const [sec] = await db
        .insert(schema.recipeSection)
        .values({ recipeId: rec.id, name: s.name, sortOrder: i })
        .returning();
      if (s.steps.length)
        await db.insert(schema.recipeStep).values(
          s.steps.map((text, j) => ({ sectionId: sec.id, text, sortOrder: j })),
        );
      if (s.ingredients.length)
        await db.insert(schema.recipeIngredient).values(
          s.ingredients.map(([name, amount, unit, note], j) => ({
            sectionId: sec.id,
            ingredientId: ing[name],
            amount,
            unit,
            note: note ?? "",
            sortOrder: j,
          })),
        );
    }
    if (r.notes?.length)
      await db.insert(schema.recipeNote).values(
        r.notes.map((n) => ({ recipeId: rec.id, ...n, createdAt: NOW })),
      );

    // Alle Taxonomie-Zuordnungen in EINER Tabelle; erste Kategorie = primär.
    const taxonomyIds: Array<{ id: number; isPrimary: boolean }> = [
      ...r.categories.map((n, i) => ({ id: categories[n], isPrimary: i === 0 })),
      ...r.tags.map((n) => ({ id: tags[n], isPrimary: false })),
      ...r.diets.map((n) => ({ id: diets[n], isPrimary: false })),
      ...r.cuisines.map((n) => ({ id: cuisines[n], isPrimary: false })),
      ...r.equipment.map((n) => ({ id: equipments[n], isPrimary: false })),
    ];
    if (taxonomyIds.length)
      await db.insert(schema.recipeTaxonomy).values(
        taxonomyIds.map((t) => ({
          recipeId: rec.id,
          taxonomyId: t.id,
          isPrimary: t.isPrimary,
        })),
      );
  }

  console.log("[seed] Lege Beispielreise an ...");
  const travelHero = await placeholder("Sizilien", "#148f77");
  const travelText =
    "Sizilien isst man am besten auf der Straße und in kleinen Familienbetrieben.\n\n" +
    "In **Palermo** führt kein Weg an den Märkten Ballarò und Vucciria vorbei. " +
    "In **Catania** lohnt der Fischmarkt am Morgen — und abends die Trattorien rund um die Via Plebiscito.";
  const [travel] = await db
    .insert(schema.travelPost)
    .values({
      title: "Streetfood und Trattorien in Sizilien",
      slug: slugify("Streetfood und Trattorien in Sizilien"),
      teaser:
        "Eine Woche Palermo und Catania: Arancini am Markt, Pasta alla Norma am Hafen — unsere kulinarischen Entdeckungen.",
      searchText: travelText,
      country: "Italien",
      region: "Sizilien",
      city: "Palermo & Catania",
      travelMonth: 9,
      travelYear: 2025,
      heroImageId: travelHero,
      seoTitle: "Sizilien kulinarisch: Streetfood & Trattorien",
      seoDescription:
        "Arancini, Pasta alla Norma und Granita: die besten Essens-Entdeckungen aus Palermo und Catania.",
      status: "veroeffentlicht",
      publishedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning();

  // Inhalt als Blockfolge. Die Bilder sind BEWUSST gemischt hoch und quer:
  // nur so zeigt der Beispielbericht, was die Höhenstufen leisten, und nur so
  // messen die E2E-Tests (Bündigkeit, Bild-Auslieferung) an echten Formaten
  // statt an lauter gleich geschnittenen Kacheln.
  const bildGasse = await placeholder("Gasse", "#b5651d", 850, 1280); // hoch 2:3
  const bildMarkt = await placeholder("Ballarò", "#c0392b", 1280, 850); // quer 3:2
  const bildHafen = await placeholder("Hafen", "#1f6f8b", 1280, 720); // quer 16:9
  const bildSalz = await placeholder("Salzsee", "#7a8b6f", 1280, 850); // quer 3:2
  // Formate für die mehrspaltigen Zeilen — bewusst verschieden, damit sichtbar
  // wird, dass die Breite dem Format folgt und die Höhe trotzdem gleich bleibt.
  const bildZeile = [
    await placeholder("Piazza", "#b5651d", 900, 1200), // hoch 3:4
    await placeholder("Palme", "#3d7a4e", 1000, 1000), // quadratisch
    await placeholder("Dom", "#2f6f8f", 1280, 720), // quer 16:9
    await placeholder("Balkon", "#8f6f2f", 1280, 850), // quer 3:2
  ];
  await db.insert(schema.travelBlock).values([
    {
      travelPostId: travel.id,
      sortOrder: 0,
      type: "text",
      markdown: travelText,
    },
    // S links: ein Drittel der Spalte, der Text fließt rechts daneben.
    {
      travelPostId: travel.id,
      sortOrder: 1,
      type: "bild",
      imageId: bildGasse,
    },
    {
      travelPostId: travel.id,
      sortOrder: 2,
      type: "text",
      markdown:
        "Am Hafen von Catania wird der Fang des Morgens direkt an der Kante " +
        "verkauft — und zwei Straßen weiter schon gegessen. Wer früh genug da " +
        "ist, bekommt den besten Platz an der Theke und sieht zu, wie die " +
        "Schwertfische zerlegt werden.\n\n" +
        "In den Gassen dahinter riecht es nach Zitrone und heißem Öl. An jeder " +
        "zweiten Ecke steht ein Wagen mit Arancini, und keiner davon macht sie " +
        "genau wie der Nachbar: mal mit Ragù, mal mit Butter und Schinken, mal " +
        "mit Auberginen. Wir haben uns durch vier Stände gegessen und keinen " +
        "davon bereut.\n\n" +
        "Zum Abschluss eine Granita mit Brioche, im Stehen, weil drinnen kein " +
        "Platz mehr war — und das ist ohnehin die bessere Aussicht.\n\n" +
        "Wer den Markt am Vormittag verpasst, findet abends dieselben Gassen " +
        "wieder, nur leiser: Die Stände sind abgebaut, die Kisten gestapelt, " +
        "und zwischen den Rollläden stehen Tische, die tagsüber nirgends " +
        "waren. Man setzt sich dazu, ohne zu fragen, und bekommt, was gerade " +
        "fertig ist.",
    },
    // M allein: die halbe Spalte, der Text fließt links daneben.
    {
      travelPostId: travel.id,
      sortOrder: 3,
      type: "bild",
      imageId: bildMarkt,
    },
    {
      travelPostId: travel.id,
      sortOrder: 4,
      type: "text",
      markdown:
        "Der Fischmarkt beginnt vor sechs und ist gegen zehn vorbei. Wer " +
        "später kommt, findet leere Kisten und nasses Kopfsteinpflaster — und " +
        "die Cafés ringsum voll mit Leuten, die schon fertig sind.",
    },
    // Eine Gruppe aus ZWEI Bildern: das erste über die ganze Breite, das
    // zweite darunter. Die Anordnung folgt allein aus der Nachbarschaft.
    {
      travelPostId: travel.id,
      sortOrder: 5,
      type: "bild",
      imageId: bildHafen,
    },
    {
      travelPostId: travel.id,
      sortOrder: 6,
      type: "bild",
      imageId: bildZeile[3],
    },
    {
      travelPostId: travel.id,
      sortOrder: 7,
      type: "text",
      markdown:
        "Nachmittags wird es an der Küste windig. Dann lohnt der Weg ins " +
        "Landesinnere, wo die Salinen liegen und es plötzlich ganz still ist.",
    },
    // L → über die ganze Spalte, kein Text daneben, keine Seite.
    {
      travelPostId: travel.id,
      sortOrder: 8,
      type: "bild",
      imageId: bildSalz,
    },
    {
      travelPostId: travel.id,
      sortOrder: 9,
      type: "text",
      markdown:
        "Zwischen den Salinen und der Stadt liegt eine Straße, an der alle " +
        "zwanzig Kilometer ein Stand mit Zitronen steht.",
    },
    // Eine Gruppe aus DREI Bildern — der Fall, an dem die alte Anordnung
    // zerbrach: erstes über die ganze Breite, die beiden anderen darunter in
    // einer Reihe, nach Seitenverhältnis verteilt (gleich hoch, unten bündig).
    {
      travelPostId: travel.id,
      sortOrder: 10,
      type: "bild",
      imageId: bildZeile[0],
    },
    {
      travelPostId: travel.id,
      sortOrder: 11,
      type: "bild",
      imageId: bildZeile[1],
    },
    {
      travelPostId: travel.id,
      sortOrder: 12,
      type: "bild",
      imageId: bildZeile[2],
    },
    {
      travelPostId: travel.id,
      sortOrder: 13,
      type: "text",
      markdown:
        "Drei Bilder als eine Gruppe: das erste über die ganze Breite, die " +
        "beiden anderen darunter in einer Reihe. Ihre Breite verteilt sich " +
        "nach Format, deshalb sind sie exakt gleich hoch.",
    },
  ]);

  // Galerie: dieselbe Reihe mit Umbruch, Stufe S — gemischte Formate zeigen,
  // dass keine Lücke bleibt (das alte 2er-Raster ließ neben einem Hochbild eine).
  const galerie = [
    await placeholder("Arancini", "#e67e22", 1000, 1000), // quadratisch
    await placeholder("Granita", "#8e44ad", 1280, 850), // quer 3:2
    await placeholder("Dom", "#2c7873", 900, 1200), // hoch 3:4
  ];
  await db.insert(schema.travelPostImage).values(
    galerie.map((imageId, i) => ({
      travelPostId: travel.id,
      imageId,
      sortOrder: i,
    })),
  );

  const restaurants = [
    {
      name: "Trattoria da Nino",
      city: "Palermo",
      lat: 38.1157,
      lng: 13.3615,
      // EIN Foto → Band über die ganze Kartenbreite (klickbar → Pop-up).
      imageColor: "#1e5631",
      imageColor2: null,
      description:
        "Familiengeführte Trattoria nahe dem Ballarò-Markt, drei Tische, keine Speisekarte.",
      dishes: [
        {
          name: "Pasta alla Norma",
          description:
            "Hausgemachte Pasta mit gebratenen Auberginen, Tomatensugo und gesalzenem Ricotta.",
          color: "#922b21",
          // Mehrere Fotos → Galerie mit Vor/Zurück im Pop-up.
          extraColors: ["#7b241c", "#a04000"],
          ingredients: ["Tomate", "Knoblauch", "Olivenöl"],
          // Kategorie + Küche + Zutat: erst diese drei Überschneidungen
          // qualifizieren ein Rezept für „Ähnliche Rezepte selbst machen"
          // (siehe lib/similar-recipes.ts). Ohne sie bliebe der Abschnitt im
          // Beispielbericht leer — und damit ungetestet.
          categories: ["Hauptgericht"],
          cuisines: ["Italienisch"],
        },
        {
          name: "Caponata",
          description: "Süß-saures Gemüse mit Auberginen, Sellerie und Kapern.",
          color: "#6e2c00",
          extraColors: [],
          ingredients: ["Tomate", "Zwiebel", "Olivenöl"],
          categories: ["Salat"],
          cuisines: ["Mediterran"],
        },
      ],
    },
    {
      name: "Osteria del Porto",
      city: "Catania",
      lat: 37.5079,
      lng: 15.083,
      // ZWEI Fotos → kleiner nebeneinander, beide klickbar, das Pop-up
      // blättert zwischen ihnen.
      imageColor: "#7d5a3c",
      imageColor2: "#3c6e7d",
      description:
        "Direkt am Fischmarkt — was morgens ankommt, liegt mittags auf dem Teller.",
      dishes: [
        {
          name: "Risotto al Limone",
          description: "Cremiges Zitronenrisotto mit frischem Fang des Tages.",
          color: "#b7950b",
          extraColors: [],
          ingredients: ["Reis", "Zitrone", "Olivenöl"],
          categories: [],
          cuisines: [],
        },
      ],
    },
  ];

  for (const [i, r] of restaurants.entries()) {
    const restImageId = r.imageColor
      ? await placeholder(r.name.split(" ")[0], r.imageColor, 960, 640)
      : null;
    const restImageId2 = r.imageColor2
      ? await placeholder(`${r.name.split(" ")[0]} 2`, r.imageColor2, 900, 1200)
      : null;
    const [rest] = await db
      .insert(schema.restaurant)
      .values({
        travelPostId: travel.id,
        name: r.name,
        city: r.city,
        description: r.description,
        imageId: restImageId,
        imageId2: restImageId2,
        // Koordinaten-Override — die Platzhalterbilder tragen kein EXIF-GPS
        lat: r.lat,
        lng: r.lng,
        sortOrder: i,
      })
      .returning();
    for (const [j, d] of r.dishes.entries()) {
      const [dishRow] = await db
        .insert(schema.dish)
        .values({
          restaurantId: rest.id,
          name: d.name,
          description: d.description,
          sortOrder: j,
        })
        .returning();
      // Erstes Foto + optionale weitere Fotos (Galerie-Demo mit Vor/Zurück).
      const dishColors = [d.color, ...d.extraColors];
      for (const [k, color] of dishColors.entries()) {
        const dishImg = await placeholder(
          `${d.name.split(" ")[0]} ${k + 1}`,
          color,
          960,
          720,
        );
        await db
          .insert(schema.dishImage)
          .values({ dishId: dishRow.id, imageId: dishImg, sortOrder: k });
      }
      await db.insert(schema.dishIngredient).values(
        d.ingredients.map((n) => ({ dishId: dishRow.id, ingredientId: ing[n] })),
      );
      // Unbekannter Name → sofort lauter Fehler statt NULL in der Zuordnung.
      const taxId = (topf: Record<string, number>, name: string): number => {
        const id = topf[name];
        if (id === undefined) throw new Error(`[seed] Unbekannte Taxonomie: ${name}`);
        return id;
      };
      const dishTaxIds = [
        ...d.categories.map((n) => taxId(categories, n)),
        ...d.cuisines.map((n) => taxId(cuisines, n)),
      ];
      if (dishTaxIds.length) {
        await db
          .insert(schema.dishTaxonomy)
          .values(dishTaxIds.map((taxonomyId) => ({ dishId: dishRow.id, taxonomyId })));
      }
    }
  }

  console.log("[seed] Startseite, Seiten, Interessen, Sequenz ...");
  await db.insert(schema.homepageConfig).values({
    id: 1,
    sliderIntervalSeconds: 6,
    popularCount: 6,
    aboutTeaserImageId: await placeholder("Rose", "#b0413e", 640, 640),
    aboutTeaserText:
      "Hallo, ich bin Rose! Hier teile ich gesunde Rezepte für jeden Tag und meine kulinarischen Reisen.",
    aboutTeaserLink: "/ueber-mich",
  });
  await db.insert(schema.homepageFilterGroup).values([
    { groupKey: "zeit" },
    { groupKey: "ernaehrung" },
    { groupKey: "kalorien" },
  ]);
  // Slider: Hero-Bilder der ersten drei Rezepte
  const heroRows = await db.select().from(schema.recipe);
  for (const [i, rec] of heroRows.slice(0, 3).entries()) {
    if (rec.heroImageId)
      await db.insert(schema.sliderItem).values({
        imageId: rec.heroImageId,
        recipeId: rec.id,
        caption: rec.title,
        sortOrder: i,
      });
  }

  // Kernseiten — EIN Schreiber pro Zeile (Sol-Befunde PR #55 R1+R2): die Seite
  // „ueber-mich" gehört migrate.mjs (legt sie auf jedem System als leeren,
  // geschützten Entwurf an) und wird hier bewusst NICHT angefasst — weder
  // Upsert noch „Stub-Upgrade"-Heuristik, denn jede Heuristik kann einen
  // legitimen, vom Admin geleerten Entwurf nicht von einem frischen Stub
  // unterscheiden. Der Seed ergänzt nur die übrigen Kernseiten und lässt
  // bestehende Zeilen grundsätzlich unverändert (onConflictDoNothing).
  const pages = [
    {
      title: "Datenschutzerklärung",
      slug: "datenschutz",
      content:
        "> **PLATZHALTER — RECHTSTEXT ERFORDERLICH**\n>\n> Diese Seite überschreibt die generierte Datenschutzerklärung unter /datenschutz, sobald sie veröffentlicht ist. Solange sie Entwurf bleibt, zeigt der Blog die mitgelieferte DSGVO-orientierte Standarderklärung.",
    },
    {
      title: "Impressum",
      slug: "impressum",
      content:
        "> **PLATZHALTER — RECHTSTEXT ERFORDERLICH**\n>\n> Angaben gemäß § 5 DDG bitte ergänzen: Name, Anschrift, Kontakt, Verantwortliche/r i. S. d. § 18 Abs. 2 MStV.",
    },
  ];
  for (const p of pages) {
    await db
      .insert(schema.page)
      .values({
        ...p,
        seoTitle: p.title,
        seoDescription: "",
        // Datenschutz bewusst als Entwurf: die generierte Erklärung greift,
        // bis ein eigener geprüfter Text veröffentlicht wird.
        status: (p.slug === "datenschutz" ? "entwurf" : "veroeffentlicht") as
          | "entwurf"
          | "veroeffentlicht",
        isProtected: true,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .onConflictDoNothing({ target: schema.page.slug });
  }

  // Genau die beiden inhaltlichen Säulen des Blogs — beide öffentlich
  // (im Newsletter-Willkommensschritt anwählbar).
  await db.insert(schema.interest).values([
    { name: "Rezepte", isPublic: true },
    { name: "Reisen", isPublic: true },
  ]);

  const [seq] = await db
    .insert(schema.sequence)
    .values({ name: "Willkommensserie", active: false, createdAt: NOW })
    .returning();
  await db.insert(schema.sequenceStep).values([
    {
      sequenceId: seq.id,
      sortOrder: 0,
      delayHours: 1,
      subject: "Willkommen bei Roses Food Blog!",
      content:
        "Hallo {{vorname}},\n\nschön, dass du dabei bist! Ab sofort bekommst du neue Rezepte und Reiseberichte direkt in dein Postfach.\n\nHerzliche Grüße\nRose",
    },
    {
      sequenceId: seq.id,
      sortOrder: 1,
      delayHours: 72,
      subject: "Meine 3 beliebtesten Rezepte für dich",
      content:
        "Hallo {{vorname}},\n\nzum Einstieg habe ich dir meine drei beliebtesten Rezepte zusammengestellt — schau mal auf dem Blog vorbei!\n\nHerzliche Grüße\nRose",
    },
  ]);

  console.log("[seed] Fertig.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
