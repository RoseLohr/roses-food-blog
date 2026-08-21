/**
 * Welche Blöcke des Reise-Editors werden beim Speichern wirklich behalten?
 *
 * DER BEFUND (nachgestellt): Der Editor und der Server entschieden das nach
 * VERSCHIEDENEN Regeln. Der Editor fragte bei einem Restaurant-Block „gibt es
 * diesen Index?", der Server „hat dieses Restaurant einen Namen?". Legt man ein
 * Restaurant an, ohne es zu benennen, und schiebt einen Block darauf zwischen
 * zwei Bilder einer Zeile, dann sieht der Editor einen Block dazwischen und
 * streicht die Zeilenzugehörigkeit des unteren Bildes — der Server wirft den
 * Block danach ersatzlos weg. Übrig bleiben drei Bilder, von denen zwei
 * nebeneinander stehen und das dritte darunter, OHNE dass dazwischen etwas zu
 * sehen wäre. Genau das gemeldete Bild, und nicht mehr rückverfolgbar: Der
 * Block, der die Flagge gekostet hat, existiert danach nirgends mehr.
 *
 * Dasselbe mit einem leeren Textblock: Der Editor sieht einen Block, der Server
 * verwirft ihn.
 *
 * Die Wurzel ist nicht der Restaurantname, sondern dass zwei Stellen dieselbe
 * Frage verschieden beantworten. Deshalb steht die Antwort hier — einmal, für
 * beide Seiten.
 *
 * Bewusst ohne Abhängigkeiten (auch ohne zod): Der Editor ist eine
 * Client-Komponente, und was er importiert, landet im Browser-Bündel.
 */

/**
 * Ein Restaurant ohne Namen wird nicht gespeichert — und damit auch kein Block,
 * der darauf zeigt.
 *
 * Der Server prüft `name !== ""` auf einem bereits von zod getrimmten Wert; im
 * Editor ist der Wert ungetrimmt. `trim()` bildet deshalb BEIDE Seiten ab.
 */
export function restaurantWirdGespeichert(name: string): boolean {
  return name.trim() !== "";
}

/** Ein Bildblock ohne ausgewähltes Foto wird nicht gespeichert. */
export function bildWirdGespeichert(imageId: number): boolean {
  return imageId > 0;
}

/**
 * Ein Textblock ohne Inhalt wird nicht gespeichert.
 *
 * Der Server stellt hier die genauere Frage („zeigt der Bericht etwas?",
 * `hatSichtbarenInhalt`) — die braucht den Markdown-Renderer und läuft deshalb
 * nicht im Browser. Für alles, was der EDITOR erzeugen kann, sagen beide
 * dasselbe: Seit der Editor für einen leeren Block gar kein Markdown mehr
 * erzeugt, gibt es keinen Fall mehr, in dem `trim()` etwas übrig lässt, das
 * der Bericht nicht zeigt.
 */
export function textWirdGespeichert(markdown: string): boolean {
  return markdown.trim() !== "";
}
