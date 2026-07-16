/**
 * Inhalts-Blöcke der Reiseberichte: Der Inhalt ist eine geordnete Folge aus
 * Text- (Markdown), Bild- und Restaurant-Blöcken (Block-Editor im Admin).
 *
 * Gespeichert als JSON in travel_post.content_blocks. Parallel wird
 * travel_post.content weiterhin mit dem zusammengefügten Markdown der
 * Textblöcke befüllt — dadurch funktionieren Volltextsuche (FTS) und ältere
 * Konsumenten unverändert. Ein leeres content_blocks bedeutet Altbestand:
 * dann gilt content als ein einzelner Textblock.
 */
import { z } from "zod";

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), markdown: z.string().max(20000) }),
  z.object({ type: z.literal("bild"), imageId: z.number().int().positive() }),
  z.object({
    type: z.literal("restaurant"),
    /** Index des Restaurants (= sortOrder nach dem Speichern) */
    index: z.number().int().nonnegative(),
  }),
]);
export const travelBlocksSchema = z.array(blockSchema).max(200);
export type TravelBlock = z.infer<typeof blockSchema>;

/** JSON → Blöcke; ungültiges/leeres JSON ergibt []. */
export function parseTravelBlocks(json: string | null | undefined): TravelBlock[] {
  if (!json) return [];
  try {
    return travelBlocksSchema.parse(JSON.parse(json));
  } catch {
    return [];
  }
}

/**
 * Effektive Blockfolge eines Beitrags: gespeicherte Blöcke oder — für
 * Altbestand ohne content_blocks — der bisherige Inhalt als ein Textblock.
 */
export function effectiveBlocks(post: {
  content: string;
  contentBlocks: string;
}): TravelBlock[] {
  const parsed = parseTravelBlocks(post.contentBlocks);
  if (parsed.length) return parsed;
  return post.content ? [{ type: "text", markdown: post.content }] : [];
}

/** Markdown aller Textblöcke (für FTS/Suche/Export-Kompatibilität). */
export function blocksToMarkdown(blocks: TravelBlock[]): string {
  return blocks
    .filter((b): b is Extract<TravelBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.markdown.trim())
    .filter(Boolean)
    .join("\n\n");
}
