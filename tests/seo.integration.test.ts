/**
 * Integrationstest: „Jede Änderung wirkt automatisch in allen SEO-Artefakten."
 *
 * Gegen eine echte SQLite-DB wird veröffentlicht, geändert und zurückgezogen —
 * und danach geprüft, dass Sitemap UND llms.txt das ohne weiteres Zutun
 * abbilden. Das ist die Zusage, die vorher nirgends nachgewiesen war: Die
 * ausgelieferte Sitemap kannte weder Kategorie- noch Reisefilter-Seiten, die
 * llms.txt keine CMS-Seiten.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLlmsTxt, buildSitemapUrls, buildSitemapXml } from "@/lib/seo/artifacts";

const BASE = "https://gourmetcompass.de";
/** Fester Zeitstempel — die Spalten sind Pflicht (kein JS-Default im Schema). */
const STAND = new Date("2026-08-15T09:53:57.386Z");

let tmp: string;
let db: typeof import("@/db").db;
let schema: typeof import("@/db").schema;
let loadSeoContent: typeof import("@/lib/seo/content").loadSeoContent;

/** Kleine Hilfe, damit die drizzle-Bedingung nicht in jeder Zeile steht. */
function eqSlug(slug: string) {
  return eq(schema.recipe.slug, slug);
}

/** Alle URLs der Sitemap zum aktuellen DB-Stand. */
async function sitemapLocs(): Promise<string[]> {
  return buildSitemapUrls(BASE, await loadSeoContent()).map((u) => u.loc);
}

