/**
 * Segmente: manuelle Zuordnung (contact_segment) PLUS regelbasierte
 * Zuordnung über Interessen (segment_rule_interest, relational).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

/** Interessen-IDs der Regel eines Segments. */
export async function ruleInterestIdsForSegment(
  segmentId: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: schema.segmentRuleInterest.interestId })
    .from(schema.segmentRuleInterest)
    .where(eq(schema.segmentRuleInterest.segmentId, segmentId));
  return rows.map((r) => r.id);
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

  // Regelbasiert: Kontakte mit einem der Regel-Interessen (ein Join).
  const byRule = await db
    .select({ id: schema.contactInterest.contactId })
    .from(schema.segmentRuleInterest)
    .innerJoin(
      schema.contactInterest,
      eq(schema.contactInterest.interestId, schema.segmentRuleInterest.interestId),
    )
    .where(eq(schema.segmentRuleInterest.segmentId, segmentId));

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
