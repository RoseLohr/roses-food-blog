/**
 * Der Hinweis über einem Entwurf im ÖFFENTLICHEN Bereich.
 *
 * ── WOZU ────────────────────────────────────────────────────────────────────
 *
 * Ein angemeldeter Admin sieht den Blog mit seinen Entwürfen. Damit entsteht
 * eine Frage, die es vorher nicht gab: Schaue ich gerade auf etwas, das jeder
 * sieht — oder auf etwas, das nur ich sehe?
 *
 * Diese Frage muss die Seite beantworten, und zwar SICHTBAR. Ein `title`
 * genügt nicht (auf dem iPad gibt es kein Hover), eine andere Hintergrundfarbe
 * auch nicht (sie sagt nicht, was sie bedeutet). Deshalb steht hier ein Satz.
 *
 * ── WARUM DAS KEINE SICHTBARKEITSPRÜFUNG IST ────────────────────────────────
 *
 * Dieser Baustein ENTSCHEIDET NICHTS. Er beschriftet nur, was ohnehin schon
 * geladen wurde. Ob ein Entwurf geladen werden durfte, hat die Datenabfrage
 * beantwortet (src/lib/entwurfsansicht.ts) — und wenn nicht, gibt es hier
 * nichts zu beschriften, weil die Seite dann gar nicht existiert (404).
 *
 * Diese Reihenfolge ist der Kern der Sache: Erst nicht laden, dann nicht
 * anzeigen — nie umgekehrt. Was eine Server-Komponente an ihre Kinder reicht,
 * steht im RSC-Payload und im HTML; „laden und ausblenden" hieße, den Entwurf
 * im Quelltext mitzuliefern.
 */
import { Statuschip } from "@/components/statuschip";
import { t } from "@/i18n/de";

const e = t().entwurf;

/**
 * Das Band über einem Entwurfs-Beitrag.
 *
 * Nimmt `entwurf` als Prop und rendert bei `false` nichts. Bewusst so herum:
 * Die Aufrufstelle schreibt eine Zeile und muss nicht selbst eine Bedingung
 * formulieren — eine Bedingung, die man an einer von drei Detailseiten
 * vergessen könnte.
 */
export function Entwurfshinweis({ entwurf }: { entwurf: boolean }) {
  if (!entwurf) return null;
  return (
    <p
      role="status"
      /* `text-amber-900` und NICHT `text-ink`: Der Nachtmodus tauscht die
         Projekt-Token (`--color-ink` wird dort fast weiss), die
         Amber-Palette aber nicht. Ein heller Amber-Grund mit `text-ink`
         ergaebe im Dunkeln Weiss auf Weiss. Flaeche und Schrift muessen aus
         DERSELBEN Familie kommen — genau so haelt es der Statuschip seit
         jeher (bg-amber-100 / text-amber-900). Siehe CLAUDE.md, Nachtmodus. */
      className="mb-4 flex flex-wrap items-center gap-2 border-l-4 border-amber-500 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <Statuschip ton="gelb">{e.plakette}</Statuschip>
      <span>{e.hinweis}</span>
    </p>
  );
}

/**
 * Die kleine Plakette auf einer Kachel (Startseite, Rezept- und Reiseliste).
 *
 * Ohne den erklärenden Satz: In einem Raster aus zwölf Kacheln wäre er
 * zwölfmal dasselbe. Das Wort genügt dort, der Satz steht auf der Seite
 * dahinter.
 */
export function Entwurfsplakette({ entwurf }: { entwurf: boolean }) {
  if (!entwurf) return null;
  return <Statuschip ton="gelb">{e.plakette}</Statuschip>;
}