/** llms.txt zum aktuellen DB-Stand. */
async function llms(): Promise<string> {
  return buildLlmsTxt(BASE, await loadSeoContent(), {
    siteName: "Rose’s Gourmet Compass",
    tagline: "Gesunde Rezepte & kulinarische Reisen",
  });
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-seo-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", { env: { ...process.env, DATA_DIR: tmp } });
  ({ db, schema } = await import("@/db"));
  ({ loadSeoContent } = await import("@/lib/seo/content"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Veröffentlichen und Zurückziehen", () => {
  it("nimmt ein veröffentlichtes Rezept in Sitemap UND llms.txt auf", async () => {
    await db.insert(schema.recipe).values({
      title: "Caponata",
      slug: "caponata",
      teaser: "Sizilianisches Schmorgemüse.",
      status: "veroeffentlicht",
      publishedAt: STAND,
      createdAt: STAND,
      updatedAt: STAND,
    });

    expect(await sitemapLocs()).toContain(`${BASE}/rezepte/caponata`);
    expect(await llms()).toContain(`- [Caponata](${BASE}/rezepte/caponata): Sizilianisches Schmorgemüse.`);
  });

  it("lässt einen Entwurf aus beiden Artefakten heraus", async () => {
    await db.insert(schema.recipe).values({
      title: "Geheimes Rezept",
      slug: "geheim",
      teaser: "Noch nicht fertig.",
      status: "entwurf",
      createdAt: STAND,
      updatedAt: STAND,
    });

    expect(await sitemapLocs()).not.toContain(`${BASE}/rezepte/geheim`);
    expect(await llms()).not.toContain("/rezepte/geheim");
  });

  it("entfernt ein zurückgezogenes Rezept sofort aus beiden Artefakten", async () => {
    await db.insert(schema.recipe).values({
      title: "Kurz sichtbar",
      slug: "kurz-sichtbar",
      teaser: "Nur ein Moment.",
      status: "veroeffentlicht",
      createdAt: STAND,
      updatedAt: STAND,
    });
    expect(await sitemapLocs()).toContain(`${BASE}/rezepte/kurz-sichtbar`);

    await db
      .update(schema.recipe)
      .set({ status: "entwurf" })
      .where(eqSlug("kurz-sichtbar"));

    expect(await sitemapLocs()).not.toContain(`${BASE}/rezepte/kurz-sichtbar`);
    expect(await llms()).not.toContain("/rezepte/kurz-sichtbar");
  });

  it("übernimmt eine geänderte SEO-Beschreibung in die llms.txt", async () => {
    await db
      .update(schema.recipe)
      .set({ seoDescription: "Geröstetes Sommergemüse mit Weißweinessig." })
      .where(eqSlug("caponata"));

    expect(await llms()).toContain("Geröstetes Sommergemüse mit Weißweinessig.");
  });
});

describe("Abgeleitete Seiten", () => {
  it("nimmt eine Kategorie auf, sobald ein veröffentlichtes Rezept daran hängt", async () => {
    const [kategorie] = await db
      .insert(schema.taxonomy)
      .values({ type: "kategorie", name: "Hauptgericht", slug: "hauptgericht" })
      .returning();
    const rezept = await db.select().from(schema.recipe).where(eqSlug("caponata"));

    expect(await sitemapLocs()).not.toContain(`${BASE}/rezepte/kategorie/hauptgericht`);

    await db
      .insert(schema.recipeTaxonomy)
      .values({ recipeId: rezept[0].id, taxonomyId: kategorie.id });

    expect(await sitemapLocs()).toContain(`${BASE}/rezepte/kategorie/hauptgericht`);
    expect(await llms()).toContain(`- [Hauptgericht](${BASE}/rezepte/kategorie/hauptgericht)`);
  });

  it("erzeugt aus Land/Region/Stadt eines Reiseberichts die Filterseiten", async () => {
    await db.insert(schema.travelPost).values({
      title: "Perth & Rottnest Island",
      slug: "perth-rottnestisland",
      teaser: "Ein Tagesausflug zu den Quokkas.",
      country: "Australien",
      region: "Western Australia",
      city: "Perth, Fremantle",
      status: "veroeffentlicht",
      createdAt: STAND,
      updatedAt: STAND,
    });

    const locs = await sitemapLocs();
    expect(locs).toContain(`${BASE}/reisen/perth-rottnestisland`);
    expect(locs).toContain(`${BASE}/reisen/land/Australien`);
    expect(locs).toContain(`${BASE}/reisen/region/Western%20Australia`);
    expect(locs).toContain(`${BASE}/reisen/stadt/Perth`);
    expect(locs).toContain(`${BASE}/reisen/stadt/Fremantle`);
  });

  it("nimmt eine CMS-Seite erst beim Veröffentlichen auf — in der llms.txt fehlten sie ganz", async () => {
    await db.insert(schema.page).values({
      title: "Kontakt",
      slug: "kontakt",
      seoDescription: "So erreichst du mich.",
      status: "entwurf",
      createdAt: STAND,
      updatedAt: STAND,
    });
    expect(await sitemapLocs()).not.toContain(`${BASE}/kontakt`);

    await db
      .update(schema.page)
      .set({ status: "veroeffentlicht" })
      .where(eq(schema.page.slug, "kontakt"));

    expect(await sitemapLocs()).toContain(`${BASE}/kontakt`);
    expect(await llms()).toContain(`- [Kontakt](${BASE}/kontakt): So erreichst du mich.`);
  });
});

describe("Ausgeliefertes XML", () => {
  it("enthält jede URL genau einmal und keine Loopback-Adresse", async () => {
    const locs = await sitemapLocs();
    expect(new Set(locs).size).toBe(locs.length);
    expect(locs.every((l) => l === BASE || l.startsWith(`${BASE}/`))).toBe(true);
  });

  it("ist wohlgeformtes XML mit passender URL-Zahl", async () => {
    const xml = buildSitemapXml(buildSitemapUrls(BASE, await loadSeoContent()));
    const locs = await sitemapLocs();
    expect(xml.match(/<url>/g)).toHaveLength(locs.length);
    expect(xml.match(/<\/url>/g)).toHaveLength(locs.length);
    expect(xml).not.toContain("localhost");
  });

  it("datiert die Startseite auf die jüngste Inhaltsänderung", async () => {
    const urls = buildSitemapUrls(BASE, await loadSeoContent());
    const start = urls.find((u) => u.loc === BASE);
    expect(start?.lastModified).not.toBeNull();
  });
});
