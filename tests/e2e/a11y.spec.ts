/**
 * A-22 — Runtime-Barrierefreiheit (WCAG 2.2 AA) mit axe-core gegen die
 * gerenderten Seiten. Ergänzt den statischen jsx-a11y-Gate.
 *
 * Stand der Dinge (ehrlich): Es gibt eine bekannte, dokumentierte Altlast —
 * der Marken-Akzent Teal (#339e92) erreicht als Text/kleine UI nur ~3,0–3,25:1
 * statt der geforderten 4,5:1 (Regel `color-contrast`). Das ist ein
 * Ein-Token-Fix (Akzent abdunkeln), aber eine MARKENENTSCHEIDUNG (in-command) —
 * siehe Residual R-CONTRAST in audit/06-residual-risk-register.md.
 *
 * Ratchet (S11): Der Test blockiert HART jede *neue* Art schwerer/kritischer
 * Verletzung; die bekannte `color-contrast`-Altlast ist die einzige geduldete
 * Ausnahme, bis die Palette-Entscheidung fällt. Sinkt die Altlast (Fix), wird
 * `color-contrast` aus ALTLAST entfernt — die Liste darf nur schrumpfen.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SEITEN = ["/", "/rezepte", "/reisen", "/saisonkalender", "/suche"];

// Einzige geduldete schwere Regel (dokumentierte Altlast R-CONTRAST). Nur kürzen.
// Kontrast-Altlast behoben (Akzent auf #277a70 abgedunkelt, WCAG-AA). Leer = strikt.
const ALTLAST = new Set<string>([]);

for (const pfad of SEITEN) {
  test(`A11y (keine NEUEN serious/critical) — ${pfad}`, async ({ page }) => {
    await page.goto(pfad, { waitUntil: "domcontentloaded" });
    const ergebnis = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const neu = ergebnis.violations.filter(
      (v) =>
        (v.impact === "serious" || v.impact === "critical") &&
        !ALTLAST.has(v.id),
    );
    if (neu.length) {
      const bericht = neu
        .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}×)`)
        .join("\n");
      throw new Error(`NEUE A11y-Verstöße auf ${pfad} (nicht in Altlast):\n${bericht}`);
    }
    expect(neu).toEqual([]);
  });
}
