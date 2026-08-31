"use client";

/**
 * Fokuspunkt-Editor (Admin): legt fest, welcher Bildpunkt bei beschnittenen
 * Darstellungen (object-cover — Slider, Rezept-/Reisekarten, Thumbnails)
 * sichtbar bleiben soll.
 *
 * Bedienung: Button „Ausschnitt" öffnet ein Modal. Der Punkt wird per Klick
 * ins Bild gesetzt (Fadenkreuz) ODER — vollwertig per Tastatur — über zwei
 * Schieberegler (horizontal/vertikal in Prozent). Drei Live-Vorschauen
 * (16:9, 3:2, 1:1) zeigen den resultierenden Zuschnitt sofort. Gespeichert
 * wird über eine Server-Action ohne Redirect, damit das Modal die Rückmeldung
 * selbst anzeigen kann.
 *
 * Die Hülle des Modals — Overlay, Fokusfalle, Escape, Fokus-Rückgabe — steht
 * seit 08/2026 in `AdminDialog` und wird mit dem Alt-Text-Editor geteilt. Sie
 * stand vorher hier ausgeschrieben; der zweite Dialog hätte sie abgeschrieben.
 */
import { useState } from "react";
import { saveFocusPointAction } from "@/app/admin/(protected)/medien/actions";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { t } from "@/i18n/de";

const dict = t();
const m = dict.admin.media;

/** Seitenverhältnisse der Zuschnitt-Vorschauen (Beschriftung → CSS-Klasse). */
const PREVIEWS: Array<{ label: string; aspect: string }> = [
  { label: "16:9", aspect: "aspect-video" },
  { label: "3:2", aspect: "aspect-[3/2]" },
  { label: "1:1", aspect: "aspect-square" },
];

export function FocusPointEditor({
  imageId,
  imageSrc,
  alt,
  initialX,
  initialY,
  onSaved,
}: {
  imageId: number;
  /** Große Bildvariante fürs Modal (Klickfläche + Vorschauen). */
  imageSrc: string;
  alt: string;
  initialX: number;
  initialY: number;
  /** Optional: informiert den Aufrufer (z. B. ImagePicker-Status) nach dem Speichern. */
  onSaved?: (focusX: number, focusY: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [x, setX] = useState(initialX);
  const [y, setY] = useState(initialY);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Öffnen: aktuelle Werte übernehmen (kann sich seit Mount geändert haben).
  function openModal() {
    setX(initialX);
    setY(initialY);
    setNote(null);
    setOpen(true);
  }

  function setFromClick(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    setX(Math.min(100, Math.max(0, Math.round(((e.clientX - rect.left) / rect.width) * 100))));
    setY(Math.min(100, Math.max(0, Math.round(((e.clientY - rect.top) / rect.height) * 100))));
    setNote(null);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await saveFocusPointAction(imageId, x, y);
      if (res.ok) {
        setNote(m.focusSaved);
        onSaved?.(x, y);
      } else {
        setNote(dict.common.error);
      }
    } catch {
      setNote(dict.common.error);
    } finally {
      setBusy(false);
    }
  }

  const objectPosition = `${x}% ${y}%`;

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded border border-ink/20 px-2 py-1 text-xs hover:bg-cream"
      >
        {m.focusButton}
      </button>

      <AdminDialog
        offen={open}
        schliessen={() => setOpen(false)}
        titel={m.focusTitle}
        fuss={
          <>
            <button
              type="button"
              onClick={() => {
                setX(50);
                setY(50);
                setNote(null);
              }}
              className="text-sm text-ink-soft underline-offset-2 hover:underline"
            >
              {m.focusReset}
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-ink/20 px-4 py-1.5 text-sm hover:bg-cream"
              >
                {dict.common.cancel}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="rounded-lg bg-rose-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-primary-dark disabled:opacity-50"
              >
                {dict.common.save}
              </button>
            </div>
          </>
        }
      >
        <p className="text-sm text-ink-soft">{m.focusHint}</p>

        {/* Klickfläche: Button umschließt exakt das Bild, damit die
            Klick-Koordinaten direkt Prozentwerte ergeben. */}
        <div className="flex justify-center bg-cream/60 p-2">
          <button
            type="button"
            onClick={setFromClick}
            aria-label={m.focusTitle}
            className="relative inline-block max-w-full cursor-crosshair"
          >
            <img
              src={imageSrc}
              alt={alt}
              draggable={false}
              className="block max-h-[50vh] w-auto max-w-full select-none"
            />
            {/* Fadenkreuz-Markierung des aktuellen Fokuspunkts */}
            <span
              aria-hidden
              style={{ left: `${x}%`, top: `${y}%` }}
              className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.55)]"
            />
          </button>
        </div>

        {/* Schieberegler = Tastatur-/Screenreader-Pfad */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            {m.focusXLabel}: <strong>{x} %</strong>
            <input
              type="range"
              min={0}
              max={100}
              value={x}
              onChange={(e) => {
                setX(Number(e.target.value));
                setNote(null);
              }}
              className="mt-1 w-full"
            />
          </label>
          <label className="text-sm">
            {m.focusYLabel}: <strong>{y} %</strong>
            <input
              type="range"
              min={0}
              max={100}
              value={y}
              onChange={(e) => {
                setY(Number(e.target.value));
                setNote(null);
              }}
              className="mt-1 w-full"
            />
          </label>
        </div>

        {/* Live-Vorschau der Zuschnitte */}
        <div>
          <p className="mb-1 text-sm font-medium">{m.focusPreview}</p>
          <div className="grid grid-cols-3 items-start gap-2">
            {PREVIEWS.map((p) => (
              <figure key={p.label} className="min-w-0">
                <div className={`overflow-hidden bg-cream ${p.aspect}`}>
                  <img
                    src={imageSrc}
                    alt=""
                    aria-hidden
                    className="h-full w-full object-cover"
                    style={{ objectPosition }}
                  />
                </div>
                <figcaption className="mt-0.5 text-center text-xs text-ink-soft">
                  {p.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>

        {note && (
          <p role="status" className="text-sm text-leaf">
            {note}
          </p>
        )}
      </AdminDialog>
    </>
  );
}
