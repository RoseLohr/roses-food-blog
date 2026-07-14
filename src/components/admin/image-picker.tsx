"use client";

/**
 * Bildauswahl mit Inline-Upload: zeigt vorhandene Bilder als Thumbnail-Raster
 * und erlaubt, direkt hier ein neues Bild hochzuladen — ohne die Form zu
 * verlassen. Das frisch hochgeladene Bild erscheint sofort als Vorschau und ist
 * ausgewählt.
 *
 * Zwei Betriebsarten:
 * - Unkontrolliert (Standard): `name` + `selectedIds` angeben. Die Auswahl wird
 *   intern gehalten und je Auswahl als <input type="hidden" name={name}>
 *   gerendert — funktioniert mit bestehenden Server-Actions unverändert
 *   (multiple=false -> get(), multiple=true -> getAll()).
 * - Kontrolliert: `value` + `onChange` angeben (z. B. für Zustände, die als JSON
 *   serialisiert werden — etwa Gericht-Bilder im Reise-Editor). Dann werden
 *   keine Hidden-Felder gerendert.
 */
import { useId, useState } from "react";
import { t } from "@/i18n/de";

const dict = t();

export interface ImageChoice {
  id: number;
  label: string;
  thumbUrl: string;
}

export function ImagePicker({
  name,
  legend,
  options: initialOptions,
  selectedIds,
  value,
  onChange,
  multiple,
  clearable = true,
}: {
  name?: string;
  legend: string;
  options: ImageChoice[];
  selectedIds?: number[];
  value?: number[];
  onChange?: (ids: number[]) => void;
  multiple: boolean;
  /** Nur Einzelauswahl: erlaubt das Abwählen ("Kein Bild"). Default true. */
  clearable?: boolean;
}) {
  const controlled = onChange !== undefined;
  const [options, setOptions] = useState<ImageChoice[]>(initialOptions);
  const [internalSel, setInternalSel] = useState<number[]>(selectedIds ?? []);
  const selected = controlled ? (value ?? []) : internalSel;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const uid = useId();

  function setSelection(next: number[]) {
    if (controlled) onChange(next);
    else setInternalSel(next);
  }

  function toggle(id: number) {
    if (multiple) {
      setSelection(
        selected.includes(id)
          ? selected.filter((x) => x !== id)
          : [...selected, id],
      );
    } else if (selected.includes(id)) {
      // Aktives Bild erneut angeklickt: abwählen nur, wenn erlaubt.
      if (clearable) setSelection([]);
    } else {
      setSelection([id]);
    }
  }

  async function upload(file: File) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("datei", file);
      const res = await fetch("/api/admin/media", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      const img: ImageChoice = await res.json();
      setOptions((prev) => [
        { id: img.id, label: img.label, thumbUrl: img.thumbUrl },
        ...prev,
      ]);
      setSelection(multiple ? [...selected, img.id] : [img.id]);
    } catch {
      setMsg(dict.quickAdd.uploadError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {!controlled &&
        name &&
        selected.map((id) => (
          <input key={id} type="hidden" name={name} value={id} />
        ))}

      {options.length > 0 && (
        <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto border border-ink-soft/20 p-2 sm:grid-cols-4">
          {options.map((o) => {
            const active = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.id)}
                aria-pressed={active}
                title={o.label}
                className={`group relative aspect-square overflow-hidden rounded-lg border-2 transition ${
                  active
                    ? "border-rose-primary ring-2 ring-rose-primary/30"
                    : "border-transparent hover:border-ink-soft/40"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={o.thumbUrl}
                  alt={o.label}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                {active && (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-primary text-xs font-bold text-white">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-2">
        <label
          htmlFor={`${uid}-upload`}
          className={`cursor-pointer rounded-lg border border-leaf/40 bg-leaf-soft/20 px-2.5 py-1 text-sm font-medium text-leaf hover:bg-leaf-soft/40 ${
            busy ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {busy ? dict.quickAdd.uploading : `+ ${dict.quickAdd.uploadNew}`}
        </label>
        <input
          id={`${uid}-upload`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
        {!multiple && clearable && selected.length > 0 && (
          <button
            type="button"
            onClick={() => setSelection([])}
            className="text-sm text-ink-soft underline-offset-2 hover:underline"
          >
            {dict.quickAdd.noImage}
          </button>
        )}
      </div>
      {msg && <p className="mt-1 text-xs text-red-700">{msg}</p>}
    </fieldset>
  );
}
