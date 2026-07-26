/**
 * KI-Rezeptassistent (asynchron): POST startet einen Hintergrund-Job und
 * antwortet sofort mit einer Job-ID (kein Proxy-Timeout). GET liefert den
 * Status/das Ergebnis zum Pollen. Admin-geschützt + Same-Origin (POST).
 *
 * Eingabe ist multipart/form-data: Feld "text" (optional, max. 20.000 Zeichen)
 * plus 0–N Foto-Felder "fotos" (abfotografierte Rezeptseiten). Mindestens
 * eines von beidem muss vorhanden sein. Fotos werden serverseitig per echter
 * Bildprobe validiert und verkleinert (lib/media.ts), bevor sie als Bild-Blöcke
 * an das Modell gehen — sie werden nirgends gespeichert.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import { getRecipeJob, startRecipeJob } from "@/lib/ai-recipe-jobs";
import { prepareAiImage } from "@/lib/media";
import {
  AI_IMAGE_MB,
  AI_TOTAL_MB,
  MAX_AI_IMAGES,
  checkAiImageSelection,
  formTextValue,
  type AiImageIssue,
} from "@/lib/ai-recipe-images";
import { t } from "@/i18n/de";

export const dynamic = "force-dynamic";

const a = t().admin.aiRecipe;

function issueMessage(issue: AiImageIssue): string {
  switch (issue.code) {
    case "zu_viele":
      return a.photosTooMany(MAX_AI_IMAGES);
    case "zu_gross":
      return a.photoTooLarge(issue.name, AI_IMAGE_MB);
    case "gesamt":
      return a.photosTotalTooLarge(AI_TOTAL_MB);
    case "format":
      return a.photoBadType(issue.name);
  }
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
  }
  // Typsicher: ein als „text" hochgeladenes File zählt NICHT als Text
  // (String(file) wäre "[object File]" und passierte das Pflichtinput-Gate).
  const text = formTextValue(form.get("text"));
  const files = form
    .getAll("fotos")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if ((text.length === 0 && files.length === 0) || text.length > 20000) {
    return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
  }

  // Mengen-/Größen-Caps (unbounded_consumption): dieselben Grenzen wie im
  // Editor. MIME-Typ des Clients wird hier NICHT geprüft — das entscheidet
  // gleich die echte Bildprobe in prepareAiImage.
  const issue = checkAiImageSelection(
    files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    { trustType: false },
  );
  if (issue) {
    return NextResponse.json({ error: issueMessage(issue) }, { status: 400 });
  }

  const prepared = [];
  try {
    // Sequenziell (nicht parallel): schont CPU/RAM des kleinen Servers, und
    // der erste kaputte Anhang beendet die Verarbeitung mit klarer Meldung.
    for (const f of files) {
      prepared.push(await prepareAiImage(Buffer.from(await f.arrayBuffer())));
    }
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Foto konnte nicht verarbeitet werden.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const jobId = startRecipeJob({ text, images: prepared });
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
