/**
 * Das Löschen-Formular der Admin-Listen: zwölf Fundstellen, vier Gestalten,
 * ein Kern — eine ID an eine Server-Action, ein Absenden-Knopf.
 *
 * Warum das eine Komponente wert ist, obwohl es neun Zeilen sind: Löschen ist
 * hier bereits einmal schiefgegangen (Foto weg ohne Rückfrage, Bildblock als
 * leere Hülle zurück — siehe src/lib/media-verwendung.ts). Zwölfmal
 * ausgeschrieben ist jede Verschärfung zwölfmal zu machen und elfmal zu
 * vergessen.
 */
import { t } from "@/i18n/de";

const dict = t();

const GESTALTEN = {
  /** Textlink in einer Tabellenzeile. */
  text: "text-red-700 underline-offset-2 hover:underline",
  /** Kleinerer Textlink unter einer Kachel. */
  klein: "text-xs text-red-700 underline-offset-2 hover:underline",
  /** Kreuz neben einem Chip — braucht `beschriftung`, „×" sagt nichts. */
  kreuz: "ml-1 font-bold text-red-700",
  /** Umrandeter Knopf in einer Überschriftenzeile. */
  knopf:
    "rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50",
} as const;

export function LoeschForm({
  action,
  id,
  gestalt = "text",
  beschriftung,
  felder,
  className,
  children = dict.common.delete,
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: number;
  /** Vorgabe: Textlink in einer Tabellenzeile — der häufigste Fall. */
  gestalt?: keyof typeof GESTALTEN;
  /** Vorlesbare Beschriftung — Pflicht bei `kreuz`. */
  beschriftung?: string;
  /** Weitere versteckte Felder, die die Action braucht (z. B. der Typ). */
  felder?: Record<string, string>;
  className?: string;
  /** Vorgabe: das Wort „Löschen". Nur die Kreuz-Gestalt weicht ab. */
  children?: React.ReactNode;
}) {
  return (
    <form action={action} className={className}>
      {Object.entries(felder ?? {}).map(([name, wert]) => (
        <input key={name} type="hidden" name={name} value={wert} />
      ))}
      <input type="hidden" name="id" value={id} />
      <button type="submit" aria-label={beschriftung} className={GESTALTEN[gestalt]}>
        {children}
      </button>
    </form>
  );
}
