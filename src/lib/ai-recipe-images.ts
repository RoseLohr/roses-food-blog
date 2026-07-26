/**
 * Limits + Vorprüfung für Rezept-Fotos des KI-Assistenten — CLIENT-SICHER
 * (reine Konstanten/Logik, keine Node- oder Server-Abhängigkeiten), damit
 * Editor-UI und API-Route DIESELBEN Grenzen prüfen (ein Ort, keine Drift).
 *
 * Die Grenzen sind bewusst konservativ: Der Reverse-Proxy erlaubt in den
 * normalen Locations 20 MB pro Request (deploy/nginx.conf.example) — das
 * Gesamtlimit bleibt darunter, damit der Upload nie am Proxy statt an einer
 * verständlichen Meldung scheitert. Serverseitig werden die Fotos zusätzlich
 * verkleinert (lib/media.ts, prepareAiImage), bevor sie ans Modell gehen —
 * die Caps hier deckeln die EINGABE (unbounded_consumption, C-05).
 */
export const MAX_AI_IMAGES = 5;
export const MAX_AI_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_AI_TOTAL_BYTES = 19 * 1024 * 1024;
export const AI_IMAGE_MB = 8;
export const AI_TOTAL_MB = 19;

/** Vom Editor akzeptierte Formate (Server verifiziert zusätzlich per Bildprobe). */
export const AI_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Liest das Textfeld eines multipart-Formulars TYPSICHER: FormData.get()
 * liefert string ODER File. Ein als „text" hochgeladenes File würde über
 * String(...) zu "[object File]" — ein nicht-leerer Müll-String, der das
 * Pflichteingabe-Gate passierte und einen kostenpflichtigen KI-Lauf startete
 * (Cross-Vendor-Befund). Nur echte Strings zählen; alles andere ist leer.
 */
export function formTextValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type AiImageIssue =
  | { code: "zu_viele" }
  | { code: "zu_gross"; name: string }
  | { code: "gesamt" }
  | { code: "format"; name: string };

/**
 * Prüft eine Foto-Auswahl gegen die Limits. `trustType=false` überspringt die
 * MIME-Prüfung (serverseitig: der Browser-/Client-Typ ist nicht vertrauenswürdig;
 * dort entscheidet die echte Bildprobe in prepareAiImage über das Format).
 */
export function checkAiImageSelection(
  files: Array<{ name: string; size: number; type: string }>,
  opts: { trustType: boolean } = { trustType: true },
): AiImageIssue | null {
  if (files.length > MAX_AI_IMAGES) return { code: "zu_viele" };
  let total = 0;
  for (const f of files) {
    if (opts.trustType && !ALLOWED_TYPES.has(f.type)) {
      return { code: "format", name: f.name };
    }
    if (f.size > MAX_AI_IMAGE_BYTES) return { code: "zu_gross", name: f.name };
    total += f.size;
  }
  if (total > MAX_AI_TOTAL_BYTES) return { code: "gesamt" };
  return null;
}
