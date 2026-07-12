/**
 * Sofort-Anlage referenzierter Entitäten direkt aus einem Formular heraus
 * (Taxonomien, Interessen, Kontakt-Tags, Segmente, Zutaten). Admin-geschützt
 * und Same-Origin. Existiert der Name bereits, wird der vorhandene Eintrag
 * zurückgegeben (idempotent), damit die aufrufende Form ihn einfach auswählt.
 */
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import { slugify, uniqueSlug } from "@/lib/slug";
import { TAXONOMY_TABLES, isTaxonomyType } from "@/lib/taxonomies";

const bodySchema = z.object({
  kind: z.enum(["taxonomy", "interest", "contactTag", "segment", "ingredient"]),
  type: z.string().optional(), // bei kind="taxonomy": kategorie/schlagwort/...
  name: z.string().trim().min(1).max(120),
});

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const name = body.name.trim();

  // Vorhandenen Eintrag case-insensitiv finden -> zurückgeben (Auswahl im UI)
  const lower = name.toLowerCase();

  try {
    if (body.kind === "taxonomy") {
      if (!body.type || !isTaxonomyType(body.type)) {
        return NextResponse.json({ error: "invalid_type" }, { status: 400 });
      }
      const table = TAXONOMY_TABLES[body.type];
      const existing = await db
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(sql`lower(${table.name}) = ${lower}`)
        .limit(1);
      if (existing[0]) return NextResponse.json({ ...existing[0], existed: true });
      const slugs = new Set(
        (await db.select({ slug: table.slug }).from(table)).map((r) => r.slug),
      );
      const [row] = await db
        .insert(table)
        .values({ name, slug: uniqueSlug(slugify(name), (s) => slugs.has(s)) })
        .returning({ id: table.id, name: table.name });
      return NextResponse.json(row);
    }

    if (body.kind === "ingredient") {
      const existing = await db
        .select({ id: schema.ingredient.id, name: schema.ingredient.name })
        .from(schema.ingredient)
        .where(sql`lower(${schema.ingredient.name}) = ${lower}`)
        .limit(1);
      if (existing[0]) return NextResponse.json({ ...existing[0], existed: true });
      const slugs = new Set(
        (await db.select({ slug: schema.ingredient.slug }).from(schema.ingredient)).map(
          (r) => r.slug,
        ),
      );
      const [row] = await db
        .insert(schema.ingredient)
        .values({ name, slug: uniqueSlug(slugify(name), (s) => slugs.has(s)) })
        .returning({ id: schema.ingredient.id, name: schema.ingredient.name });
      return NextResponse.json(row);
    }

    // Reine Namens-Entitäten (unique name)
    const table =
      body.kind === "interest"
        ? schema.interest
        : body.kind === "contactTag"
          ? schema.contactTag
          : schema.segment;

    const existing = await db
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(sql`lower(${table.name}) = ${lower}`)
      .limit(1);
    if (existing[0]) return NextResponse.json({ ...existing[0], existed: true });

    const values =
      body.kind === "segment"
        ? { name, ruleInterestIds: "[]", createdAt: new Date() }
        : { name };
    const [row] = await db
      .insert(table)
      .values(values as never)
      .returning({ id: table.id, name: table.name });
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
