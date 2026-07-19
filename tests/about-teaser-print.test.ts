import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression (Fremd-Vendor-Panel gpt-5.6-sol, PR #29): Der mobile „Über mich"-
 * Teaser stand ohne `print:hidden` im Hauptstrang — bei Druckbreite < lg würde
 * er mitgedruckt, obwohl die Desktop-Seitenleiste (aside) print:hidden trägt.
 * Beide Darstellungen des Teasers müssen vom Druck ausgeschlossen sein.
 */
const page = fs.readFileSync(
  path.resolve(__dirname, "../src/app/(public)/page.tsx"),
  "utf8",
);

describe("Über-mich-Teaser wird nicht gedruckt (Sol-Befund #29)", () => {
  it("mobiler Teaser-Wrapper (lg:hidden) trägt print:hidden", () => {
    // Der lg:hidden-Wrapper um {aboutTeaser} muss zusätzlich print:hidden haben.
    const m = page.match(/<div className="([^"]*lg:hidden[^"]*)">\{aboutTeaser\}<\/div>/);
    expect(m, "lg:hidden-Wrapper um {aboutTeaser} nicht gefunden").not.toBeNull();
    expect(m![1]).toContain("print:hidden");
  });

  it("Desktop-Teaser steht in einer print:hidden-Seitenleiste", () => {
    // Die <aside> mit dem Desktop-Teaser (hidden lg:block) ist print:hidden.
    expect(page).toMatch(/<aside className="[^"]*print:hidden[^"]*">/);
  });
});
