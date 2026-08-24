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
  // 2. EIN Datei-Handle für Größe UND Inhalt: beides aus demselben fd —
  //    ein paralleles Rename ersetzt nur den Verzeichniseintrag, nie die
  //    offene Inode; getrenntes stat/Lesen lieferte sonst die Content-Length
  //    der alten zu den Bytes der neuen Datei (R3).
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
  const angefragteRev = new URL(req.url).searchParams.get("v");
  // 3. KEIN Node-Lesestrom als Antwortkörper (Befund E2, audit/11).
  //    `fs.createReadStream` als Körper zurückzugeben hatte zwei Fehler, die
  //    beide nachgestellt sind (tests/upload-auslieferung.test.ts):
  //      a) Bricht der Leser ab, während das abschließende `pull()` noch
  //         läuft, wirft der Adapter „Invalid state: ReadableStream is already
  //         closed" — unbehandelt, also als uncaughtException im Journal.
  //      b) Wird der Körper NIE gelesen — genau das tut Next bei HEAD, das es
  //         als GET ausführt —, feuert `autoClose` nie. Gemessen: 50 solche
  //         Antworten hinterließen 50 offene Deskriptoren.
  //    Die ausgelieferten Varianten sind klein (größte im Bestand rund 8 KB,
  //    Breiten aus config/bild-encoder.json, höchstens 1920 px). Streamen hat
  //    hier keinen Zweck; vollständig lesen behebt a) und b) in einem Zug.
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    // `readFileSync` liefert einen Buffer, dessen Speicher laut Typ auch ein
    // SharedArrayBuffer sein darf — als Antwortkörper ist aber nur eine Sicht
    // auf einen gewöhnlichen ArrayBuffer zulässig. Die Kopie macht das
    // eindeutig und kostet bei rund 8 KB nichts; ein Cast wäre eine Behauptung
    // über fremden Speicher, die hier niemand belegen kann.
    bytes = new Uint8Array(fs.readFileSync(fd));
  } finally {
    // Der Deskriptor gehört in JEDEM Fall zurück. `closeSync` kann hier nur
    // EBADF werfen (Deskriptor bereits geschlossen), und das kann nicht
    // eintreten: `openSync` hat ihn gerade geliefert und niemand sonst fasst
    // ihn an. Ein Lesefehler wird also nicht von einem Schließfehler verdeckt.
    fs.closeSync(fd);
  }
  // Länge UND Bytes stammen jetzt buchstäblich aus demselben Lesevorgang —
  // die Zusage aus R3 ist damit nicht mehr nur durch die fd-Führung gedeckt,
  // sondern durch dieselbe Zahl. `fstat` wird dafür nicht mehr gebraucht.
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.byteLength),
      // immutable nur, wenn Manifest-Revision, angefragtes ?v UND die
      // Byte-Größe des offenen fd zusammenpassen (Verifikation statt Lock).
      "Cache-Control": uploadCacheControl(
        marker,
        pfad[1],
        bytes.byteLength,
        angefragteRev,
      ),
    },
  });
}
