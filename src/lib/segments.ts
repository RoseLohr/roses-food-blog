/**
 * Segmente: manuelle Zuordnung (contact_segment) PLUS regelbasierte
 * Zuordnung über Interessen (segment.ruleInterestIds, Annahme im Schema).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

export function parseRuleInterestIds(raw: string): number[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((n) => Number.isInteger(n) && n > 0)
      : [];
  } catch {
    return [];
  }
}

/** Alle Kontakt-IDs eines Segments (manuell ∪ regelbasiert), alle Status. */
export async function contactIdsForSegment(segmentId: number): Promise<number[]> {
  const [segment] = await db
    .select()
    .from(schema.segment)
    .where(eq(schema.segment.id, segmentId));
  if (!segment) return [];

  const manual = await db
    .select({ id: schema.contactSegment.contactId })
    .from(schema.contactSegment)
    .where(eq(schema.contactSegment.segmentId, segmentId));

  const ruleIds = parseRuleInterestIds(segment.ruleInterestIds);
  const byRule = ruleIds.length
    ? await db
        .select({ id: schema.contactInterest.contactId })
        .from(schema.contactInterest)
        .where(inArray(schema.contactInterest.interestId, ruleIds))
    : [];

  return [...new Set([...manual.map((r) => r.id), ...byRule.map((r) => r.id)])];
}

/** Nur aktive (bestätigte, nicht abgemeldete) Kontakte — für den Versand. */
export async function activeContactsForSegment(segmentId: number) {
  const ids = await contactIdsForSegment(segmentId);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(schema.contact)
    .where(and(inArray(schema.contact.id, ids), eq(schema.contact.status, "aktiv")));
}
