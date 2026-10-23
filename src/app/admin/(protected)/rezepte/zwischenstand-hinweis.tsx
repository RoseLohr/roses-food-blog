/**
 * Der Hinweis auf einen Zwischenstand — über dem Editor, wenn beim Öffnen
 * einer liegt („Zwischenstand von 12:03 — Wiederherstellen · Verwerfen"),
 * nach dem Wiederherstellen („… wiederhergestellt — noch nicht gespeichert.")
 * und auf /admin/rezepte/neu als Liste begonnener Rezepte („Fortsetzen").
 *
 * Nicht `<Meldung>`: Die trägt nur Text, hier stehen zwei Handlungen drin.
 * Wiederherstellen ist ein LINK mit Suchparameter — serverseitig gerendert,
 * also als Zustand fotografierbar (tests/e2e/admin-referenz.spec.ts). Die
 * Uhrzeit ist lauf-abhängig → Referenzmaske.
 */
import { t } from "@/i18n/de";
import { zwischenstandVerwerfenAction } from "./actions";

const d = t().admin.recipes;

export function ZwischenstandHinweis(props: {
  /** „12:03" */
  zeit: string;
  schluessel: string;
  /** Wohin „Verwerfen" zurückführt (Admin-Pfad). */
  zurueck: string;
  /** Adresse zum Wiederherstellen; fehlt sie, ist der Stand bereits wiederhergestellt. */
  wiederherstellen?: string;
  /** Liste neuer Rezepte: der rohe Titel, wie getippt (leer → „(ohne Titel)"). */
  titel?: string;
  /** Live-Region (nur für den einzelnen Hinweis, nicht für Listenzeilen). */
  live?: boolean;
}) {
  const fortsetzen = props.titel !== undefined;
  return (
    <div
      role={props.live ? "status" : undefined}
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <span>
        {fortsetzen && (
          <>
            <span className="font-semibold">{props.titel || d.zwischenstandOhneTitel}</span>
            {" — "}
          </>
        )}
        {d.zwischenstandVon} <span data-referenz-maske="true">{props.zeit}</span>
        {props.wiederherstellen === undefined && ` ${d.zwischenstandWiederhergestellt}`}
      </span>
      {props.wiederherstellen !== undefined && (
        <a href={props.wiederherstellen} className="font-semibold underline-offset-2 hover:underline">
          {fortsetzen ? d.zwischenstandFortsetzen : d.zwischenstandWiederherstellen}
        </a>
      )}
      <form action={zwischenstandVerwerfenAction}>
        <input type="hidden" name="schluessel" value={props.schluessel} />
        <input type="hidden" name="zurueck" value={props.zurueck} />
        <button type="submit" className="underline-offset-2 hover:underline">
          {d.zwischenstandVerwerfen}
        </button>
      </form>
    </div>
  );
}
