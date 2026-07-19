import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkImgTag } from "../scripts/regime/responsive-images.mjs";

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

  it("Thumbnail-<img> nutzt srcSet + sizes + kleine Fallback-Quelle (thumbSrc)", () => {
    // Aus allen <img>-Blöcken den Thumbnail-Block (nutzt thumbSrc) herausgreifen.
    const tags = slider.match(/<img\b[\s\S]*?\/>/g) ?? [];
    const tag = tags.find((t) => t.includes("s.thumbSrc")) ?? "";
    expect(tag).toContain("srcSet={s.imgSrcSet}");
    expect(tag).toContain("sizes=");
    expect(tag).toContain("src={s.thumbSrc}");
    // Regression-Riegel: NICHT wieder das große imgSrc als Thumbnail-Quelle.
    expect(tag).not.toContain("src={s.imgSrc}");
  });

  it("thumbSrc wird aus der KLEINSTEN Variante gebaut (widths[0])", () => {
    expect(page).toMatch(/thumbSrc:\s*imageUrl\(s\.img\.fileKey,\s*widths\[0\]/);
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
