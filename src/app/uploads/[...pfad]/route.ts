/**
 * Liefert verarbeitete Bilder aus DATA_DIR/uploads aus.
 * Pfadschema: /uploads/<fileKey>/w<breite>.webp — Format strikt validiert
 * (isVariantFile: exakt w<3-4 Ziffern>.webp), kein Directory Traversal
 * möglich. Bewusst NICHT auf die heutige Erzeugungs-Leiter beschränkt:
 * Altbestands-Breiten (z. B. Original-Reencodes früherer Pipeline-Stände)
 * stehen in media_variant/srcset und müssen weiter ausliefern.
 *
 * Cache: `immutable` (1 Jahr) NUR, wenn Regenerier-Marker (.encoder-rev)
 * UND angefragte ?v-Kennung die aktuelle Encoder-Revision bestätigen —
 * sonst kurzlebig (uploadCacheControl, media-url.ts; Panel-Befunde
 * gpt-5.6-sol R1+R3: weder alte Bytes unter neuer URL noch Vorgriffe auf
 * künftige Revisionen dürfen ein Jahr festgenagelt werden).
 */
import fs from "node:fs";
import path from "node:path";
import { uploadsDir } from "@/lib/media";
import { isVariantFile, uploadCacheControl } from "@/lib/media-url";

const KEY_RE = /^[a-f0-9]{20}$/;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ pfad: string[] }> },
) {
  const { pfad } = await ctx.params;
  if (pfad.length !== 2 || !KEY_RE.test(pfad[0]) || !isVariantFile(pfad[1])) {
    return new Response("Nicht gefunden", { status: 404 });
  }
  const dir = path.join(uploadsDir(), pfad[0]);
  const file = path.join(dir, pfad[1]);
  // EIN Datei-Handle für Größe UND Inhalt (Panel-Befund gpt-5.6-sol R3):
  // getrenntes stat + createReadStream wäre eine Lücke, in der das atomare
  // Rename des Nachzugs die Datei tauscht — Content-Length der alten,
  // Bytes der neuen Datei (abgeschnittene/kaputte Antwort). fstat auf dem
  // offenen fd und Stream vom selben fd sind dagegen konsistent: ein
  // Rename ersetzt nur den Verzeichniseintrag, nie die offene Inode.
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return new Response("Nicht gefunden", { status: 404 });
  }
  const stat = fs.fstatSync(fd);
  let marker: string | null = null;
  try {
    marker = fs.readFileSync(path.join(dir, ".encoder-rev"), "utf8");
  } catch {
    marker = null; // kein Marker → Bild (noch) nicht auf aktueller Revision
  }
  const angefragteRev = new URL(req.url).searchParams.get("v");
  // autoClose schließt den fd am Stream-Ende/-Abbruch.
  const stream = fs.createReadStream("", { fd, autoClose: true });
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(stat.size),
      "Cache-Control": uploadCacheControl(marker, angefragteRev),
    },
  });
}
