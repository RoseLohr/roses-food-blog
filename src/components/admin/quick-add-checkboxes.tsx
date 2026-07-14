"use client";

/**
 * Checkbox-Gruppe mit Inline-Sofortanlage: Der Nutzer kann einen neuen Eintrag
 * (Kategorie, Schlagwort, Ernährungsform, Interesse, Segment …) direkt hier
 * anlegen, ohne die Seite zu verlassen — die halb ausgefüllte Form bleibt
 * erhalten. Der neue Eintrag erscheint sofort angehakt.
 *
 * Rendert echte <input type="checkbox" name={name}>, submittet also nativ mit
 * der umgebenden Form (kein zusätzlicher State-Transport nötig).
 */
import { useId, useState } from "react";
import { t } from "@/i18n/de";

const dict = t();

export interface Option {
  id: number;
  name: string;
}

export type QuickAddKind =
  | "taxonomy"
  | "interest"
  | "contactTag"
  | "segment"
  | "ingredient";

export function QuickAddCheckboxes({
  name,
  legend,
  options: initialOptions,
  selectedIds,
  kind,
  type,
}: {
  name: string;
  legend: string;
  options: Option[];
  selectedIds: number[];
  kind: QuickAddKind;
  type?: string;
}) {
  const [options, setOptions] = useState<Option[]>(initialOptions);
  const [checked, setChecked] = useState<Set<number>>(new Set(selectedIds));
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const uid = useId();

  async function add() {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, type, name: trimmed }),
      });
      if (!res.ok) throw new Error();
      const entry: Option & { existed?: boolean } = await res.json();
      setOptions((prev) =>
        prev.some((o) => o.id === entry.id)
          ? prev
          : [...prev, { id: entry.id, name: entry.name }].sort((a, b) =>
              a.name.localeCompare(b.name, "de"),
            ),
      );
      setChecked((prev) => new Set(prev).add(entry.id));
      setValue("");
      if (entry.existed) setMsg(dict.quickAdd.exists);
    } catch {
      setMsg(dict.quickAdd.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="max-h-40 overflow-y-auto border border-ink-soft/20 p-2">
        {options.length === 0 && (
          <p className="px-1 py-0.5 text-sm text-ink-soft">—</p>
        )}
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 py-0.5 text-sm">
            <input
              type="checkbox"
              name={name}
              value={o.id}
              defaultChecked={checked.has(o.id)}
            />
            {o.name}
          </label>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <label className="sr-only" htmlFor={`${uid}-new`}>
          {dict.quickAdd.addNew}
        </label>
        <input
          id={`${uid}-new`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={dict.quickAdd.placeholder}
          className="w-full min-w-0 border border-ink-soft/30 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || value.trim() === ""}
          className="shrink-0 rounded-lg border border-leaf/40 bg-leaf-soft/20 px-2.5 py-1 text-sm font-medium text-leaf hover:bg-leaf-soft/40 disabled:opacity-50"
        >
          {busy ? dict.quickAdd.adding : `+ ${dict.quickAdd.add}`}
        </button>
      </div>
      {msg && <p className="mt-1 text-xs text-ink-soft">{msg}</p>}
    </fieldset>
  );
}
