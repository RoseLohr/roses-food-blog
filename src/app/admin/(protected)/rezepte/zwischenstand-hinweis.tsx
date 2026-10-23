"use client";

/**
 * Der Hinweis auf einen Zwischenstand — über dem Editor, wenn beim Öffnen
 * einer liegt („Zwischenstand von 12:03 — Wiederherstellen · Verwerfen"),
 * nach dem Wiederherstellen („… wiederhergestellt — noch nicht gespeichert.")
 * und auf /admin/rezepte/neu als Liste begonnener Rezepte („Fortsetzen").
 *
 * Nicht `<Meldung>`: Die trägt nur Text, hier stehen zwei Handlungen drin.
 * Wiederherstellen/Fortsetzen ist ein LINK mit Suchparameter — serverseitig
 * gerendert, also als Zustand fotografierbar (tests/e2e/admin-referenz.spec.ts).
 * Verwerfen ist ein KNOPF, den der Editor bedient (DELETE an den Route-Handler
 * src/app/api/admin/rezepte/zwischenstand/route.ts), kein Formular: Ein
 * Formular mit Redirect hängte die ganze Seite neu ein, und was seit der
 * letzten Sicherung getippt wurde, wäre weg. Was NACH dem Verwerfen gilt,
 * entscheidet der Editor. Die Uhrzeit ist lauf-abhängig → Referenzmaske.
 *
 * Mehrere Hinweise auf einer Seite (die Liste auf /neu) tragen denselben
 * sichtbaren Knopftext; der zugängliche Name nennt deshalb, WAS verworfen oder
 * fortgesetzt wird — sonst stünden im Rotor drei gleiche „Verwerfen".
 */
import { t } from "@/i18n/de";

const d = t().admin.recipes;

export function ZwischenstandHinweis(props: {
  /** „12:03" */
  zeit: string;
  /** Adresse zum Wiederherstellen; fehlt sie, ist der Stand bereits wiederhergestellt. */
  wiederherstellen?: string;
  /** Liste neuer Rezepte: der rohe Titel, wie getippt (leer → „(ohne Titel)"). */
  titel?: string;
  /** Live-Region (nur für den einzelnen Hinweis, nicht für Listenzeilen). */
  live?: boolean;
  /** „Verwerfen" — löscht die Zeile und entscheidet, was danach gilt. */
  onVerwerfen: () => void;
}) {
  const fortsetzen = props.titel !== undefined;
  const was = fortsetzen ? props.titel || d.zwischenstandOhneTitel : `${d.zwischenstandVon} ${props.zeit}`;
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
        <a
          href={props.wiederherstellen}
          aria-label={fortsetzen ? d.zwischenstandFortsetzenName(was) : undefined}
          className="font-semibold underline-offset-2 hover:underline"
        >
          {fortsetzen ? d.zwischenstandFortsetzen : d.zwischenstandWiederherstellen}
        </a>
      )}
      <button
        type="button"
        aria-label={d.zwischenstandVerwerfenName(was)}
        onClick={props.onVerwerfen}
        className="underline-offset-2 hover:underline"
      >
        {d.zwischenstandVerwerfen}
      </button>
    </div>
  );
}
