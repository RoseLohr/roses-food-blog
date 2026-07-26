/**
 * Liefert verarbeitete Bilder aus DATA_DIR/uploads aus.
 * Pfadschema: /uploads/<fileKey>/w<breite>.webp — strikt validiert
 * (nur Breiten der konfigurierten Leiter, config/bild-encoder.json),
 * kein Directory Traversal möglich. Lange Cache-Zeiten sind sicher:
 * neue Uploads bekommen einen neuen fileKey, und regenerierte Varianten
 * busten über die ?v=rev-Kennung in den Bild-URLs (media-url.ts) —
 * der Query-String wird hier bewusst ignoriert.
 */
import fs from "node:fs";
import path from "node:path";
import { uploadsDir } from "@/lib/media";
import { isVariantFile } from "@/lib/media-url";

const KEY_RE = /^[a-f0-9]{20}$/;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pfad: string[] }> },
) {
  const { pfad } = await ctx.params;
  if (pfad.length !== 2 || !KEY_RE.test(pfad[0]) || !isVariantFile(pfad[1])) {
    return new Response("Nicht gefunden", { status: 404 });
  }
  const file = path.join(uploadsDir(), pfad[0], pfad[1]);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return new Response("Nicht gefunden", { status: 404 });
  }
  const stream = fs.createReadStream(file);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
