/**
 * KI-Rezeptassistent: nimmt einen Ausgangstext entgegen und liefert einen
 * vollständigen Rezeptentwurf (JSON) zurück. Admin-geschützt + Same-Origin.
 * Legt selbst nichts an — das Übernehmen/Speichern passiert im Editor.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import { AI_NO_KEY, generateRecipeDraft } from "@/lib/ai-recipe";

const bodySchema = z.object({ text: z.string().trim().min(1).max(20000) });

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

  try {
    const draft = await generateRecipeDraft(body.text);
    return NextResponse.json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "server";
    const status = message === AI_NO_KEY ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
