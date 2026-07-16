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

  // Inhalt als Blockfolge: ein Textblock (weitere Blöcke im Admin pflegbar).
  await db.insert(schema.travelBlock).values({
    travelPostId: travel.id,
    sortOrder: 0,
    type: "text",
    markdown: travelText,
  });

  const restaurants = [
    {
      name: "Trattoria da Nino",
      city: "Palermo",
      description:
        "Familiengeführte Trattoria nahe dem Ballarò-Markt, drei Tische, keine Speisekarte.",
      dishes: [
        {
          name: "Pasta alla Norma",
          description:
            "Hausgemachte Pasta mit gebratenen Auberginen, Tomatensugo und gesalzenem Ricotta.",
          color: "#922b21",
          ingredients: ["Tomate", "Knoblauch", "Olivenöl"],
        },
        {
          name: "Caponata",
          description: "Süß-saures Gemüse mit Auberginen, Sellerie und Kapern.",
          color: "#6e2c00",
          ingredients: ["Tomate", "Zwiebel", "Olivenöl"],
        },
      ],
    },
    {
      name: "Osteria del Porto",
      city: "Catania",
      description:
        "Direkt am Fischmarkt — was morgens ankommt, liegt mittags auf dem Teller.",
      dishes: [
        {
          name: "Risotto al Limone",
          description: "Cremiges Zitronenrisotto mit frischem Fang des Tages.",
          color: "#b7950b",
          ingredients: ["Reis", "Zitrone", "Olivenöl"],
        },
      ],
    },
  ];

  for (const [i, r] of restaurants.entries()) {
    const [rest] = await db
      .insert(schema.restaurant)
      .values({
        travelPostId: travel.id,
        name: r.name,
        city: r.city,
        description: r.description,
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
      const dishImg = await placeholder(d.name.split(" ")[0], d.color, 960, 720);
      await db
        .insert(schema.dishImage)
        .values({ dishId: dishRow.id, imageId: dishImg, sortOrder: 0 });
      await db.insert(schema.dishIngredient).values(
        d.ingredients.map((n) => ({ dishId: dishRow.id, ingredientId: ing[n] })),
      );
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

  const pages = [
    {
      title: "Über mich",
      slug: "ueber-mich",
      content:
        "Hallo, ich bin Rose! *(Platzhaltertext — bitte ersetzen.)*\n\nIch koche und backe seit meiner Kindheit und teile hier meine liebsten gesunden Rezepte sowie Reiseberichte übers Essen in aller Welt.",
    },
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
  await db.insert(schema.page).values(
    pages.map((p, i) => ({
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
    })),
  );

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
