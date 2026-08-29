/**
 * Die farbige Statusplakette (veröffentlicht/Entwurf, aktiv/pausiert,
 * versendet/läuft/geplant …). Der TON ist die einzige Entscheidung, die eine
 * Liste zu treffen hat; welche Farbwerte dazugehören, war bis 08/2026 sechsmal
 * beantwortet.
 *
 * LAG BIS 08/2026 UNTER `components/admin/` — und ist von dort weggezogen, als
 * die Entwurfs-Plakette auch im öffentlichen Bereich gebraucht wurde. Der
 * Ordner war nie eine Eigenschaft des Bausteins, sondern nur die Liste seiner
 * damaligen Aufrufer: keine Zustände, keine Hooks, kein `"use client"`, kein
 * Zugriff auf Admin-Daten. Ein öffentlicher Import aus `components/admin/`
 * hätte eine Schichtgrenze behauptet, die es nicht gibt.
 */
const TOENE = {
  gruen: "bg-green-100 text-green-900",
  gelb: "bg-amber-100 text-amber-900",
  blau: "bg-blue-100 text-blue-900",
  grau: "bg-gray-200 text-gray-700",
} as const;

export function Statuschip({
  ton,
  gross = false,
  children,
}: {
  ton: keyof typeof TOENE;
  /** Größere Plakette für Überschriften-Zeilen (Sequenzen). */
  gross?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`${TOENE[ton]} ${gross ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"}`}
    >
      {children}
    </span>
  );
}
