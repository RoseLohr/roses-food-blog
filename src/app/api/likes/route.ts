/**
 * Like-API: anonymes Liken ohne Konto (Akzeptanzkriterium 4).
 * Dedup best effort über SHA-256(clientId + recipeId); die Client-ID ist
 * eine zufällige UUID aus localStorage — keine personenbezogenen Daten.
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { isSameOriginRequest } from "@/lib/csrf";
import { rateLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/request";

const bodySchema = z.object({
  recipeId: z.number().int().positive(),
  clientId: z.string().min(8).max(64),
});

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ip = await getClientIp();
  if (!rateLimit(`like:${ip}`, 30, 60_000).ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const [recipe] = await db
    .select({ id: schema.recipe.id })
    .from(schema.recipe)
    .where(eq(schema.recipe.id, body.recipeId));
  if (!recipe) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const dedupHash = crypto
    .createHash("sha256")
    .update(`${body.clientId}:${body.recipeId}`)
    .digest("hex");

  await db
    .insert(schema.like)
    .values({ recipeId: body.recipeId, dedupHash, createdAt: new Date() })
    .onConflictDoNothing();

  // Zähler-Cache aktualisieren (Quelle der Wahrheit: Tabelle like)
  const [likes] = await db
    .select({ n: count() })
    .from(schema.like)
    .where(eq(schema.like.recipeId, body.recipeId));
  await db
    .update(schema.recipe)
    .set({ likeCount: likes.n })
    .where(eq(schema.recipe.id, body.recipeId));

  return NextResponse.json({ likeCount: likes.n, liked: true });
}
