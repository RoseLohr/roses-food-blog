/**
 * Inhalts-Blöcke der Reiseberichte: Der Inhalt ist eine geordnete Folge aus
 * Text- (Markdown), Bild- und Restaurant-Blöcken (Block-Editor im Admin).
 *
 * Gespeichert relational in travel_block (eine Zeile je Block). Dieses Modul
 * definiert nur noch den Editor-JSON-Vertrag (Restaurant-Blöcke referenzieren
 * dort den INDEX in der Restaurant-Liste; beim Speichern wird daraus die
 * restaurant_id) sowie die Markdown-Zusammenfassung der Textblöcke, die als
 * travel_post.search_text die FTS-Quelle bildet.
 */
import { z } from "zod";

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), markdown: z.string().max(20000) }),
  z.object({
    type: z.literal("bild"),
    imageId: z.number().int().positive(),
    /**
     * Die Gruppe, zu der dieses Bild gehört — oder `null` für ein Einzelbild.
     *
     * ── WARUM EINE MARKE UND KEIN „MIT DEM VORHERIGEN" ────────────────────
     *
     * Hier stand bis 08/2026 `mitVorherigem`, und daran zerbrach die
     * Anordnung reihenweise: Das war ein Feld AM BLOCK, das eine Aussage über
     * seinen NACHBARN machte. Ein Block dazwischen, ein Umsortieren, ein
     * gelöschtes Foto — und die Aussage stimmte nicht mehr, ohne dass jemand
     * etwas gesagt hätte.
     *
     * `gruppe` ist etwas anderes: eine MARKE, die das Bild über sich selbst
     * trägt. Zwei Bilder gehören zusammen, weil beide dieselbe Marke tragen —
     * symmetrisch, und keines behauptet etwas über das andere. Verschwindet
     * der Nachbar, bleibt die eigene Marke richtig; sie beschreibt dann eben
     * eine Gruppe aus einem Bild.
     *
     * Gerendert wird ein ununterbrochener Lauf gleicher Marke als EINE Gruppe
     * (erstes Bild volle Breite, alle weiteren in einer Reihe darunter).
     * Werden zwei gleich markierte Bilder auseinandergezogen, entstehen zwei
     * Gruppen — kein Bruch, nur zwei Läufe.
     */
    gruppe: z.number().int().positive().nullable().default(null),
    /**
     * Nur für Bilder OHNE Gruppe: Breite als Anteil der Inhaltsspalte
     * (s = 1/3, m = 1/2, l = 2/3) und die Seite, an der es steht. Der Text
     * läuft darum herum.
     *
     * Dass diese beiden Regler NUR am Einzelbild etwas bedeuten, ist keine
     * Konvention, sondern erzwungen: Der Vertrag unten weist sie zurück,
     * sobald `gruppe` gesetzt ist, und die Datenbank ebenso
     * (`travel_block_bild_regler_check`). Ein Bild in einer Gruppe kann also
     * gar keine widersprüchliche Angabe tragen — die Anordnung der Gruppe
     * folgt allein aus der Position darin.
     */
    groesse: z.enum(["s", "m", "l"]).nullable().default(null),
    ausrichtung: z.enum(["links", "rechts"]).nullable().default(null),
  }),
  z.object({
    type: z.literal("restaurant"),
    /** Index des Restaurants in der Editor-Liste (= sortOrder) */
    index: z.number().int().nonnegative(),
  }),
]);
/**
 * Ein Bild trägt ENTWEDER eine Gruppe ODER die beiden Einzelbild-Regler.
 *
 * Beides zugleich wäre ein Widerspruch: Innerhalb einer Gruppe bestimmt die
 * Position die Anordnung, eine Größe daneben wäre eine zweite, unwirksame
 * Wahrheit. Genau solche stillen Widersprüche haben die alte Fassung
 * unbrauchbar gemacht — deshalb kommt so ein Block hier gar nicht erst durch.
 */
const bildRegelnStimmig = blockSchema.refine(
  (b) =>
    b.type !== "bild" ||
    b.gruppe === null ||
    (b.groesse === null && b.ausrichtung === null),
  {
    message:
      "Ein Bild in einer Gruppe darf keine Größe und keine Ausrichtung tragen — " +
      "innerhalb der Gruppe bestimmt die Position die Anordnung.",
  },
);

export const travelBlocksSchema = z.array(bildRegelnStimmig).max(200);
export type TravelBlock = z.infer<typeof blockSchema>;

/** Ein Bildblock — die Form, mit der Renderer und Editor rechnen. */
export type Bildblock = Extract<TravelBlock, { type: "bild" }>;

/** Markdown aller Textblöcke — Quelle für travel_post.search_text (FTS). */
export function blocksToMarkdown(blocks: TravelBlock[]): string {
  return blocks
    .filter((b): b is Extract<TravelBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.markdown.trim())
    .filter(Boolean)
    .join("\n\n");
}
