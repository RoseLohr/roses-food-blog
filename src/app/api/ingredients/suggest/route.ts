/**
 * Zutaten-Vorschläge für die Autovervollständigung in der Suche.
 * Öffentlich (nur Zutatennamen, keine sensiblen Daten). Ab 2 Zeichen.
 */
import { NextResponse } from "next/server";
import { asc, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ items: [] });

  const rows = await db
    .select({
      slug: schema.ingredient.slug,
      name: schema.ingredient.name,
    })
    .from(schema.ingredient)
    .where(sql`lower(${schema.ingredient.name}) LIKE ${"%" + q + "%"}`)
    .orderBy(asc(schema.ingredient.name))
    .limit(10);

  return NextResponse.json({ items: rows });
}
