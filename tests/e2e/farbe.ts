import type { Locator, Page } from "@playwright/test";

/**
 * Farbmessung im echten Browser — gemeinsam für alle Specs, die über eine
 * FLÄCHE etwas zusichern.
 *
 * ── WARUM NICHT `getComputedStyle` ALLEIN ──────────────────────────────────
 *
 * `getComputedStyle` liefert die gerechnete Farbe der DEKLARATION, nie die
 * über den Untergrund gerechnete. Bei einer Alpha-Utility (`bg-leaf/30`) oder
 * einem `color-mix` serialisiert Chromium außerdem im Interpolationsraum
 * (`oklab(… / 0.3)`); ein Regex über die Ziffern läse davon Bruchstücke des
 * L-/a-/b-Werts statt eines RGB-Tripels. Deshalb wird der Wert IM BROWSER
 * über einen Canvas auf seinen tatsächlichen Untergrund gelegt — heraus kommt,
 * was der Bildpunkt zeigt. Genau so rechnet auch der Browser beim Malen.
 *
 * Lag bis 10/2026 in `zubereitung-flaeche.spec.ts`. Weggezogen, als der zweite
 * Spec dieselbe Messung brauchte (Notizzettel) — abgeschrieben wäre sie an
 * zwei Stellen gepflegt worden, und die Duplikationsschranke zählt mit.
 */
export type RGB = [number, number, number];

/** WCAG-Relativluminanz. */
export function luminanz([r, g, b]: RGB): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Kontrastverhältnis nach WCAG 2.x. */
export function kontrast(a: RGB, b: RGB): number {
  const [x, y] = [luminanz(a), luminanz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Für Fehlermeldungen: die Farbe lesbar machen. */
export const alsText = (c: RGB) => `rgb(${c.join(" ")})`;

/** Eine Farbangabe im Browser auflösen und über einen Grund legen. */
async function ueberlagern(page: Page, eigen: string, grund: string): Promise<RGB> {
  return page.evaluate(([e, g]) => {
    const c = document.createElement("canvas").getContext("2d");
    if (!c) throw new Error("kein 2d-Kontext");
    c.fillStyle = g;
    c.fillRect(0, 0, 1, 1);
    c.fillStyle = e;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]] as [number, number, number];
  }, [eigen, grund] as const);
}

/**
 * Die Farbe, die ein Element tatsächlich ZEIGT: seine (womöglich
 * durchsichtige) Deklaration, über den nächsten gemalten Untergrund gelegt.
 */
export async function gemalt(
  page: Page,
  wahl: string | Locator,
  eigenschaft: "background-color" | "border-bottom-color" | "border-top-color" | "color",
): Promise<RGB> {
  const ort = typeof wahl === "string" ? page.locator(wahl).first() : wahl.first();
  const [eigen, grund] = await ort.evaluate((el, e) => {
    /** Der nächste Vorfahr (einschließlich el), der wirklich eine Fläche malt. */
    function untergrund(start: Element): string {
      let k: Element | null = start;
      while (k) {
        const bg = getComputedStyle(k).backgroundColor;
        if (bg && bg !== "transparent" && !/,\s*0\s*\)$/.test(bg)) return bg;
        k = k.parentElement;
      }
      return "rgb(255, 255, 255)";
    }
    const wert = getComputedStyle(el).getPropertyValue(e);
    const unter =
      e === "background-color" ? untergrund(el.parentElement ?? el) : untergrund(el);
    return [wert, unter];
  }, eigenschaft);

  return ueberlagern(page, eigen, grund);
}

/**
 * Ein benannter Token, wie er in der Umgebung des Elements gilt — aufgelöst
 * zum echten sRGB-Tripel. Für Farben, die nicht als Fläche eines Elements
 * dastehen (z. B. der Fokusring, den `outline` erst beim Fokus zeichnet).
 */
export async function tokenFarbe(
  page: Page,
  wahl: Locator,
  token: string,
): Promise<RGB> {
  const wert = await wahl
    .first()
    .evaluate((el, t) => getComputedStyle(el).getPropertyValue(t).trim(), token);
  return ueberlagern(page, wert, "rgb(255, 255, 255)");
}
