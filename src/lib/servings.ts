/**
 * Portionsrechner: Mengen skalieren und „küchentauglich" runden
 * (Annahme B4). Wird serverseitig (SSR-Anzeige) und clientseitig
 * (Portions-Umschalter) identisch genutzt.
 */

/** Einheiten, die in Brüchen angegeben werden (Stück-artige Einheiten) */
export const FRACTION_UNITS = new Set([
  "",
  "stück",
  "el",
  "tl",
  "prise",
  "prisen",
  "zehe",
  "zehen",
  "bund",
  "dose",
  "dosen",
  "packung",
  "päckchen",
  "scheibe",
  "scheiben",
  "tasse",
  "tassen",
  "blatt",
  "zweig",
  "zweige",
]);

/** Große metrische Einheiten mit Dezimaldarstellung */
const DECIMAL_UNITS = new Set(["kg", "l"]);

const FRACTIONS: Array<[number, string]> = [
  [0, ""],
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
  [1, ""],
];

export function scaleAmount(
  amount: number,
  baseServings: number,
  targetServings: number,
): number {
  if (baseServings <= 0) return amount;
  return (amount * targetServings) / baseServings;
}

function formatGermanNumber(value: number): string {
  return value
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
    .replace(".", ",");
}

/** Bruch-Rundung: nächster „schöner" Bruch (¼, ⅓, ½, ⅔, ¾) */
function formatFraction(value: number): string {
  const whole = Math.floor(value);
  const frac = value - whole;
  let best = FRACTIONS[0];
  let bestDist = Infinity;
  for (const f of FRACTIONS) {
    const d = Math.abs(frac - f[0]);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  let w = whole;
  let symbol = best[1];
  if (best[0] === 1) {
    w += 1;
    symbol = "";
  }
  if (w === 0 && symbol === "") {
    // Nicht auf 0 runden: kleinste sinnvolle Angabe
    return "¼";
  }
  if (w === 0) return symbol;
  return symbol ? `${w}${symbol}` : String(w);
}

/**
 * Menge küchentauglich formatieren (ohne Einheit).
 * - Bruch-Einheiten (Stück, EL, ...): schöne Brüche
 * - kg/l: bis 2 Dezimalstellen (deutsches Komma)
 * - g/ml u. a.: < 10 → 1 Dezimalstelle, 10–100 → ganzzahlig, > 100 → auf 5 gerundet
 */
export function formatAmount(value: number, unit: string): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const u = unit.trim().toLowerCase();

  if (FRACTION_UNITS.has(u)) return formatFraction(value);
  if (DECIMAL_UNITS.has(u)) return formatGermanNumber(Math.round(value * 100) / 100);

  if (value < 10) {
    return formatGermanNumber(Math.max(0.1, Math.round(value * 10) / 10));
  }
  if (value <= 100) return String(Math.round(value));
  return String(Math.round(value / 5) * 5);
}

/** Skalieren + Formatieren in einem Schritt (für UI-Anzeige). */
export function scaledDisplay(
  amount: number | null,
  unit: string,
  baseServings: number,
  targetServings: number,
): string {
  if (amount === null) return "";
  return formatAmount(scaleAmount(amount, baseServings, targetServings), unit);
}
