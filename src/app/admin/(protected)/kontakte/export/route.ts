/**
 * CSV-Export der Kontakte (DSGVO/Betrieb). Respektiert dieselben Filter
 * wie die Kontaktliste (status, interesse, segment, tag).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentAdmin } from "@/lib/auth";
import { contactsToCsv } from "@/lib/contacts";
import { contactIdsForSegment } from "@/lib/segments";

export async function GET(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return new Response("Nicht angemeldet", { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const interestId = Number(url.searchParams.get("interesse")) || null;
  const segmentId = Number(url.searchParams.get("segment")) || null;
  const tagId = Number(url.searchParams.get("tag")) || null;

  let idFilter: number[] | null = null;
  const restrict = (ids: number[]) => {
    const set = new Set(ids);
    idFilter = idFilter === null ? ids : idFilter.filter((x) => set.has(x));
  };
  if (interestId) {
    const rows = await db
      .select({ id: schema.contactInterest.contactId })
      .from(schema.contactInterest)
      .where(eq(schema.contactInterest.interestId, interestId));
    restrict(rows.map((r) => r.id));
  }
  if (segmentId) restrict(await contactIdsForSegment(segmentId));
  if (tagId) {
    const rows = await db
      .select({ id: schema.contactTagAssign.contactId })
      .from(schema.contactTagAssign)
      .where(eq(schema.contactTagAssign.tagId, tagId));
    restrict(rows.map((r) => r.id));
  }

  const conditions = [];
  if (status && ["unbestaetigt", "aktiv", "abgemeldet"].includes(status)) {
    conditions.push(eq(schema.contact.status, status as "aktiv"));
  }
  if (idFilter !== null) {
    conditions.push(
      (idFilter as number[]).length
        ? inArray(schema.contact.id, idFilter)
        : eq(schema.contact.id, -1),
    );
  }

  const contacts = await db
    .select()
    .from(schema.contact)
    .where(conditions.length ? and(...conditions) : undefined);

  const interestRows = contacts.length
    ? await db
        .select({
          contactId: schema.contactInterest.contactId,
          name: schema.interest.name,
        })
        .from(schema.contactInterest)
        .innerJoin(
          schema.interest,
          eq(schema.contactInterest.interestId, schema.interest.id),
        )
        .where(
          inArray(
            schema.contactInterest.contactId,
            contacts.map((c) => c.id),
          ),
        )
    : [];

  const csv = contactsToCsv(
    contacts.map((c) => ({
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      status: c.status,
      source: c.source,
      signupAt: c.signupAt,
      consentAt: c.consentAt,
      lastContactAt: c.lastContactAt,
      interests: interestRows
        .filter((r) => r.contactId === c.id)
        .map((r) => r.name)
        .join(", "),
    })),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kontakte-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
