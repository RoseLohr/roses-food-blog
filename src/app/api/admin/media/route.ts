/**
 * Bild-Upload direkt aus einem beliebigen Formular (Rezept, Reise, Startseite,
 * Zutat, Seite …). Admin-geschützt + Same-Origin. Nimmt multipart/form-data mit
 * Feld "datei" (+ optional "altText") und gibt die Bildinfos zurück, damit die
 * aufrufende Form das neue Bild sofort auswählen und als Vorschau zeigen kann.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import { imageUrl, storeImage } from "@/lib/media";

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let file: FormDataEntryValue | null;
  let altText = "";
  try {
    const form = await req.formData();
    file = form.get("datei");
    altText = String(form.get("altText") ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const img = await storeImage(buffer, file.name, altText);
    const smallest = img.variantWidths[0] ?? 320;
    return NextResponse.json({
      id: img.id,
      label: altText || file.name,
      fileKey: img.fileKey,
      width: img.width,
      height: img.height,
      variantWidths: img.variantWidths,
      thumbUrl: imageUrl(img.fileKey, smallest),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "server" },
      { status: 400 },
    );
  }
}
