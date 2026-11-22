/**
 * Die Hinweise auf einen Zwischenstand über dem Rezept-Editor:
 *  - Es liegt einer: „Zwischenstand vom 13.10.2026 um 18:41" mit dem Link
 *    „Wiederherstellen" (das Angebot).
 *  - Der Inhalt des Editors stammt aus einem: „Zwischenstand vom 13.10.2026 um
 *    18:41 wiederhergestellt — noch nicht gespeichert."
 * Beide können zugleich stehen: wenn über einem wiederhergestellten Inhalt
 * inzwischen eine ANDERE Zeile liegt.
 *
 * Tag UND Uhrzeit: Eine Zeile kann über 30 Tage alt sein; eine Uhrzeit allein
 * läse sich wie heute.
 *
 * Nicht `<Meldung>`: Die bringt ihren Abstand nach unten mit (`mb-4`) und
 * trägt nur Text. Der Hinweis steht in der Spalte des Editors, und die setzt
 * die Abstände selbst (`gap-6`) — wie beim Meldungskasten des Editors; und im
 * Angebot steht eine Handlung. Die ist ein LINK mit Suchparameter, kein
 * Knopf: Die Seite wird mit dem Zwischenstand neu geladen, und der Editor
 * hängt neu ein. Was dort stand, ist danach ersetzt; ob das etwas
 * Ungespeichertes war, weiß nur der Editor, und er fragt dann vorher
 * (`beimKlick`). Bedienbar ist der Link erst, wenn er eingehängt ist
 * (wiederherstellen-link.tsx): Vorher hinge die Rückfrage nicht daran.
 */
import { t } from "@/i18n/de";
import { WiederherstellenLink } from "./wiederherstellen-link";

const d = t().admin.recipes;
const KASTEN = "bg-amber-50 p-3 text-sm text-amber-900";

export function ZwischenstandHinweis(props: {
  /** Wann der Zwischenstand gesichert wurde: „13.10.2026 um 18:41". */
  zeit: string;
  /** Adresse zum Wiederherstellen: Mit ihr ist es das Angebot, ohne sie der Hinweis auf den eigenen Inhalt. */
  wiederherstellen?: string;
  /** Vor dem Folgen des Links: Der Editor fragt hier nach, wenn er Ungespeichertes hält, und kann ablehnen. */
  beimKlick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (props.wiederherstellen === undefined) {
    return (
      <div role="status" className={KASTEN}>
        {d.zwischenstandVom} {props.zeit} {d.zwischenstandWiederhergestellt}
      </div>
    );
  }
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${KASTEN}`}>
      <span>
        {d.zwischenstandVom} {props.zeit}
      </span>
      <WiederherstellenLink adresse={props.wiederherstellen} beimKlick={props.beimKlick}>{d.zwischenstandWiederherstellen}</WiederherstellenLink>
    </div>
  );
}

/**
 * Wiederherstellen war verlangt (`?zwischenstand=1`), aber es liegt nichts
 * vor, was sich laden ließe. Ohne diesen Satz stünde das gespeicherte Rezept
 * im Editor, und wer den Zwischenstand erwartet, hielte es dafür. Der Satz
 * sagt nichts über den Inhalt des Editors: Der kann inzwischen getippt sein.
 */
export function ZwischenstandFehlt() {
  return (
    <div role="status" className={KASTEN}>
      {d.zwischenstandFehlt}
    </div>
  );
}
