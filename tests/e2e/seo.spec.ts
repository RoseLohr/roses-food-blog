/**
 * E2E-Guardrail für SEO/GEO: geprüft wird, was der SERVER ausliefert.
 *
 * Warum als E2E und nicht nur als Unit-Test: Der Produktionsbefund 08/2026
 * („Sitemap: http://localhost:3000/sitemap.xml", ausgeliefert seit Monaten)
 * war KEIN Logikfehler in einer Funktion, sondern ein Render-Zeitpunkt:
 * app/robots.ts wurde beim BUILD vorgerendert und der Ursprung eingefroren.
 * Nur ein Abruf gegen den laufenden Server kann das zeigen.
 *
 * Der entscheidende Test heißt „heilt eine veraltete Konfiguration": Er ruft
 * die Artefakte mit den Proxy-Kopfzeilen einer FREMDEN Domain ab. Käme die
 * Antwort aus dem Build (oder aus einer veralteten BASE_URL), stünde dort
 * weiter der Build-Ursprung.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

/** Kopfzeilen, wie nginx sie für die öffentliche Domain durchreicht. */
const FREMDE_DOMAIN = {
  "x-forwarded-host": "gourmetcompass.de",
  "x-forwarded-proto": "https",
};
const FREMD_URSPRUNG = "https://gourmetcompass.de";

async function text(request: APIRequestContext, pfad: string, headers = {}) {
  const antwort = await request.get(pfad, { headers });
  expect(antwort.status(), `${pfad} muss 200 liefern`).toBe(200);
  return antwort;
}

test.describe("robots.txt", () => {
  test("nennt die Sitemap unter dem Ursprung der ANFRAGE, nicht dem des Builds", async ({
    request,
    baseURL,
  }) => {
    const antwort = await text(request, "/robots.txt");
    expect(antwort.headers()["content-type"]).toContain("text/plain");
    expect(await antwort.text()).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
  });

  test("heilt eine veraltete Konfiguration: fremde Proxy-Domain gewinnt", async ({
    request,
  }) => {
    const body = await (await text(request, "/robots.txt", FREMDE_DOMAIN)).text();
    expect(body).toContain(`Sitemap: ${FREMD_URSPRUNG}/sitemap.xml`);
    expect(body).not.toContain("localhost");
  });

  test("sperrt Admin und API und lässt KI-Crawler ausdrücklich zu", async ({
    request,
  }) => {
    const body = await (await text(request, "/robots.txt")).text();
    expect(body).toContain("Disallow: /admin");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("User-agent: GPTBot");
    expect(body).toContain("User-agent: ClaudeBot");
    expect(body).toContain("Content-Signal: search=yes, ai-input=yes");
  });
});

test.describe("sitemap.xml", () => {
  test("ist wohlgeformtes XML und listet die veröffentlichten Inhalte", async ({
    request,
    baseURL,
  }) => {
    const antwort = await text(request, "/sitemap.xml");
    expect(antwort.headers()["content-type"]).toContain("xml");
    const body = await antwort.text();
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    // Die feste Grundmenge muss immer drinstehen.
    for (const pfad of ["", "/rezepte", "/reisen", "/saisonkalender", "/datenschutz"]) {
      expect(body).toContain(`<loc>${baseURL}${pfad}</loc>`);
    }
    // Und mindestens ein Rezept aus dem Seed.
    expect(body).toMatch(/<loc>[^<]*\/rezepte\/[^<]+<\/loc>/);
  });

  test("folgt der Proxy-Domain in JEDER einzelnen URL", async ({ request }) => {
    const body = await (await text(request, "/sitemap.xml", FREMDE_DOMAIN)).text();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(5);
    for (const loc of locs) {
      expect(loc === FREMD_URSPRUNG || loc.startsWith(`${FREMD_URSPRUNG}/`)).toBe(true);
    }
  });

  test("verweist auf keine tote Seite — jede URL antwortet mit 200", async ({
    request,
  }) => {
    const body = await (await text(request, "/sitemap.xml")).text();
    const pfade = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => new URL(m[1]).pathname + new URL(m[1]).search,
    );
    expect(pfade.length).toBeGreaterThan(5);
    for (const pfad of pfade) {
      const antwort = await request.get(pfad);
      expect(antwort.status(), `Sitemap-URL ${pfad} ist tot`).toBe(200);
    }
  });
});

