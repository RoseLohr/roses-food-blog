/**
 * Export-Download: baut eine ZIP mit Inhalten (Rezepte/Reisen/Seiten) und den
 * zugehörigen Fotos und liefert sie als Datei-Download aus. Admin-geschützt.
 *
 * GET, weil es ein reiner Lese-/Download-Vorgang ist (kein Zustandswechsel).
 * Die Antwort ist per Same-Origin-Policy (CORS) für fremde Seiten ohnehin
 * nicht auslesbar; ein gültiges Admin-Cookie ist erforderlich.
 */
import { getCurrentAdmin } from "@/lib/auth";
import {
  collectExport,
  type ExportSelection,
} from "@/lib/data-transfer/export";
import { buildExportZip } from "@/lib/data-transfer/zip";

/**
 * Auswahl aus den Query-Parametern lesen. Neu: Mehrfachauswahl per Checkboxen
 * (`typ=recipes&typ=travel&typ=pages`). Rückwärtskompatibel: der alte einzelne
 * `scope`-Parameter (all/recipes/travel/pages) wird weiterhin akzeptiert.
 * Ist nichts angegeben, wird alles exportiert (sichere Voreinstellung für ein
 * Backup).
 */
function parseSelection(params: URLSearchParams): ExportSelection {
  const typ = params.getAll("typ");
  if (typ.length > 0) {
    return {
      recipes: typ.includes("recipes"),
      travel: typ.includes("travel"),
      pages: typ.includes("pages"),
    };
  }
  const scope = params.get("scope");
  if (scope === "recipes" || scope === "travel" || scope === "pages") {
    return {
      recipes: scope === "recipes",
      travel: scope === "travel",
      pages: scope === "pages",
    };
  }
  return { recipes: true, travel: true, pages: true };
}

function scopeLabel(sel: ExportSelection): string {
  const parts = [
    sel.recipes && "rezepte",
    sel.travel && "reisen",
    sel.pages && "seiten",
  ].filter(Boolean) as string[];
  return parts.length === 3 ? "alles" : parts.join("-") || "leer";
}

export async function GET(req: Request) {
  if (!(await getCurrentAdmin())) {
    return new Response("unauthorized", { status: 401 });
  }

  let selection = parseSelection(new URL(req.url).searchParams);
  // Keine gültige Auswahl (z. B. alle Häkchen entfernt) → alles sichern.
  if (!selection.recipes && !selection.travel && !selection.pages) {
    selection = { recipes: true, travel: true, pages: true };
  }
  const bundle = await collectExport(selection);
  const zip = buildExportZip(bundle);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `roses-blog-export-${scopeLabel(selection)}-${stamp}.zip`;

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
