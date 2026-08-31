/**
 * Die Übersichtsseite EINER Taxonomie — Kategorie oder Ernährungsform.
 *
 * ── WARUM DAS EINE KOMPONENTE IST ───────────────────────────────────────────
 *
 * Beide Seiten sagen dasselbe: „Hier sind die veröffentlichten Rezepte, die
 * dieses eine Merkmal tragen." Sie unterscheiden sich in vier Angaben — dem
 * Namen, der Zahl, dem Rückweg und dem Titel darüber. Alles andere (Kopf,
 * Zählzeile, Kartenraster, Leerfall) war beim Anlegen der Ernährungsform-Seite
 * im Begriff, ein zweites Mal dazustehen.
 *
 * Was hier NICHT hineingehört: die Sichtbarkeitsfrage. Übersichtsseiten
 * bleiben ausnahmslos bei Veröffentlichtem (siehe `veroeffentlichteRezeptIds`),
 * und eine Komponente, die Rezepte nur noch ANZEIGT, könnte daran ohnehin
 * nichts mehr ändern — die Entscheidung ist längst in der Abfrage gefallen.
 */
import Link from "next/link";
import { RecipeCard } from "@/components/recipe-card";
import type { rezeptkarten } from "@/lib/recipe-list";

type Rezeptkarte = Awaited<ReturnType<typeof rezeptkarten>>[number];

export function TaxonomieListe({
  name,
  rezepte,
  zurueckHref,
  zurueckLabel,
  anzahlText,
  leerText,
}: {
  /** Überschrift der Seite — der Name der Kategorie bzw. Ernährungsform. */
  name: string;
  rezepte: Rezeptkarte[];
  zurueckHref: string;
  zurueckLabel: string;
  /** Fertig formulierte Zählzeile („7 Rezepte") — die Beugung kennt der Aufrufer. */
  anzahlText: string;
  /** Satz für den Fall ohne Rezepte — er benennt, WAS leer ist. */
  leerText: string;
}) {
  return (
    <>
      <Link
        href={zurueckHref}
        className="text-sm font-medium text-ink-soft transition-colors hover:text-leaf"
      >
        ‹ {zurueckLabel}
      </Link>
      <h1 className="mt-1 font-display text-3xl font-bold md:text-4xl">{name}</h1>
      <p className="mt-2 text-ink-soft">{anzahlText}</p>

      {rezepte.length === 0 ? (
        <p className="mt-8 text-ink-soft">{leerText}</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {rezepte.map((r) => (
            <RecipeCard key={r.slug} recipe={r} />
          ))}
        </div>
      )}
    </>
  );
}
