/**
 * KI-Rezeptassistent (asynchron): POST startet einen Hintergrund-Job und
 * antwortet sofort mit einer Job-ID (kein Proxy-Timeout). GET liefert den
 * Status/das Ergebnis zum Pollen. Admin-geschützt + Same-Origin (POST).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import { getRecipeJob, startRecipeJob } from "@/lib/ai-recipe-jobs";

export const dynamic = "force-dynamic";

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
    return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
  }

  const jobId = startRecipeJob(body.text);
  return NextResponse.json({ jobId });
}

export async function GET(req: Request) {
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("job");
  if (!id) return NextResponse.json({ error: "missing_job" }, { status: 400 });

  const job = getRecipeJob(id);
  if (!job) {
    // Job unbekannt (Neustart oder abgelaufen) — als Fehler behandeln.
    return NextResponse.json({ status: "unknown" }, { status: 404 });
  }
  if (job.status === "done") {
    return NextResponse.json({ status: "done", draft: job.draft });
  }
  if (job.status === "error") {
    return NextResponse.json({ status: "error", error: job.error, code: job.code });
  }
  return NextResponse.json({ status: "running" });
}
