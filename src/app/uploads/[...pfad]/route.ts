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
  // Reihenfolge ist tragend (Panel-Befunde gpt-5.6-sol R3+R4):
  // 1. ZUERST den Revisionsmarker lesen, DANN die Datei öffnen. Der Nachzug
  //    schreibt den Marker erst NACH allen Renames eines Bildes — ist der
  //    Marker hier schon aktuell, ist jede danach geöffnete Datei zwingend
  //    die neue Inode. Umgekehrt (erst öffnen) könnte der Nachzug zwischen
  //    open und Marker-Lesen fertig werden: alte Inode im fd, „aktueller"
  //    Marker → alte Bytes ein Jahr immutable unter aktuellem ?v (R4).
  // 2. EIN Datei-Handle für Größe UND Inhalt: fstat + Stream vom selben fd —
  //    ein paralleles Rename ersetzt nur den Verzeichniseintrag, nie die
  //    offene Inode; getrenntes stat/createReadStream lieferte sonst die
  //    Content-Length der alten zu den Bytes der neuen Datei (R3).
  let marker: string | null = null;
  try {
    marker = fs.readFileSync(path.join(dir, ".encoder-rev"), "utf8");
  } catch {
    marker = null; // kein Marker → Bild (noch) nicht auf aktueller Revision
  }
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return new Response("Nicht gefunden", { status: 404 });
  }
  const stat = fs.fstatSync(fd);
  const angefragteRev = new URL(req.url).searchParams.get("v");
  // autoClose schließt den fd am Stream-Ende/-Abbruch.
  const stream = fs.createReadStream("", { fd, autoClose: true });
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(stat.size),
      // immutable nur, wenn Manifest-Revision, angefragtes ?v UND die
      // Byte-Größe des offenen fd zusammenpassen (Verifikation statt Lock).
      "Cache-Control": uploadCacheControl(
        marker,
        pfad[1],
        stat.size,
        angefragteRev,
      ),
    },
  });
}
