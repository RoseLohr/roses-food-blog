"use client";

/**
 * Einzelauswahl (natives <select>) mit Inline-Sofortanlage: erlaubt, einen neuen
 * Eintrag direkt hier anzulegen und sofort auszuwählen, ohne die Form zu
 * verlassen. Gegenstück zu QuickAddCheckboxes für Ein-Wert-Referenzen
 * (z. B. Segment einer Kampagne).
 */
import { useId, useState } from "react";
import { t } from "@/i18n/de";
import type { QuickAddKind } from "./quick-add-checkboxes";

const dict = t();

export function QuickAddSelect({
  name,
  label,
  options: initialOptions,
  selectedId,
  kind,
  type,
  emptyLabel,
  disabled = false,
}: {
  name: string;
  label: string;
  options: { id: number; name: string }[];
  selectedId: number | null;
  kind: QuickAddKind;
  type?: string;
  /** Wenn gesetzt: erste Option "keine Auswahl" mit diesem Text. */
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState(initialOptions);
  const [selected, setSelected] = useState<number | null>(selectedId);
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
      const entry: { id: number; name: string; existed?: boolean } =
        await res.json();
      setOptions((prev) =>
        prev.some((o) => o.id === entry.id)
          ? prev
          : [...prev, { id: entry.id, name: entry.name }].sort((a, b) =>
              a.name.localeCompare(b.name, "de"),
            ),
      );
      setSelected(entry.id);
      setValue("");
      if (entry.existed) setMsg(dict.quickAdd.exists);
    } catch {
      setMsg(dict.quickAdd.error);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full border border-ink-soft/30 px-3 py-2 text-sm";

  return (
    <div>
      <label className="mb-1 block text-sm font-medium" htmlFor={`${uid}-sel`}>
        {label}
      </label>
      <select
        id={`${uid}-sel`}
        name={name}
        value={selected ?? ""}
        disabled={disabled}
        onChange={(e) =>
          setSelected(e.target.value ? Number(e.target.value) : null)
        }
        className={inputCls}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {!disabled && (
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
      )}
      {msg && <p className="mt-1 text-xs text-ink-soft">{msg}</p>}
    </div>
  );
}
