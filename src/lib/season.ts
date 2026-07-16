/**
 * Saison-Helfer: ISO-8601-Kalenderwochen (Montag als Wochenbeginn, KW 1 =
 * Woche mit dem ersten Donnerstag des Jahres) und die Prüfung, ob eine
 * Kalenderwoche in einer Saison liegt. Saisonbereiche dürfen über den
 * Jahreswechsel gehen (z. B. Kürbis: KW 36 → KW 8).
 */

/** ISO-Kalenderwoche (1–53) eines Datums. */
export function isoWeek(date: Date): number {
  // Auf UTC-Mittag normalisieren, dann auf den Donnerstag derselben
  // ISO-Woche schieben — dessen Jahr ist das ISO-Jahr.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // Mo=1 … So=7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Aktuelle ISO-Kalenderwoche. */
export function currentIsoWeek(now: Date = new Date()): number {
  return isoWeek(now);
}

/**
 * Liegt die Kalenderwoche in der Saison [startWeek, endWeek] (inklusive)?
 * startWeek > endWeek bedeutet: Saison läuft über den Jahreswechsel.
 */
export function isWeekInSeason(
  week: number,
  startWeek: number | null | undefined,
  endWeek: number | null | undefined,
): boolean {
  if (startWeek == null || endWeek == null) return false;
  if (startWeek < 1 || endWeek < 1 || startWeek > 53 || endWeek > 53) return false;
  if (startWeek <= endWeek) return week >= startWeek && week <= endWeek;
  return week >= startWeek || week <= endWeek;
}
