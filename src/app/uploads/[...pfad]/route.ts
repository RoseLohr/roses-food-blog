/**
 * Liefert verarbeitete Bilder aus DATA_DIR/uploads aus.
 * Pfadschema: /uploads/<fileKey>/w<breite>.webp — Format strikt validiert
 * (isVariantFile: exakt w<3-4 Ziffern>.webp), kein Directory Traversal
 * möglich. Bewusst NICHT auf die heutige Erzeugungs-Leiter beschränkt:
 * Altbestands-Breiten (z. B. Original-Reencodes früherer Pipeline-Stände)
 * stehen in media_variant/srcset und müssen weiter ausliefern.
 *
 * Cache: `immutable` (1 Jahr) NUR, wenn der Regenerier-Marker des Bildes
 * (.encoder-rev) die aktuelle Encoder-Revision bestätigt — sonst kurzlebig,
 * damit während eines laufenden Nachzugs keine alten Bytes unter der neuen
 * ?v-URL für ein Jahr festgenagelt werden (uploadCacheControl, media-url.ts).
 * Der ?v-Query-String selbst wird hier bewusst ignoriert.
 */
import fs from "node:fs";
import path from "node:path";
import { uploadsDir } from "@/lib/media";
import { isVariantFile, uploadCacheControl } from "@/lib/media-url";

const KEY_RE = /^[a-f0-9]{20}$/;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pfad: string[] }> },
) {
  const { pfad } = await ctx.params;
  if (pfad.length !== 2 || !KEY_RE.test(pfad[0]) || !isVariantFile(pfad[1])) {
    return new Response("Nicht gefunden", { status: 404 });
  }
  const dir = path.join(uploadsDir(), pfad[0]);
  const file = path.join(dir, pfad[1]);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return new Response("Nicht gefunden", { status: 404 });
  }
  let marker: string | null = null;
  try {
    marker = fs.readFileSync(path.join(dir, ".encoder-rev"), "utf8");
  } catch {
    marker = null; // kein Marker → Bild (noch) nicht auf aktueller Revision
  }
  const stream = fs.createReadStream(file);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(stat.size),
      "Cache-Control": uploadCacheControl(marker),
    },
  });
}
