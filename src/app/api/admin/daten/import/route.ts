/**
 * Import-Upload: nimmt eine Export-ZIP entgegen und spielt die gewählten
 * Inhaltstypen als Kopien ein (bestehende Inhalte bleiben unangetastet).
 * Admin-geschützt + Same-Origin.
 *
 * Hinweis zur Uploadgröße: Der Reverse-Proxy (nginx) begrenzt die Größe per
 * `client_max_body_size`. Für große Sicherungen ggf. dort erhöhen
 * (siehe deploy/nginx.conf.example). Serverseitig gilt zusätzlich MAX_IMPORT_BYTES.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import { importBundle, type ImportOptions } from "@/lib/data-transfer/import";

// Reines JS-Entpacken im Speicher — großzügige Obergrenze gegen OOM.
const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let file: FormDataEntryValue | null;
  let options: ImportOptions;
  try {
    const form = await req.formData();
    file = form.get("datei");
    options = {
      recipes: form.get("recipes") === "1",
      travel: form.get("travel") === "1",
      pages: form.get("pages") === "1",
    };
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  if (!options.recipes && !options.travel && !options.pages) {
    return NextResponse.json({ error: "no_type" }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await importBundle(bytes, options, admin.id);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "server" },
      { status: 400 },
    );
  }
}
