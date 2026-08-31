/**
 * Einheitstests der SEO-/LLM-Artefakte und der Ursprungs-Auflösung.
 *
 * Diese Datei ist die direkte Antwort auf den Befund 08/2026: Ausgeliefert
 * wurden eine robots.txt mit „Sitemap: http://localhost:3000/sitemap.xml" und
 * eine Sitemap auf einer abgelegten Domain — monatelang, ohne dass irgendein
 * Test das gesehen hätte. Geprüft wird deshalb der TEXT, den ein Crawler
 * bekommt, nicht nur die Existenz einer Funktion.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  SITE_ORIGIN,
  getBaseUrl,
  hostnameOf,
  isLoopbackOrigin,
  isSameSite,
  normalizeOrigin,
  originFromHeaders,
  resolvePublicBaseUrl,
} from "@/lib/base-url";
import {
  AI_USER_AGENTS,
  CONTENT_SIGNAL,
  absoluteUrl,
  buildLlmsTxt,
  buildRobotsTxt,
  buildSitemapUrls,
  buildSitemapXml,
  escapeLinkText,
  escapeXml,
  singleLine,
} from "@/lib/seo/artifacts";
import {
  newestDate,
  splitTokens,
  travelFilterEntries,
  type SeoContent,
} from "@/lib/seo/model";
import { DISALLOWED_PREFIXES, STATIC_ROUTES } from "@/lib/seo/routes";

const BASE = "https://gourmetcompass.de";

function inhalt(overrides: Partial<SeoContent> = {}): SeoContent {
  return {
    recipes: [],
    travels: [],
    pages: [],
    categories: [],
    dietForms: [],
    travelFilters: [],
    lastModified: null,
    ...overrides,
  };
}

// --- Ursprungs-Auflösung ----------------------------------------------------

describe("getBaseUrl", () => {
  const vorher = process.env.BASE_URL;
  afterEach(() => {
    if (vorher === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = vorher;
  });

  it("fällt OHNE BASE_URL auf die kanonische Domain zurück, nie auf localhost", () => {
    delete process.env.BASE_URL;
    expect(getBaseUrl()).toBe(SITE_ORIGIN);
    expect(getBaseUrl()).not.toContain("localhost");
  });

  it("nimmt eine gültige BASE_URL und wirft den abschließenden Slash weg", () => {
    process.env.BASE_URL = "https://beispiel.de/";
    expect(getBaseUrl()).toBe("https://beispiel.de");
  });

  it("ignoriert eine unbrauchbare BASE_URL statt sie auszuliefern", () => {
    for (const kaputt of ["", "   ", "beispiel.de", "ftp://beispiel.de", "://x"]) {
      process.env.BASE_URL = kaputt;
      expect(getBaseUrl()).toBe(SITE_ORIGIN);
    }
  });
});

describe("normalizeOrigin", () => {
  it("normalisiert Schema, Host, Standard-Port und Pfad weg", () => {
    expect(normalizeOrigin("https://Beispiel.DE:443/pfad?x=1")).toBe(
      "https://beispiel.de",
    );
    expect(normalizeOrigin("http://beispiel.de:8080/")).toBe(
      "http://beispiel.de:8080",
    );
  });

  it("weist alles ab, was kein absoluter http(s)-Ursprung ist", () => {
    for (const wert of [null, undefined, "", "beispiel.de", "javascript:alert(1)"]) {
      expect(normalizeOrigin(wert)).toBeNull();
    }
  });
});

describe("hostnameOf / isLoopbackOrigin / isSameSite", () => {
  it("trennt Port und IPv6-Klammern ab", () => {
    expect(hostnameOf("Beispiel.de:3000")).toBe("beispiel.de");
    expect(hostnameOf("[::1]:3000")).toBe("::1");
  });

  it("erkennt Loopback in allen üblichen Schreibweisen", () => {
    for (const o of ["http://localhost:3000", "http://127.0.0.1", "http://[::1]:8080"]) {
      expect(isLoopbackOrigin(o)).toBe(true);
    }
    expect(isLoopbackOrigin(BASE)).toBe(false);
  });

  it("hält www- und Protokoll-Varianten für dieselbe Website", () => {
    expect(isSameSite(BASE, "https://www.gourmetcompass.de")).toBe(true);
    expect(isSameSite(BASE, "http://gourmetcompass.de")).toBe(true);
    expect(isSameSite(BASE, "https://kochbuch.klee.me")).toBe(false);
    expect(isSameSite(BASE, "kaputt")).toBe(false);
  });
});

describe("originFromHeaders", () => {
  const kopf = (werte: Record<string, string>) => new Headers(werte);

  it("nimmt X-Forwarded-Host vor Host und den durchgereichten Proto", () => {
    expect(
      originFromHeaders(
        kopf({
          host: "127.0.0.1:3000",
          "x-forwarded-host": "gourmetcompass.de",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(BASE);
  });

  it("nimmt den ersten Wert einer Proxy-Kette", () => {
    expect(
      originFromHeaders(
        kopf({ "x-forwarded-host": "gourmetcompass.de, innen", "x-forwarded-proto": "https, http" }),
      ),
    ).toBe(BASE);
  });

  it("nimmt ohne Proto https an — außer bei Loopback", () => {
    expect(originFromHeaders(kopf({ host: "gourmetcompass.de" }))).toBe(BASE);
    expect(originFromHeaders(kopf({ host: "localhost:3333" }))).toBe(
      "http://localhost:3333",
    );
  });

  it("weist manipulierte Host-Header ab", () => {
    for (const host of [
      "opfer@boese.example",
      "gourmetcompass.de/pfad",
      "boese example",
      "",
      `${"a".repeat(254)}.de`,
    ]) {
      expect(originFromHeaders(kopf({ host }))).toBeNull();
    }
    expect(
      originFromHeaders(kopf({ host: "gourmetcompass.de", "x-forwarded-proto": "gopher" })),
    ).toBeNull();
  });

  it("liefert ohne jeden Host-Header null", () => {
    expect(originFromHeaders(kopf({}))).toBeNull();
  });
});

describe("resolvePublicBaseUrl", () => {
  it("nimmt ohne Anfrage-Ursprung die Konfiguration", () => {
    expect(resolvePublicBaseUrl(BASE, null)).toBe(BASE);
  });

  it("normalisiert www- und http-Varianten auf den konfigurierten Ursprung", () => {
    expect(resolvePublicBaseUrl(BASE, "https://www.gourmetcompass.de")).toBe(BASE);
    expect(resolvePublicBaseUrl(BASE, "http://gourmetcompass.de")).toBe(BASE);
  });

  it("lässt interne Loopback-Anfragen die Artefakte nicht auf localhost umschreiben", () => {
    expect(resolvePublicBaseUrl(BASE, "http://127.0.0.1:3000")).toBe(BASE);
  });

  it("heilt eine veraltete Konfiguration: die ausgelieferte Domain gewinnt", () => {
    // Genau der Produktionsfall: .env stand auf der alten Domain, die Seite lief
    // längst unter der neuen. Ohne diese Regel zeigte jede URL nach nirgendwo.
    expect(resolvePublicBaseUrl("https://kochbuch.klee.me", BASE)).toBe(BASE);
  });

  it("bleibt in Entwicklung/E2E auf dem konfigurierten Loopback", () => {
    expect(
      resolvePublicBaseUrl("http://localhost:3333", "http://localhost:3333"),
    ).toBe("http://localhost:3333");
  });
});

// --- Textwerkzeuge ----------------------------------------------------------

describe("Textwerkzeuge", () => {
  it("absoluteUrl schreibt die Startseite ohne Slash — wie Next das Canonical", () => {
    expect(absoluteUrl(BASE, "/")).toBe(BASE);
    expect(absoluteUrl(BASE, "/rezepte")).toBe(`${BASE}/rezepte`);
  });

  it("escapeXml maskiert alle fünf Sonderzeichen", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("singleLine macht aus mehrzeiligem Teaser eine Zeile", () => {
    expect(singleLine("Zeile eins\nZeile\tzwei   drei ")).toBe(
      "Zeile eins Zeile zwei drei",
    );
  });

  it("escapeLinkText entschärft eckige Klammern", () => {
    expect(escapeLinkText("Curry [scharf]")).toBe("Curry \\[scharf\\]");
  });
});

// --- robots.txt -------------------------------------------------------------

describe("buildRobotsTxt", () => {
  const txt = buildRobotsTxt(BASE);

  it("verweist auf die Sitemap unter dem übergebenen Ursprung", () => {
    expect(txt).toContain(`Sitemap: ${BASE}/sitemap.xml`);
  });

  it("enthält nirgends localhost — der Kern des Produktionsbefunds", () => {
    expect(buildRobotsTxt(BASE)).not.toContain("localhost");
    expect(buildRobotsTxt("http://localhost:3000")).toContain(
      "Sitemap: http://localhost:3000/sitemap.xml",
    );
  });

  it("nennt llms.txt, damit Antwortmaschinen sie finden", () => {
    expect(txt).toContain(`${BASE}/llms.txt`);
  });

  it("sperrt Admin, API und Druckansicht in JEDER Gruppe", () => {
    // Gruppen sind durch Leerzeilen getrennt; eine Gruppe darf mehrere
    // User-agent-Zeilen tragen (alle KI-Crawler teilen sich eine Regelmenge).
    const gruppen = txt.split("\n\n").filter((g) => g.includes("User-agent:"));
    expect(gruppen).toHaveLength(2);
    for (const gruppe of gruppen) {
      for (const prefix of DISALLOWED_PREFIXES) {
        expect(gruppe).toContain(`Disallow: ${prefix}`);
      }
      expect(gruppe).toContain(`Content-Signal: ${CONTENT_SIGNAL}`);
    }
  });

  it("heißt die KI-Crawler ausdrücklich willkommen", () => {
    for (const agent of AI_USER_AGENTS) {
      expect(txt).toContain(`User-agent: ${agent}`);
    }
    expect(txt).toContain("Content-Signal: search=yes, ai-input=yes");
  });
});

// --- sitemap.xml ------------------------------------------------------------

describe("buildSitemapUrls", () => {
  it("enthält jede registrierte feste Route", () => {
    const urls = buildSitemapUrls(BASE, inhalt());
    for (const route of STATIC_ROUTES) {
      expect(urls.map((u) => u.loc)).toContain(absoluteUrl(BASE, route.path));
    }
  });

  it("nimmt Kategorien und Reisefilter auf — vorher fehlten beide", () => {
    const urls = buildSitemapUrls(
      BASE,
      inhalt({
        categories: [
          { path: "/rezepte/kategorie/suppen", title: "Suppen", description: "", lastModified: null },
        ],
        travelFilters: [
          { path: "/reisen/land/Italien", title: "Italien", description: "", lastModified: null },
        ],
      }),
    );
    const locs = urls.map((u) => u.loc);
    expect(locs).toContain(`${BASE}/rezepte/kategorie/suppen`);
    expect(locs).toContain(`${BASE}/reisen/land/Italien`);
  });

  it("datiert die Startseite auf die jüngste Inhaltsänderung", () => {
    const stand = new Date("2026-08-15T09:53:57.386Z");
    const [start] = buildSitemapUrls(BASE, inhalt({ lastModified: stand }));
    expect(start.loc).toBe(BASE);
    expect(start.lastModified).toEqual(stand);
  });
});

describe("buildSitemapXml", () => {
  const stand = new Date("2026-08-15T09:53:57.386Z");
  const xml = buildSitemapXml([
    { loc: `${BASE}/rezepte/caponata`, lastModified: stand, changeFrequency: "weekly", priority: 0.8 },
    { loc: `${BASE}/suche`, lastModified: null, changeFrequency: "monthly", priority: 0.3 },
  ]);

  it("schreibt einen gültigen urlset-Rahmen", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("schreibt lastmod nur, wenn eines bekannt ist", () => {
    expect(xml).toContain(`<lastmod>${stand.toISOString()}</lastmod>`);
    expect(xml.match(/<lastmod>/g)).toHaveLength(1);
  });

  it("schreibt changefreq und priority je URL", () => {
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>0.8</priority>");
    expect(xml).toContain("<priority>0.3</priority>");
  });

  it("maskiert Sonderzeichen in der URL", () => {
    const roh = buildSitemapXml([
      { loc: `${BASE}/reisen/land/A&B`, lastModified: null, changeFrequency: "monthly", priority: 0.4 },
    ]);
    expect(roh).toContain("<loc>https://gourmetcompass.de/reisen/land/A&amp;B</loc>");
  });
});

// --- llms.txt ---------------------------------------------------------------

describe("buildLlmsTxt", () => {
  const stand = new Date("2026-08-15T09:53:57.386Z");
  const aelter = new Date("2026-07-19T11:47:31.225Z");
  const txt = buildLlmsTxt(
    BASE,
    inhalt({
      recipes: [
        { path: "/rezepte/alt", title: "Altes Rezept", description: "Alt.", lastModified: aelter },
        { path: "/rezepte/caponata", title: "Caponata", description: "Sizilianisch.", lastModified: stand },
      ],
      pages: [{ path: "/ueber-mich", title: "Über mich", description: "", lastModified: null }],
      categories: [
        { path: "/rezepte/kategorie/suppen", title: "Suppen", description: "", lastModified: null },
      ],
    }),
    { siteName: "Rose’s Gourmet Compass", tagline: "Gesunde Rezepte & kulinarische Reisen" },
  );

  it("beginnt mit H1 und Blockquote nach llmstxt.org", () => {
    const zeilen = txt.split("\n");
    expect(zeilen[0]).toBe("# Rose’s Gourmet Compass");
    expect(zeilen[2].startsWith("> Gesunde Rezepte & kulinarische Reisen.")).toBe(true);
  });

  it("verlinkt absolut auf den übergebenen Ursprung", () => {
    expect(txt).toContain(`](${BASE}/rezepte/caponata)`);
    expect(txt).not.toContain("localhost");
  });

  it("führt Rezepte neueste zuerst", () => {
    expect(txt.indexOf("/rezepte/caponata")).toBeLessThan(txt.indexOf("/rezepte/alt"));
  });

  it("kennt CMS-Seiten und Kategorien — beide fehlten vorher", () => {
    expect(txt).toContain("## Seiten");
    expect(txt).toContain(`- [Über mich](${BASE}/ueber-mich)`);
    expect(txt).toContain("## Kategorien");
    expect(txt).toContain(`- [Suppen](${BASE}/rezepte/kategorie/suppen)`);
  });

  it("verweist auf die Sitemap", () => {
    expect(txt).toContain(`- [Sitemap](${BASE}/sitemap.xml)`);
  });

  it("lässt leere Abschnitte weg statt eine leere Überschrift zu schreiben", () => {
    expect(txt).not.toContain("## Reiseberichte");
  });

  it("hält einen mehrzeiligen Teaser auf einer Zeile", () => {
    const mit = buildLlmsTxt(
      BASE,
      inhalt({
        recipes: [
          {
            path: "/rezepte/x",
            title: "X",
            description: "Erste Zeile\nZweite Zeile",
            lastModified: null,
          },
        ],
      }),
      { siteName: "S", tagline: "T" },
    );
    expect(mit).toContain(`- [X](${BASE}/rezepte/x): Erste Zeile Zweite Zeile`);
  });
});

// --- Inhalts-Ableitungen ----------------------------------------------------

describe("Inhalts-Ableitungen", () => {
  it("splitTokens zerlegt kommagetrennte Mehrfachwerte", () => {
    expect(splitTokens("Queensland, New South Wales ,, Victoria")).toEqual([
      "Queensland",
      "New South Wales",
      "Victoria",
    ]);
    expect(splitTokens("   ")).toEqual([]);
  });

  it("newestDate liefert das jüngste Datum, unabhängig von der Reihenfolge", () => {
    const a = new Date("2026-01-01T00:00:00.000Z");
    const b = new Date("2026-08-01T00:00:00.000Z");
    expect(newestDate([a, null, b])).toEqual(b);
    expect(newestDate([b, null, a])).toEqual(b);
    expect(newestDate([null, null])).toBeNull();
    expect(newestDate([])).toBeNull();
  });

  it("newestDate behält bei gleichem Zeitstempel den ERSTEN Treffer", () => {
    // Identitätsvergleich: „>" behält den ersten, „>=" ersetzte ihn durch ein
    // gleichwertiges, aber anderes Objekt — am Wert allein nicht zu sehen.
    const zuerst = new Date("2026-08-01T00:00:00.000Z");
    const gleich = new Date("2026-08-01T00:00:00.000Z");
    expect(newestDate([zuerst, gleich])).toBe(zuerst);
  });

  it("travelFilterEntries baut je Token genau eine URL wie die Links im Bericht", () => {
    const alt = new Date("2026-01-01T00:00:00.000Z");
    const neu = new Date("2026-08-01T00:00:00.000Z");
    const entries = travelFilterEntries([
      { country: "Australien", region: "Western Australia", city: "Perth", updatedAt: alt },
      { country: "Australien", region: "Queensland, Victoria", city: "", updatedAt: neu },
    ]);
    const pfade = entries.map((e) => e.path);
    expect(pfade).toContain("/reisen/land/Australien");
    expect(pfade).toContain("/reisen/region/Western%20Australia");
    expect(pfade).toContain("/reisen/region/Queensland");
    expect(pfade).toContain("/reisen/region/Victoria");
    expect(pfade).toContain("/reisen/stadt/Perth");
    expect(pfade.filter((p) => p === "/reisen/land/Australien")).toHaveLength(1);
  });

  it("travelFilterEntries liefert stabil nach Pfad sortiert", () => {
    // Ohne feste Reihenfolge wechselt die Sitemap bei jedem Abruf ihre
    // Sortierung — für Crawler ein Änderungssignal ohne Änderung.
    const entries = travelFilterEntries([
      { country: "Zypern", region: "", city: "Aachen", updatedAt: null },
      { country: "Australien", region: "", city: "", updatedAt: null },
    ]);
    const pfade = entries.map((e) => e.path);
    expect(pfade).toEqual([...pfade].sort((a, b) => a.localeCompare(b)));
    expect(pfade[0]).toBe("/reisen/land/Australien");
  });

  it("travelFilterEntries hält am jüngsten Datum fest, auch wenn der ältere Bericht später kommt", () => {
    const alt = new Date("2026-01-01T00:00:00.000Z");
    const neu = new Date("2026-08-01T00:00:00.000Z");
    // Der NEUERE Bericht steht zuerst: Ein späterer, älterer darf ihn nicht
    // überschreiben — sonst datiert die Sitemap den Ort zurück.
    const entries = travelFilterEntries([
      { country: "Australien", region: "", city: "", updatedAt: neu },
      { country: "Australien", region: "", city: "", updatedAt: alt },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].lastModified).toEqual(neu);
  });

  it("travelFilterEntries führt einen Ort trotz abweichender Schreibweise nur einmal", () => {
    const entries = travelFilterEntries([
      { country: "", region: "", city: "Perth", updatedAt: null },
      { country: "", region: "", city: "PERTH", updatedAt: null },
    ]);
    expect(entries).toHaveLength(1);
  });

  it("travelFilterEntries lässt die Beschreibung leer — der Ortsname ist der Titel", () => {
    const [eintrag] = travelFilterEntries([
      { country: "Italien", region: "", city: "", updatedAt: null },
    ]);
    expect(eintrag.title).toBe("Italien");
    expect(eintrag.description).toBe("");
  });

  it("überspringt leere Dimensionen", () => {
    expect(
      travelFilterEntries([{ country: "", region: "", city: "", updatedAt: null }]),
    ).toEqual([]);
  });
});
