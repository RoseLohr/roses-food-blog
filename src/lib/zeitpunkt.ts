/**
 * Zeitpunkte, wie sie im Admin LESBAR dastehen.
 *
 * ── DER BEFUND ──────────────────────────────────────────────────────────────
 *
 * Die Medienbibliothek hatte ihr eigenes Datumsformat: `DD-MM-YY`, also
 * „28-08-26" für den 28. August 2026. Das ist an drei Stellen unbrauchbar:
 *
 *  1. Es ist MEHRDEUTIG. „28-08-26" liest sich mit Bindestrichen wie ein
 *     abgeschnittenes ISO-Datum, und dort steht das Jahr VORN — 2028-08-26.
 *     Ein zweistelliges Jahr zwischen zwei Bindestrichen sagt nicht, welche
 *     der drei Zahlen es ist.
 *  2. Es steht ALLEIN in diesem Haus. Jede andere Admin-Seite (Rezepte,
 *     Reisen, Benutzer, Kontakte, Kampagnen) schreibt `toLocaleDateString("de-DE")`
 *     und damit „28.8.2026". Zwei Schreibweisen für dieselbe Sache in
 *     derselben Oberfläche sind eine Fehlerquelle ohne Gegenwert.
 *  3. Es kennt keine UHRZEIT. Wer an einem Nachmittag zwanzig Fotos hochlädt,
 *     bekommt zwanzigmal dieselbe Angabe — die Frage „wann wurde das
 *     hochgeladen" bleibt genau dann unbeantwortet, wenn sie interessant wird.
 *
 * ── DIE ZEITZONE ────────────────────────────────────────────────────────────
 *
 * Gerechnet wird in der Zeitzone des SERVERS — dieselbe Wahl, die die übrigen
 * Admin-Seiten schon treffen. Das ist hier richtig und nicht bloß bequem: Der
 * Blog hat eine Redaktion an einem Ort, und „wann habe ich das hochgeladen"
 * meint deren Uhr. Eine eigene Zeitzonen-Politik nur für diese eine Seite wäre
 * eine dritte Schreibweise statt einer weniger.
 *
 * Hier ist der Ort, an dem die übrigen acht Fundstellen zusammenlaufen
 * sollten, wenn jemand sie anfasst — nicht in einer neunten Kopie.
 */

/** Nur der Tag: „28.8.2026". Gleiche Schreibweise wie überall sonst im Admin. */
export function alsDatum(d: Date): string {
  return d.toLocaleDateString("de-DE");
}

/**
 * Tag und Uhrzeit: „28.8.2026 um 07:48".
 *
 * Ohne Sekunden — die trennen keine zwei Uploads, die ein Mensch
 * auseinanderhalten will, und machen die Zeile nur länger.
 */
export function alsZeitpunkt(d: Date): string {
  const zeit = d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${alsDatum(d)} um ${zeit}`;
}
