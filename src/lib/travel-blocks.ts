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
  z.object({ type: z.literal("bild"), imageId: z.number().int().positive() }),
  z.object({
    type: z.literal("restaurant"),
    /** Index des Restaurants in der Editor-Liste (= sortOrder) */
    index: z.number().int().nonnegative(),
  }),
]);
export const travelBlocksSchema = z.array(blockSchema).max(200);
export type TravelBlock = z.infer<typeof blockSchema>;

/** Markdown aller Textblöcke — Quelle für travel_post.search_text (FTS). */
export function blocksToMarkdown(blocks: TravelBlock[]): string {
  return blocks
    .filter((b): b is Extract<TravelBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.markdown.trim())
    .filter(Boolean)
    .join("\n\n");
}
