"use client";

/**
 * Zutaten-Filter mit Autovervollständigung: statt aller Zutaten als Liste
 * tippt man eine Zutat ein und bekommt ab 2 Zeichen Vorschläge
 * (/api/ingredients/suggest). Ausgewählte Zutaten erscheinen als entfernbare
 * Chips; für jede wird ein verstecktes Feld name="zutat" gerendert, sodass das
 * bestehende GET-Suchformular unverändert danach filtert. Mehrfachauswahl.
 */
import { useEffect, useId, useRef, useState } from "react";
import { t } from "@/i18n/de";

const s = t().search;

interface Ingredient {
  slug: string;
  name: string;
}

export function IngredientFilter({ initial }: { initial: Ingredient[] }) {
  const [selected, setSelected] = useState<Ingredient[]>(initial);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Ingredient[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Debounced Vorschläge laden (ab 2 Zeichen), bereits gewählte ausblenden.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/ingredients/suggest?q=${encodeURIComponent(term)}`,
          { signal: ctrl.signal },
        );
        const data = (await res.json()) as { items?: Ingredient[] };
        const list = (data.items ?? []).filter(
          (it) => !selected.some((x) => x.slug === it.slug),
        );
        setItems(list);
        setActive(-1);
        setOpen(list.length > 0);
      } catch {
        /* abgebrochen/Fehler — ignorieren */
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, selected]);

  // Klick außerhalb schließt die Vorschlagsliste.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function add(it: Ingredient) {
    setSelected((prev) =>
      prev.some((x) => x.slug === it.slug) ? prev : [...prev, it],
    );
    setQ("");
    setItems([]);
    setOpen(false);
  }
  function remove(slug: string) {
    setSelected((prev) => prev.filter((x) => x.slug !== slug));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      if (items.length) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && items.length) {
        e.preventDefault();
        add(items[active >= 0 ? active : 0]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef}>
      <span className="mb-1 block text-sm font-semibold">{s.ingredients}</span>

      {/* Versteckte Felder fürs Suchformular */}
      {selected.map((x) => (
        <input key={x.slug} type="hidden" name="zutat" value={x.slug} />
      ))}

      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((x) => (
            <li key={x.slug}>
              <button
                type="button"
                onClick={() => remove(x.slug)}
                className="flex items-center gap-1 rounded-full border border-leaf/40 bg-leaf-soft/15 px-2.5 py-0.5 text-xs font-medium text-leaf hover:bg-leaf hover:text-white"
                aria-label={`${x.name} ${s.ingredientRemove}`}
              >
                {x.name}
                <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => items.length && setOpen(true)}
          placeholder={s.ingredientSearchPlaceholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="w-full border border-ink-soft/30 px-3 py-2 text-base"
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto border border-ink/15 bg-white shadow-lg"
          >
            {items.map((it, i) => (
              <li key={it.slug} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(it);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    i === active ? "bg-leaf-soft/25 text-leaf" : "hover:bg-cream"
                  }`}
                >
                  {it.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
