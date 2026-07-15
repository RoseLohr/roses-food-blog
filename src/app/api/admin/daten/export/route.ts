/**
 * Export-Download: baut eine ZIP mit Inhalten (Rezepte/Reisen/Seiten) und den
 * zugehörigen Fotos und liefert sie als Datei-Download aus. Admin-geschützt.
 *
 * GET, weil es ein reiner Lese-/Download-Vorgang ist (kein Zustandswechsel).
 * Die Antwort ist per Same-Origin-Policy (CORS) für fremde Seiten ohnehin
 * nicht auslesbar; ein gültiges Admin-Cookie ist erforderlich.
 */
import { getCurrentAdmin } from "@/lib/auth";
import { collectExport } from "@/lib/data-transfer/export";
import { buildExportZip } from "@/lib/data-transfer/zip";
import type { ExportScope } from "@/lib/data-transfer/types";

function parseScope(v: string | null): ExportScope {
  return v === "recipes" || v === "travel" || v === "pages" ? v : "all";
}

export async function GET(req: Request) {
  if (!(await getCurrentAdmin())) {
    return new Response("unauthorized", { status: 401 });
  }

  const scope = parseScope(new URL(req.url).searchParams.get("scope"));
  const bundle = await collectExport(scope);
  const zip = buildExportZip(bundle);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `roses-blog-export-${scope}-${stamp}.zip`;

  // Uint8Array in einen frischen ArrayBuffer kopieren (BodyInit-kompatibel).
  const body = new Uint8Array(zip);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
