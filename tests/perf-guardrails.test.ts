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

describe("Bildübermittlung: Slider-Thumbnails sind regulär responsiv", () => {
  const slider = read("src/components/hero-slider.tsx");
  const page = read("src/app/(public)/page.tsx");

  it("Thumbnail-<img> trägt srcSet + enges sizes (kein fixes Großbild, kein 100vw)", () => {
    // Aus allen <img>-Blöcken den Thumbnail-Block (nutzt thumbSrc) herausgreifen.
    const tags = slider.match(/<img\b[\s\S]*?\/>/g) ?? [];
    const tag = tags.find((t) => t.includes("s.thumbSrc")) ?? "";
    expect(tag).toContain("src={s.thumbSrc}");
    // Seit es die w160-Stufe gibt, ist reguläres srcset byte-optimal — der
    // frühere „fix w320 ohne srcSet"-Sonderweg war nur ein Workaround um die
    // fehlende kleine Variante. sizes muss eine FESTE Desktop-Obergrenze
    // nennen (Navi-Kachel ≤ 13rem), nie viewport-breit deklarieren.
    expect(tag).toContain("srcSet={s.thumbSrcSet}");
    expect(tag).toMatch(/sizes="[^"]*\b\d{2,3}px"/);
    // Regression-Riegel: nicht die Hero-Quellen als Thumbnail verwenden.
    expect(tag).not.toContain("s.imgSrc");
  });

  it("thumbSrc-Fallback ist die KLEINSTE Variante, thumbSrcSet die volle Leiter", () => {
    expect(page).toMatch(/thumbSrc:\s*thumbUrl\(s\.img\.fileKey,\s*widths\)/);
    expect(page).toMatch(/thumbSrcSet:\s*srcset\(s\.img\.fileKey,\s*widths\)/);
  });

  it("Hero-Hauptbild deklariert die volle Bühne (full-bleed ⇒ sizes=100vw)", () => {
    const tags = slider.match(/<img\b[\s\S]*?\/>/g) ?? [];
    const tag = tags.find((t) => t.includes("slide.imgSrc")) ?? "";
    // Unterversorgung ist genauso ein sizes-Fehler wie Übergröße: die Bühne
    // ist auf JEDER Breite 100vw (.full-bleed) — ein px-Deckel wäre gelogen.
    expect(tag).toContain('sizes="100vw"');
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

describe("Bildübermittlung: Encoder-Konfiguration (config/bild-encoder.json)", () => {
  const media = read("src/lib/media.ts");
  const regen = read("scripts/regenerate-variants.mjs");
  const encoder = JSON.parse(read("config/bild-encoder.json")) as {
    rev: number;
    webpQuality: number;
    webpEffort: number;
    webpSmartSubsample: boolean;
    variantWidths: number[];
  };

  it("WebP-Qualität liegt im Band [62,74] (PageSpeed-Fix 07/2026, mit effort 6 + smart-subsample)", () => {
    // Untergrenze: Food-Fotos nicht kaputtkomprimieren; Obergrenze: das alte
    // 76er-Niveau (fast jedes Bild „höhere Komprimierung möglich") ist tabu.
    expect(encoder.webpQuality).toBeGreaterThanOrEqual(62);
    expect(encoder.webpQuality).toBeLessThanOrEqual(74);
    expect(encoder.webpEffort).toBeGreaterThanOrEqual(4);
    expect(encoder.webpEffort).toBeLessThanOrEqual(6);
    expect(encoder.webpSmartSubsample).toBe(true);
  });

  it("Breiten-Leiter: aufsteigend, Mini-Stufe ≤160, keine Lücke über Faktor 2", () => {
    const w = encoder.variantWidths;
    expect(w.length).toBeGreaterThanOrEqual(5);
    // Mini-Thumbs (Slider-Leiste, DietBox, Such-Gerichte) brauchen eine echte
    // kleine Stufe — ohne sie MUSS jede 56–90-px-Anzeige w320 laden.
    expect(w[0]).toBeLessThanOrEqual(160);
    for (let i = 1; i < w.length; i++) {
      expect(w[i]).toBeGreaterThan(w[i - 1]); // strikt aufsteigend
      // Nachbar-Verhältnis ≤ 2: größere Lücken erzwingen systematische
      // Übergrößen (der 640→960-Sprung war Teil des PageSpeed-Befunds).
      expect(w[i] / w[i - 1]).toBeLessThanOrEqual(2.0);
    }
  });

  it("Rev-Ratifizierung: Encoder-Änderung ohne rev-Erhöhung ist verboten", () => {
    // Fingerprint der wirksamen Einstellungen ↔ ratifizierte Revision.
    // Wer Qualität/effort/Leiter ändert, MUSS rev erhöhen (Regenerierung der
    // Bestands-Uploads + ?v-Cache-Busting) und hier den Eintrag ergänzen —
    // sonst blieben alle bestehenden Bilder dauerhaft auf dem alten Stand
    // (genau die Regression, die dieser Test festnagelt).
    const fingerprint = `q${encoder.webpQuality}-e${encoder.webpEffort}-ss${
      encoder.webpSmartSubsample ? 1 : 0
    }-w${encoder.variantWidths.join(",")}`;
    const RATIFIZIERT: Record<number, string> = {
      2: "q68-e6-ss1-w160,320,480,640,768,960,1280,1920",
    };
    expect(
      RATIFIZIERT[encoder.rev],
      "Unbekannte rev — Eintrag in RATIFIZIERT ergänzen (und Regenerierung bedenken)",
    ).toBeDefined();
    expect(
      fingerprint,
      "Encoder-Einstellungen geändert ohne rev-Erhöhung — rev anheben, damit Bestands-Uploads regeneriert und Caches gebustet werden",
    ).toBe(RATIFIZIERT[encoder.rev]);
  });

  it("AI_JPEG_QUALITY (KI-Rezeptfotos) ist zentral definiert und liegt in [70,85]", () => {
    const m = media.match(/AI_JPEG_QUALITY\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    const q = Number(m![1]);
    expect(q).toBeGreaterThanOrEqual(70); // Text auf Fotos bleibt lesbar
    expect(q).toBeLessThanOrEqual(85); // keine unnötig großen API-Payloads
  });

  it("beide Backends (sharp + vips) nutzen die Konstanten inkl. effort/smart-subsample", () => {
    expect(media).toContain('from "../../config/bild-encoder.json"');
    expect(media).toContain("quality: WEBP_QUALITY");
    expect(media).toContain("effort: WEBP_EFFORT");
    expect(media).toContain("smartSubsample: WEBP_SMART_SUBSAMPLE");
    expect(media).toContain("Q=${WEBP_QUALITY}");
    expect(media).toContain("effort=${WEBP_EFFORT}");
    expect(media).toContain("quality: AI_JPEG_QUALITY");
    expect(media).toContain("Q=${AI_JPEG_QUALITY}");
    // Kein hartcodiertes quality:80 / Q=80 mehr.
    expect(media).not.toMatch(/quality:\s*\d/);
    expect(media).not.toMatch(/Q=\d/);
  });

  it("Regenerier-Skript nutzt DIESELBE Konfiguration (kein zweiter Wahrheitsort)", () => {
    expect(regen).toContain("config/bild-encoder.json");
    expect(regen).not.toMatch(/quality:\s*\d/);
    expect(regen).not.toMatch(/Q=\d/);
    // Es wird beim Container-Start ausgeführt (JIT-Nachzug der Bestands-Uploads).
    expect(read("scripts/entry.sh")).toContain("regenerate-variants.mjs");
    // …und liegt im Runtime-Image (sonst liefe der Nachzug nie in Produktion).
    const containerfile = read("Containerfile");
    expect(containerfile).toContain("regenerate-variants.mjs");
    expect(containerfile).toMatch(/COPY --from=build \/app\/config \.\/config/);
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
