"use client";

/**
 * Einklappbares Inhaltsverzeichnis für Reiseberichte (Vorbild: klassisches
 * „Inhalt [Verbergen]"): nummerierte Einträge (1, 1.1 …) in Teal, Klick
 * springt per Anker zur Stelle (sanftes Scrollen via CSS scroll-behavior).
 */
import { useState } from "react";

export interface TocEntry {
  id: string;
  label: string;
  children: Array<{ id: string; label: string }>;
}

export function TravelToc({
  title,
  hideLabel,
  showLabel,
  entries,
}: {
  title: string;
  hideLabel: string;
  showLabel: string;
  entries: TocEntry[];
}) {
  const [open, setOpen] = useState(true);
  if (entries.length === 0) return null;

  return (
    <nav aria-label={title} className="my-6">
      <p className="flex items-baseline gap-2">
        <span className="text-lg font-bold">{title}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-sm text-leaf hover:underline"
        >
          [ {open ? hideLabel : showLabel} ]
        </button>
      </p>
      {open && (
        <ol className="mt-3 flex flex-col gap-1.5">
          {entries.map((entry, i) => (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                className="text-leaf hover:underline"
              >
                <span className="mr-1.5 tabular-nums">{i + 1}</span>
                {entry.label}
              </a>
              {entry.children.length > 0 && (
                <ol className="mt-1 flex flex-col gap-1 pl-5">
                  {entry.children.map((child, j) => (
                    <li key={child.id}>
                      <a
                        href={`#${child.id}`}
                        className="text-leaf hover:underline"
                      >
                        <span className="mr-1.5 tabular-nums">
                          {i + 1}.{j + 1}
                        </span>
                        {child.label}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
