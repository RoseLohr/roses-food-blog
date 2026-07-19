import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkImgTag } from "../scripts/regime/responsive-images.mjs";
import { fontHash, collectRefs } from "../scripts/regime/font-cache.mjs";

/**
 * Performance-Guardrails (aus dem PageSpeed-/Lighthouse-Bericht 07/2026).
 * Diese Tests nageln die Wurzel-Fixes fest, damit sie vor jedem Deployment
 * nicht unbemerkt zurückgedreht werden — CI-durchgesetzt (vitest läuft im
 * Gate), unabhängig vom lokalen Playwright-Lauf.
 */
const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("Bildübermittlung: Slider-Thumbnails laden keine Großbilder", () => {
  const slider = read("src/components/hero-slider.tsx");
  const page = read("src/app/(public)/page.tsx");

  it("Thumbnail-<img> lädt NUR die kleine Quelle (thumbSrc) — ohne srcSet/sizes", () => {
    // Aus allen <img>-Blöcken den Thumbnail-Block (nutzt thumbSrc) herausgreifen.
    const tags = slider.match(/<img\b[\s\S]*?\/>/g) ?? [];
    const tag = tags.find((t) => t.includes("s.thumbSrc")) ?? "";
    expect(tag).toContain("src={s.thumbSrc}");
    // BEWUSST kein srcSet/sizes: sonst wählt High-DPR w640 statt w320.
    expect(tag).not.toContain("srcSet");
    expect(tag).not.toContain("sizes=");
    // Regression-Riegel: weder imgSrc noch imgSrcSet als Thumbnail-Quelle.
    expect(tag).not.toContain("s.imgSrc");
  });

  it("thumbSrc wird aus der KLEINSTEN Variante gebaut (widths[0])", () => {
    expect(page).toMatch(/thumbSrc:\s*imageUrl\(s\.img\.fileKey,\s*widths\[0\]/);
  });
});

describe("Bildübermittlung: Rezept-Kacheln fordern kontextgerechte Größen an", () => {
  const card = read("src/components/recipe-card.tsx");
  const page = read("src/app/(public)/page.tsx");

  it("RecipeCard reicht ein überschreibbares sizes durch (Default für volle Breite)", () => {
    // sizes ist NICHT hartcodiert, sondern kommt aus imageSizes (Kontext-abhängig).
    expect(card).toMatch(/imageSizes\s*=\s*DEFAULT_CARD_SIZES/);
    expect(card).toContain("sizes={imageSizes}");
    // Default nennt eine feste Desktop-Obergrenze (kein „100vw" ab Desktop). Der
    // Anker auf das LETZTE Token (…, <NNN>px") gibt dem Riegel Zähne: ein Revert des
    // Desktop-Werts auf „…, 100vw" schlägt fehl (die Breakpoints 640px/1024px im
    // String dürfen nicht fälschlich als Obergrenze durchgehen).
    expect(card).toMatch(/DEFAULT_CARD_SIZES\s*=\s*["'][^"']*,\s*\d{3}px["']/);
  });

  it("Startseite gibt den Kacheln die engere Spaltenbreite (~256px, → w320 statt w640)", () => {
    expect(page).toMatch(/HOME_CARD_SIZES\s*=\s*["'][^"']*256px/);
    // Beide Kachel-Raster (popular + latest) nutzen den engen Wert.
    const uses = page.match(/imageSizes=\{HOME_CARD_SIZES\}/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Bildübermittlung: WebP-Qualität bleibt im sinnvollen Band", () => {
  const media = read("src/lib/media.ts");

  it("WEBP_QUALITY ist zentral definiert und liegt in [70,82]", () => {
    const m = media.match(/WEBP_QUALITY\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    const q = Number(m![1]);
    expect(q).toBeGreaterThanOrEqual(70); // nicht aggressiv wegkomprimieren
    expect(q).toBeLessThanOrEqual(82); // nicht versehentlich aufblähen
  });

  it("beide Backends (sharp + vips) nutzen die Konstante, keinen Literal-Wert", () => {
    expect(media).toContain("quality: WEBP_QUALITY");
    expect(media).toContain("Q=${WEBP_QUALITY}");
    // Kein hartcodiertes quality:80 / Q=80 mehr.
    expect(media).not.toMatch(/quality:\s*\d/);
    expect(media).not.toMatch(/Q=\d/);
  });
});

describe("Cache: Marken-SVGs sind versioniert + langzeit-immutable (Panel-Disziplin)", () => {
  it("next.config cached /brand unveränderlich für ein Jahr", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toMatch(/source:\s*["'`]\/brand\/:file\*/);
    // /brand UND /fonts tragen je einen immutable-Jahrescache.
    expect((cfg.match(/max-age=31536000,\s*immutable/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("Brand-SVG-URLs tragen ?v=<Inhalts-Hash> == Datei (immutable ist sicher)", () => {
    const dir = path.join(root, "public/brand");
    const refs = collectRefs(read("src/components/site-logo.tsx"), "brand", "svg");
    const svgs = fs.readdirSync(dir).filter((f) => f.endsWith(".svg"));
    expect(svgs.length).toBeGreaterThan(0);
    for (const file of svgs) {
      const name = file.replace(/\.svg$/, "");
      const h = fontHash(fs.readFileSync(path.join(dir, file)));
      expect(refs.get(name)).toBe(h);
    }
  });
});

describe("responsive-images-Gate erkennt die Anti-Muster", () => {
  it("srcSet ohne sizes ist ein Verstoß", () => {
    expect(checkImgTag('<img srcSet="a 1w" src="/x.webp" />').length).toBeGreaterThan(0);
  });
  it("großes Bild als src ohne srcSet ist ein Verstoß", () => {
    expect(checkImgTag('<img src="/uploads/x/w1920.webp" />').length).toBeGreaterThan(0);
  });
  it("korrekt responsive Bilder sind kein Verstoß", () => {
    expect(
      checkImgTag('<img src="/uploads/x/w320.webp" srcSet="a 1w" sizes="10vw" />').length,
    ).toBe(0);
  });

  // Vom Fremd-Vendor-Panel (gpt-5.6-sol) gemeldete Fail-open-Umgehungen — hier
  // in CI festgenagelt (nicht nur im mjs-Selbsttest).
  it("Pfeilfunktion (=>) vor srcSet schneidet das Tag nicht ab (R1 greift)", () => {
    expect(
      checkImgTag('<img onError={(e) => (e.currentTarget.hidden = true)} srcSet="a 1w" src="/x/w320.webp" />').length,
    ).toBeGreaterThan(0);
  });
  it("data-sizes zählt nicht als sizes (R1 greift)", () => {
    expect(
      checkImgTag('<img src="/x/w320.webp" srcSet="a 1w" data-sizes="10vw" />').length,
    ).toBeGreaterThan(0);
  });
  it("src mit Leerzeichen um = wird geprüft (R2 greift)", () => {
    expect(checkImgTag('<img src = "/uploads/x/w1920.webp" />').length).toBeGreaterThan(0);
  });
  it("Großbild-Literal nur in alt/data ist kein Fehlalarm", () => {
    expect(
      checkImgTag('<img alt="siehe w1920.webp" src="/x/w320.webp" srcSet="a 1w" sizes="10vw" />').length,
    ).toBe(0);
  });
});

describe("Schriften: Langzeit-Cache + Preload (kritische Kette)", () => {
  it("next.config cached /fonts unveränderlich für ein Jahr", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toMatch(/source:\s*["'`]\/fonts\/:file\*/);
    expect(cfg).toMatch(/max-age=31536000,\s*immutable/);
  });

  it("Layout lädt die Above-the-fold-Schriften vorab (rel=preload, crossOrigin)", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('rel="preload"');
    expect(layout).toContain('as="font"');
    expect(layout).toContain('crossOrigin="anonymous"');
    for (const f of ["raleway.woff2", "nunito-sans.woff2", "jost.woff2"]) {
      expect(layout).toContain(f);
    }
  });

  it("Font-URLs sind per ?v=<Inhalts-Hash> versioniert — immutable ist sicher (Panel-Befund)", () => {
    const dir = path.join(root, "public/fonts");
    const globalsRefs = collectRefs(read("src/app/globals.css"));
    const layoutRefs = collectRefs(read("src/app/layout.tsx"));
    const fonts = fs.readdirSync(dir).filter((f) => f.endsWith(".woff2"));
    expect(fonts.length).toBeGreaterThan(0);
    for (const file of fonts) {
      const name = file.replace(/\.woff2$/, "");
      const h = fontHash(fs.readFileSync(path.join(dir, file)));
      expect(globalsRefs.get(name)).toBe(h); // @font-face-URL trägt aktuellen Hash
      expect(layoutRefs.get(name)).toBe(h); // Preload-URL identisch (kein Doppel-Load)
    }
  });
});

describe("Modernes JavaScript: kein Polyfill-Ballast (browserslist)", () => {
  const pkg = JSON.parse(read("package.json")) as {
    browserslist?: string[];
  };

  it("package.json definiert eine browserslist", () => {
    expect(Array.isArray(pkg.browserslist)).toBe(true);
    expect(pkg.browserslist!.length).toBeGreaterThan(0);
  });

  it("Ziele sind modern genug für Baseline-Features (kein Alt-Browser)", () => {
    const list = pkg.browserslist!.join(" ").toLowerCase();
    // Keine Legacy-Ziele, die Polyfills für Array.at/Object.hasOwn erzwingen.
    expect(list).not.toMatch(/\bie\b|explorer|op_mini|\bandroid\s*<|safari\s*<\s*15/);
    // Mindestens eine harte Untergrenze, damit die Liste nicht „defaults" meint.
    expect(list).toMatch(/chrome\s*>=\s*1\d\d/);
    expect(list).toMatch(/safari\s*>=\s*16/);
  });
});
