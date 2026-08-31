"use client";

/**
 * Alt-Text-Editor (Admin): schreibt die Beschreibung eines Bildes — neben dem
 * Bild, groß genug, um es zu sehen.
 *
 * ── WARUM EIN DIALOG UND KEIN FELD IN DER KACHEL ────────────────────────────
 *
 * Bis 08/2026 stand in jeder Kachel ein Eingabefeld mit einem „Speichern"-Knopf
 * daneben, in einer Zeile. Die Kachel ist auf großen Bildschirmen ein Sechstel
 * der Seite breit; der Knopf nahm sich seine Breite, dem Feld blieb ein
 * Quadrat von wenigen Millimetern. Darin war weder etwas zu LESEN, was schon
 * dastand, noch etwas zu SCHREIBEN.
 *
 * Das ist keine Frage von ein paar Pixeln mehr: Ein Alt-Text ist ein SATZ, und
 * ein Satz passt nicht in eine Kachel. Wer ihn schreibt, muss außerdem das
 * Bild ansehen können — sonst beschreibt er es aus dem Gedächtnis. Beides gibt
 * es nur in einem eigenen Fenster, und deshalb steht der Text in der Kachel
 * jetzt LESBAR und wird HIER geschrieben.
 *
 * Gespeichert wird über eine Server-Action ohne Umleitung, damit der Dialog
 * offen bleibt und seine Rückmeldung selbst anzeigt — dieselbe Bauform wie
 * beim Ausschnitt-Editor, mit dem er sich die Hülle (`AdminDialog`) teilt.
 */
import { useState } from "react";
import { saveAltTextAction } from "@/app/admin/(protected)/medien/actions";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { t } from "@/i18n/de";

const dict = t();
const m = dict.admin.media;

export function AltTextEditor({
  imageId,
  imageSrc,
  initialAltText,
}: {
  imageId: number;
  /** Große Bildvariante — man beschreibt, was man sieht. */
  imageSrc: string;
  initialAltText: string;
}) {
  const [offen, setOffen] = useState(false);
  const [wert, setWert] = useState(initialAltText);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function oeffnen() {
    // Beim Öffnen den aktuellen Stand übernehmen: Seit dem Mounten kann sich
    // der Wert geändert haben (Speichern in einer anderen Kachel lädt die
    // Seite neu), und ein abgebrochener Versuch soll nicht kleben bleiben.
    setWert(initialAltText);
    setNote(null);
    setOffen(true);
  }

  async function speichern() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await saveAltTextAction(imageId, wert);
      setNote(res.ok ? m.altTextSaved : dict.common.error);
    } catch {
      setNote(dict.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={oeffnen}
        className="rounded border border-ink/20 px-2 py-1 text-xs hover:bg-cream"
      >
        {m.altTextButton}
      </button>

      <AdminDialog
        offen={offen}
        schliessen={() => setOffen(false)}
        titel={m.altTextTitle}
        fuss={
          <>
            <button
              type="button"
              onClick={() => setOffen(false)}
              className="rounded-lg border border-ink/20 px-4 py-1.5 text-sm hover:bg-cream"
            >
              {dict.common.cancel}
            </button>
            <button
              type="button"
              onClick={speichern}
              disabled={busy}
              className="rounded-lg bg-rose-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-primary-dark disabled:opacity-50"
            >
              {dict.common.save}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">{m.altTextHint}</p>

        <div className="flex justify-center bg-cream/60 p-2">
          <img
            src={imageSrc}
            /* Der gespeicherte Stand, nicht der getippte: Ein Alt-Text, der
               sich bei jedem Zeichen ändert, wäre für einen Screenreader
               unbrauchbares Geplapper. Ist noch keiner da, ist das Bild
               tatsächlich unbeschrieben — genau der Zustand, der hier
               behoben wird. */
            alt={initialAltText}
            className="block max-h-[45vh] w-auto max-w-full"
          />
        </div>

        <label className="text-sm font-medium" htmlFor={`alt-text-${imageId}`}>
          {m.altText}
        </label>
        <textarea
          id={`alt-text-${imageId}`}
          value={wert}
          onChange={(e) => {
            setWert(e.target.value);
            setNote(null);
          }}
          rows={3}
          className="w-full border border-ink-soft/30 px-3 py-2 text-sm"
        />

        {note && (
          <p role="status" className="text-sm text-leaf">
            {note}
          </p>
        )}
      </AdminDialog>
    </>
  );
}
