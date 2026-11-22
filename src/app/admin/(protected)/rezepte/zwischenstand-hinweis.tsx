/**
 * Der Hinweis über dem Rezept-Editor, wenn sein Inhalt aus einem Zwischenstand
 * stammt: „Zwischenstand vom 13.10.2026 um 18:41 wiederhergestellt — noch
 * nicht gespeichert."
 *
 * Tag UND Uhrzeit: Eine Zeile kann über 30 Tage alt sein; eine Uhrzeit allein
 * läse sich wie heute.
 *
 * Nicht `<Meldung>`: Die bringt ihren Abstand nach unten mit (`mb-4`). Der
 * Hinweis steht in der Spalte des Editors, und die setzt die Abstände selbst
 * (`gap-6`) — wie beim Meldungskasten des Editors.
 */
import { t } from "@/i18n/de";

const d = t().admin.recipes;

export function ZwischenstandHinweis(props: {
  /** Wann der Zwischenstand gesichert wurde: „13.10.2026 um 18:41". */
  zeit: string;
}) {
  return (
    <div role="status" className="bg-amber-50 p-3 text-sm text-amber-900">
      {d.zwischenstandVom} {props.zeit} {d.zwischenstandWiederhergestellt}
    </div>
  );
}
