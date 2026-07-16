"use client";

/**
 * Checkbox-Gruppe mit Inline-Sofortanlage: Der Nutzer kann einen neuen Eintrag
 * (Kategorie, Schlagwort, Ernährungsform, Interesse, Segment …) direkt hier
 * anlegen, ohne die Seite zu verlassen — die halb ausgefüllte Form bleibt
 * erhalten. Der neue Eintrag erscheint sofort angehakt.
 *
 * Zwei Betriebsarten (wie ImagePicker):
 * - Unkontrolliert (name + selectedIds): rendert echte
 *   <input type="checkbox" name={name}>, submittet nativ mit der Form.
 * - Kontrolliert (value + onChange): Auswahl lebt im State des Aufrufers
 *   (z. B. Reise-Editor, der Gerichte als JSON serialisiert).
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
  selectedIds = [],
  kind,
  type,
  value,
  onChange,
}: {
  name?: string;
  legend: string;
  options: Option[];
  selectedIds?: number[];
  kind: QuickAddKind;
  type?: string;
  /** Kontrollierter Modus: aktuelle Auswahl (statt selectedIds). */
  value?: number[];
  /** Kontrollierter Modus: Auswahl geändert. */
  onChange?: (ids: number[]) => void;
}) {
  const controlled = value !== undefined && onChange !== undefined;
  const [options, setOptions] = useState<Option[]>(initialOptions);
  const [checked, setChecked] = useState<Set<number>>(new Set(selectedIds));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const uid = useId();

  const isChecked = (id: number) =>
    controlled ? value.includes(id) : checked.has(id);
  const toggle = (id: number, on: boolean) => {
    if (controlled) {
      onChange(on ? [...value, id] : value.filter((x) => x !== id));
    } else {
      setChecked((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    }
  };

  async function add() {
    const trimmed = input.trim();
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
      if (controlled) {
        if (!value.includes(entry.id)) onChange([...value, entry.id]);
      } else {
        setChecked((prev) => new Set(prev).add(entry.id));
      }
      setInput("");
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
              name={controlled ? undefined : name}
              value={o.id}
              {...(controlled
                ? {
                    checked: isChecked(o.id),
                    onChange: (e) => toggle(o.id, e.target.checked),
                  }
                : { defaultChecked: checked.has(o.id) })}
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
          disabled={busy || input.trim() === ""}
          className="shrink-0 rounded-lg border border-leaf/40 bg-leaf-soft/20 px-2.5 py-1 text-sm font-medium text-leaf hover:bg-leaf-soft/40 disabled:opacity-50"
        >
          {busy ? dict.quickAdd.adding : `+ ${dict.quickAdd.add}`}
        </button>
      </div>
      {msg && <p className="mt-1 text-xs text-ink-soft">{msg}</p>}
    </fieldset>
  );
}