test.describe("llms.txt", () => {
  test("folgt dem llmstxt.org-Aufbau und verlinkt absolut", async ({
    request,
    baseURL,
  }) => {
    const antwort = await text(request, "/llms.txt");
    expect(antwort.headers()["content-type"]).toContain("text/plain");
    const body = await antwort.text();
    const zeilen = body.split("\n");
    expect(zeilen[0].startsWith("# ")).toBe(true);
    expect(zeilen[2].startsWith("> ")).toBe(true);
    expect(body).toContain("## Rezepte");
    expect(body).toContain(`](${baseURL}/rezepte/`);
    expect(body).toContain(`- [Sitemap](${baseURL}/sitemap.xml)`);
  });

  test("nennt dieselben Inhalte wie die Sitemap", async ({ request }) => {
    const sitemap = await (await text(request, "/sitemap.xml")).text();
    const llms = await (await text(request, "/llms.txt")).text();
    const rezepte = [...sitemap.matchAll(/<loc>([^<]*\/rezepte\/[^<]+)<\/loc>/g)]
      .map((m) => m[1])
      .filter((u) => !u.includes("/kategorie/"));
    expect(rezepte.length).toBeGreaterThan(0);
    for (const url of rezepte) {
      expect(llms, `${url} fehlt in llms.txt`).toContain(`](${url})`);
    }
  });

  test("folgt ebenfalls der Proxy-Domain", async ({ request }) => {
    const body = await (await text(request, "/llms.txt", FREMDE_DOMAIN)).text();
    expect(body).toContain(`](${FREMD_URSPRUNG}/`);
    expect(body).not.toContain("localhost");
  });
});

test.describe("Seiten-Metadaten", () => {
  test("Startseite: Canonical und Sitemap-URL sind identisch", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto("/");
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(canonical).toBe(baseURL);

    // Weichen die beiden ab, wertet Google die Sitemap-URL als Duplikat mit
    // abweichendem Canonical — die Startseite verliert ihr Ranking-Signal.
    const sitemap = await (await text(request, "/sitemap.xml")).text();
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toContain(canonical);
  });

  test("Rezeptseite trägt Canonical, OpenGraph und Recipe-JSON-LD", async ({
    page,
    request,
    baseURL,
  }) => {
    const sitemap = await (await text(request, "/sitemap.xml")).text();
    const rezeptUrl = [...sitemap.matchAll(/<loc>([^<]*\/rezepte\/[^<]+)<\/loc>/g)]
      .map((m) => m[1])
      .find((u) => !u.includes("/kategorie/"));
    expect(rezeptUrl, "Sitemap enthält kein Rezept").toBeTruthy();
    const pfad = new URL(rezeptUrl as string).pathname;

    await page.goto(pfad);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${baseURL}${pfad}`,
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      `${baseURL}${pfad}`,
    );

    const bild = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(bild, "og:image fehlt").toBeTruthy();
    expect(bild?.startsWith("http"), "og:image muss absolut sein").toBe(true);

    const rohdaten = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const strukturen = rohdaten.map((r) => JSON.parse(r));
    const rezept = strukturen.find((s) => s["@type"] === "Recipe");
    expect(rezept, "Recipe-JSON-LD fehlt").toBeTruthy();
    expect(rezept.url).toBe(`${baseURL}${pfad}`);
    expect(rezept.author["@type"]).toBe("Organization");
    expect(Array.isArray(rezept.recipeIngredient)).toBe(true);
    expect(rezept.recipeIngredient.length).toBeGreaterThan(0);

    const krumen = strukturen.find((s) => s["@type"] === "BreadcrumbList");
    expect(krumen, "BreadcrumbList fehlt").toBeTruthy();
    for (const eintrag of krumen.itemListElement) {
      expect(eintrag.item === baseURL || eintrag.item.startsWith(`${baseURL}/`)).toBe(
        true,
      );
    }
  });

  test("Startseite trägt WebSite-JSON-LD mit erreichbarem Organisations-Logo", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto("/");
    const rohdaten = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const website = rohdaten
      .map((r) => JSON.parse(r))
      .find((s) => s["@type"] === "WebSite");
    expect(website, "WebSite-JSON-LD fehlt").toBeTruthy();
    expect(website.url).toBe(baseURL);
    expect(website.potentialAction.target).toContain(`${baseURL}/suche?q=`);

    // Ein Logo, das 404 liefert, ist schlimmer als keines.
    const logo = website.publisher.logo.url as string;
    expect((await request.get(new URL(logo).pathname)).status()).toBe(200);
  });

  test("Druckansicht und Newsletter-Seiten bleiben auf noindex", async ({ page }) => {
    await page.goto("/newsletter/abgemeldet");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });
});
