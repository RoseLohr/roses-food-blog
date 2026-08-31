/**
 * Die Liste der Ernährungsformen unter dem Text der Seite
 * `/ernaehrungsformen`.
 *
 * ── WARUM SIE HIER STEHT UND NICHT IN EINER EIGENEN ROUTE ───────────────────
 *
 * Die Übersicht IST eine gepflegte CMS-Seite: Titel, Text und Titelbild kommen
 * aus dem Admin, und darunter soll die Liste erscheinen. Eine eigene Route
 * hätte dafür den kompletten CMS-Seiten-Aufbau abschreiben müssen — Entwurfs-
 * regel, Titelbild, Markdown, Breadcrumb, Metadaten. Stattdessen hängt diese
 * eine Komponente am Ende der bestehenden Seite; die Bedingung dafür steht an
 * genau einer Stelle in `(public)/[slug]/page.tsx`.
 *
 * Sie lädt selbst, statt die Daten gereicht zu bekommen: So muss die CMS-Seite
 * für die 99 % der Fälle, in denen es NICHT um Ernährungsformen geht, keine
 * Abfrage stellen.
 */
import Link from "next/link";
import { ernaehrungsformen, ernaehrungsformPfad } from "@/lib/ernaehrung";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.dietForms;

export async function ErnaehrungsformenListe() {
  const formen = await ernaehrungsformen();

  if (formen.length === 0) {
    return <p className="mt-8 text-ink-soft">{d.empty}</p>;
  }

  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2">
      {formen.map((f) => (
        <li key={f.slug}>
          <Link
            href={ernaehrungsformPfad(f.slug)}
            className="flex items-baseline justify-between gap-4 border border-ink/10 bg-white px-5 py-4 transition-colors hover:border-leaf hover:text-leaf"
          >
            <span className="font-display text-lg font-semibold">{f.name}</span>
            {/* Die Zahl steht dabei, weil sie die Frage beantwortet, die man
                vor dem Klicken hat: Lohnt sich das? */}
            <span className="shrink-0 text-sm text-ink-soft">
              {d.count(f.anzahl)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
