/**
 * Liefert verarbeitete Bilder aus DATA_DIR/uploads aus.
 * Pfadschema: /uploads/<fileKey>/w<breite>.webp — strikt validiert,
 * kein Directory Traversal möglich. Lange Cache-Zeiten, da Dateien
 * unveränderlich sind (neue Uploads = neuer fileKey).
 */
import fs from "node:fs";
import path from "node:path";
import { uploadsDir } from "@/lib/media";

const KEY_RE = /^[a-f0-9]{20}$/;
const FILE_RE = /^w\d{3,4}\.webp$/;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pfad: string[] }> },
) {
  const { pfad } = await ctx.params;
  if (pfad.length !== 2 || !KEY_RE.test(pfad[0]) || !FILE_RE.test(pfad[1])) {
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
