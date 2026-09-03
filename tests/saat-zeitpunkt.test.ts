/**
 * Die Saat darf nicht vom Kalender abhängen.
 *
 * Schreibt sie `new Date()` in ihre Zeitstempel, hängt jede
 * Admin-Referenzaufnahme am Tag des Laufs: Der Medien-Admin zeigt
 * „Hochgeladen am <Datum>", die Maske darüber hat die Größe der ELEMENT-BOX,
 * und die folgt dem Text. Ein schmaleres Datum lässt die Zeile nicht mehr
 * umbrechen — die Kachel wird niedriger und alles darunter verschiebt sich.
 * Genau so wurden drei Aufnahmen rot, ohne dass jemand etwas geändert hatte.
 *
 * Der Test liest den QUELLTEXT statt den Wert: `NOW` ist nicht exportiert,
 * und ein Vergleich gegen einen erwarteten Zeitpunkt würde bei jeder
 * Datumsänderung mitgepflegt werden müssen, ohne mehr zu messen. Was hier
 * zählt, ist die Abwesenheit der Kalender-Abhängigkeit.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const QUELLE = path.join(process.cwd(), "scripts/seed.ts");

function codeZeilen(): string[] {
  const roh = fs.readFileSync(QUELLE, "utf8");
  // Blockkommentare entfernen — dort steht `new Date()` als Zitat der
  // Vorgeschichte, und ein Test, der über Kommentare stolpert, zwingt zur
  // Selbstzensur in der Begründung.
  return roh
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((z) => !z.trim().startsWith("//"));
}

describe("Saat-Zeitpunkt", () => {
  it("die Saat nimmt keinen Wanduhr-Zeitpunkt", () => {
    const treffer = codeZeilen()
      .map((z, i) => ({ z: z.trim(), nr: i + 1 }))
      .filter(({ z }) => /new Date\(\s*\)/.test(z) || /Date\.now\(\s*\)/.test(z));
    expect(
      treffer.map((t) => `${t.nr}: ${t.z}`),
      "scripts/seed.ts darf keinen Wanduhr-Zeitpunkt nehmen — sonst hängen " +
        "die Admin-Referenzaufnahmen am Tag des Laufs statt an den Daten.",
    ).toEqual([]);
  });

  it("und setzt stattdessen einen festen Zeitpunkt", () => {
    // Die Gegenprobe: Ohne sie bliebe der Test oben auch dann grün, wenn
    // jemand `NOW` ersatzlos striche und die Zeitstempel ganz wegfielen.
    const code = codeZeilen().join("\n");
    expect(
      code,
      "erwartet wird ein fest verdrahteter Zeitpunkt, z. B. " +
        'new Date("2026-01-15T12:00:00")',
    ).toMatch(/const NOW = new Date\(\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"\s*\)/);
  });
});
