"use client";

/**
 * Die Hülle eines Admin-Dialogs: Overlay, Kopfzeile mit Titel und ×,
 * Inhaltsbereich, Fußzeile für die Knöpfe.
 *
 * ── WARUM DAS EINE EIGENE KOMPONENTE IST ────────────────────────────────────
 *
 * Ein Modal ist nicht nur ein Kasten über der Seite. Damit er benutzbar ist,
 * gehören vier Dinge dazu, die man einzeln vergisst:
 *
 *   1. Der Tastaturfokus muss DRIN bleiben — sonst tabbt man hinter das
 *      Overlay und bedient blind die Seite darunter.
 *   2. Escape muss schließen.
 *   3. Die Seite darunter darf nicht mitscrollen.
 *   4. Nach dem Schließen muss der Fokus dorthin ZURÜCK, wo er herkam —
 *      sonst steht er am Seitenanfang und der Weg dahin war umsonst.
 *
 * Das stand bis 08/2026 einmal ausgeschrieben im Fokuspunkt-Editor. Ein
 * zweiter Dialog (Alt-Text) hätte es abgeschrieben — und die Abschrift wäre
 * die Fassung geworden, die eines dieser vier Dinge nicht mitbekommt. Deshalb
 * steht es hier einmal, und beide Editoren nehmen es.
 *
 * ── WAS HIER NICHT DRIN IST ─────────────────────────────────────────────────
 *
 * Der öffnende Knopf. Der gehört dem Aufrufer: Er trägt dessen Beschriftung,
 * und wo er steht, entscheidet die Seite. Diese Komponente rendert nichts,
 * solange `offen` falsch ist.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n/de";

const dict = t();

/**
 * Was den Tastaturfokus annehmen kann.
 *
 * `textarea` steht bewusst mit in der Liste: Der Fokuspunkt-Editor kam mit
 * `button, input` aus, weil er kein mehrzeiliges Feld hatte. Der Alt-Text hat
 * eines — und wäre es hier nicht genannt, liefe die Falle an ihm vorbei.
 */
const FOKUSSIERBAR = "button, input, textarea, select, a[href]";

export function AdminDialog({
  offen,
  schliessen,
  titel,
  fuss,
  children,
}: {
  offen: boolean;
  schliessen: () => void;
  /** Überschrift — zugleich der zugängliche Name des Dialogs. */
  titel: string;
  /** Die Knöpfe unten (Abbrechen/Speichern). Ohne Fuß bleibt die Zeile weg. */
  fuss?: ReactNode;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * `schliessen` in einer Ref statt in den Abhängigkeiten des Effekts.
   *
   * Die Aufrufstellen übergeben `() => setOffen(false)` — ein bei JEDEM Rendern
   * neues Funktionsobjekt. Stünde es in der Abhängigkeitsliste, liefe der
   * Effekt nach jedem Tastendruck im Alt-Text-Feld neu und sein erster Schritt
   * (`fokussierbare()[0]?.focus()`) risse den Fokus zurück auf den ×-Knopf:
   * Das Feld wäre nach einem Zeichen nicht mehr beschreibbar.
   *
   * Der Effekt hängt deshalb allein an `offen` — der einzigen Größe, deren
   * Wechsel wirklich etwas zu tun gibt.
   */
  const schliessenRef = useRef(schliessen);
  schliessenRef.current = schliessen;

  useEffect(() => {
    if (!offen) return;
    const dialog = dialogRef.current;
    const vorherigerFokus = document.activeElement as HTMLElement | null;
    const vorherigesOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const fokussierbare = (): HTMLElement[] =>
      dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>(FOKUSSIERBAR)).filter(
            (el) => !el.hasAttribute("disabled"),
          )
        : [];
    fokussierbare()[0]?.focus();

    function beiTaste(e: KeyboardEvent) {
      if (e.key === "Escape") {
        schliessenRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      // Fokusfalle: Tab zirkuliert innerhalb des Dialogs.
      const els = fokussierbare();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const erstes = els[0];
      const letztes = els[els.length - 1];
      const aktiv = document.activeElement;
      const drin = dialog?.contains(aktiv as Node) ?? false;
      if (e.shiftKey) {
        if (!drin || aktiv === erstes) {
          e.preventDefault();
          letztes.focus();
        }
      } else if (!drin || aktiv === letztes) {
        e.preventDefault();
        erstes.focus();
      }
    }

    document.addEventListener("keydown", beiTaste);
    return () => {
      document.removeEventListener("keydown", beiTaste);
      document.body.style.overflow = vorherigesOverflow;
      // Zurück zum Knopf, der den Dialog geöffnet hat. Gemerkt wird das
      // Element selbst statt einer Referenz vom Aufrufer: So muss keine
      // Aufrufstelle daran denken, und keine kann es falsch machen.
      vorherigerFokus?.focus();
    };
  }, [offen]);

  if (!offen) return null;

  return createPortal(
    // a11y-Ausnahme (begründet): Klick auf den Hintergrund schließt nur
    // zusätzlich; über die Tastatur führen Escape und der ×-Knopf hinaus.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={titel}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) schliessen();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
          <h2 className="font-display text-lg font-bold">{titel}</h2>
          <button
            type="button"
            onClick={schliessen}
            aria-label={dict.imagePicker.close}
            className="flex h-9 w-9 items-center justify-center text-xl text-ink-soft hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">{children}</div>

        {fuss && (
          <div className="flex items-center justify-between gap-3 border-t border-ink/10 px-4 py-3">
            {fuss}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
