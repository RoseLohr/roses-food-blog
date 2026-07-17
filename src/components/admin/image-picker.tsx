"use client";

/**
 * Bildauswahl über ein Pop-up (Medienbibliothek):
 * - Im Formular ist nur das/die aktuell gewählte(n) Bild(er) als Vorschau
 *   sichtbar — nicht die ganze Bibliothek.
 * - Ein Button öffnet ein Modal mit dem kompletten Bildraster zum Auswählen
 *   und einem Upload-Bereich (optionaler Dateiname für die URL + Beschreibung).
 *
 * Zwei Betriebsarten (unverändert):
 * - Unkontrolliert: `name` + `selectedIds` → versteckte Felder je Auswahl.
 * - Kontrolliert: `value` + `onChange` (keine Hidden-Felder).
 */
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n/de";

const dict = t();
const ip = dict.imagePicker;

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
  const [open, setOpen] = useState(false);

  function setSelection(next: number[]) {
    if (controlled) onChange(next);
    else setInternalSel(next);
  }

  function pick(id: number) {
    if (multiple) {
      setSelection(
        selected.includes(id)
          ? selected.filter((x) => x !== id)
          : [...selected, id],
      );
    } else {
      setSelection([id]);
      setOpen(false);
    }
  }

  const byId = new Map(options.map((o) => [o.id, o]));
  const selectedChoices = selected
    .map((id) => byId.get(id))
    .filter((x): x is ImageChoice => Boolean(x));

  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {!controlled &&
        name &&
        selected.map((id) => (
          <input key={id} type="hidden" name={name} value={id} />
        ))}

      {/* Vorschau der aktuellen Auswahl */}
      {selectedChoices.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {selectedChoices.map((c) => (
            <div
              key={c.id}
              className="group relative h-24 w-32 overflow-hidden border border-ink-soft/20 bg-cream"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.thumbUrl}
                alt={c.label}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => setSelection(selected.filter((x) => x !== c.id))}
                aria-label={ip.remove}
                title={ip.remove}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-sm text-white opacity-0 transition group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-2 text-sm text-ink-soft">{ip.none}</p>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-leaf/40 bg-leaf-soft/20 px-3 py-1.5 text-sm font-medium text-leaf hover:bg-leaf-soft/40"
      >
        {multiple
          ? ip.chooseMultiple
          : selectedChoices.length > 0
            ? ip.change
            : ip.choose}
      </button>

      {open && (
        <LibraryModal
          legend={legend}
          options={options}
          selected={selected}
          multiple={multiple}
          clearable={clearable}
          onPick={pick}
          onClear={() => setSelection([])}
          onClose={() => setOpen(false)}
          onUploaded={(img) => {
            setOptions((prev) =>
              prev.some((o) => o.id === img.id) ? prev : [img, ...prev],
            );
            if (multiple) {
              if (!selected.includes(img.id))
                setSelection([...selected, img.id]);
            } else {
              setSelection([img.id]);
              setOpen(false);
            }
          }}
        />
      )}
    </fieldset>
  );
}

function LibraryModal({
  legend,
  options,
  selected,
  multiple,
  clearable,
  onPick,
  onClear,
  onClose,
  onUploaded,
}: {
  legend: string;
  options: ImageChoice[];
  selected: number[];
  multiple: boolean;
  clearable: boolean;
  onPick: (id: number) => void;
  onClear: () => void;
  onClose: () => void;
  onUploaded: (img: ImageChoice) => void;
}) {
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function upload(file: File) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("datei", file);
      if (desc.trim()) fd.append("altText", desc.trim());
      const res = await fetch("/api/admin/media", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        id?: number;
        label?: string;
        thumbUrl?: string;
        error?: string;
      };
      if (!res.ok) {
        setErr(data.error || dict.quickAdd.uploadError);
        return;
      }
      if (data.id && data.thumbUrl) {
        onUploaded({
          id: data.id,
          label: data.label ?? "",
          thumbUrl: data.thumbUrl,
        });
        setDesc("");
      }
    } catch {
      setErr(dict.quickAdd.uploadError);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    // a11y-Ausnahme (begründet): Klick auf den Backdrop schließt nur zusätzlich.
    // Tastatur: Escape (globaler keydown-Handler) und der Schließen-Button.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${ip.title}: ${legend}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col bg-white shadow-xl">
        {/* Kopf */}
        <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
          <h2 className="font-display text-lg font-bold">{ip.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={ip.close}
            className="flex h-9 w-9 items-center justify-center text-xl text-ink-soft hover:text-ink"
          >
            ×
          </button>
        </div>

        {/* Upload */}
        <div className="border-b border-ink/10 bg-cream/40 px-4 py-3">
          <p className="mb-2 text-sm font-medium">{ip.uploadTitle}</p>
          <label className="block text-xs text-ink-soft">
            {ip.description}
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={ip.descriptionPlaceholder}
              className="mt-1 w-full border border-ink-soft/30 bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <label
              htmlFor={`${uid}-file`}
              className={`cursor-pointer rounded-lg border border-leaf/40 bg-leaf-soft/20 px-2.5 py-1 text-sm font-medium text-leaf hover:bg-leaf-soft/40 ${
                busy ? "pointer-events-none opacity-50" : ""
              }`}
            >
              {busy ? dict.quickAdd.uploading : ip.chooseFile}
            </label>
            <input
              id={`${uid}-file`}
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
          </div>
          {err && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {err}
            </p>
          )}
        </div>

        {/* Bildraster */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {options.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-soft">{ip.empty}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {options.map((o) => {
                const active = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onPick(o.id)}
                    aria-pressed={active}
                    title={o.label}
                    className={`group relative aspect-square overflow-hidden border-2 transition ${
                      active
                        ? "border-leaf ring-2 ring-leaf/30"
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
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-leaf text-xs font-bold text-white">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Fuß */}
        <div className="flex items-center justify-between gap-3 border-t border-ink/10 px-4 py-3">
          <span className="text-xs text-ink-soft">
            {multiple
              ? ip.selectedCount(selected.length)
              : selected.length > 0
                ? "1 ausgewählt"
                : ip.none}
          </span>
          <div className="flex items-center gap-3">
            {clearable && selected.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="text-sm text-ink-soft underline-offset-2 hover:underline"
              >
                {dict.quickAdd.noImage}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-rose-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-primary-dark"
            >
              {ip.done}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
