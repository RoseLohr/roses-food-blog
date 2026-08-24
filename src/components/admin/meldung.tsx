/**
 * Die Statusmeldung über einer Admin-Seite — samt der Zeile, die sie aus
 * `?meldung=` liest. Beides stand bis 08/2026 in 17 Seiten Zeichen für
 * Zeichen gleich da. Dass die Rückmeldung `role="status"` trägt (damit ein
 * Screenreader sie ansagt, ohne den Fokus zu verlieren), gilt für alle
 * gleich; siebzehnmal hingeschrieben ist es sechzehnmal die Gelegenheit, es
 * zu vergessen.
 */
export function Meldung({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <p role="status" className="mb-4 bg-amber-50 p-3 text-sm text-amber-900">
      {text}
    </p>
  );
}

/**
 * Die Prüfung auf `string` ist nötig, weil Next denselben Suchparameter
 * mehrfach als Array liefert — dann hinge die Anzeige die Einträge
 * unbeschriftet aneinander.
 */
export function meldungAus(
  searchParams: Record<string, string | string[] | undefined>,
): string | null {
  return typeof searchParams.meldung === "string" ? searchParams.meldung : null;
}
