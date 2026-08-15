"use client";

/**
 * Einklappbares Inhaltsverzeichnis für Reiseberichte (Vorbild: klassisches
 * „Inhalt [Verbergen]"): nummerierte Einträge in Teal über bis zu drei
 * Ebenen (1, 1.1, 1.1.1 — z. B. Abschnitt → Restaurant → Gericht), Klick
 * springt per Anker zur Stelle (sanftes Scrollen via CSS scroll-behavior).
 */
import { useState } from "react";

export interface TocLeaf {
  id: string;
  label: string;
}

export interface TocChild extends TocLeaf {
  children?: TocLeaf[];
}

export interface TocEntry extends TocLeaf {
  children: TocChild[];
}

function TocLink({ id, num, label }: { id: string; num: string; label: string }) {
  return (
    <a href={`#${id}`} className="text-leaf hover:underline">
      <span className="mr-1.5 tabular-nums">{num}</span>
      {label}
    </a>
  );
}

export function TravelToc({
  title,
  hideLabel,
  showLabel,
  entries,
  className = "",
}: {
  title: string;
  hideLabel: string;
  showLabel: string;
  entries: TocEntry[];
  /** Positionierung und Breite kommen vom Aufrufer — nur der weiß, ob das
   *  Verzeichnis als umflossener Block oder gestapelt steht. Farbe, Rahmen
   *  und Innenabstand bleiben hier. */
  className?: string;
}) {
  const [open, setOpen] = useState(true);
  if (entries.length === 0) return null;

  return (
    // Hinterlegt mit einem sehr hellen Ton der Marken-Farbe (--color-leaf,
    // #277a70) bei 6 % Deckung, umrandet bei 15 %. Bewusst aus der bestehenden
    // Palette abgeleitet statt als neuer Farbwert: so bleibt EINE Quelle der
    // Wahrheit, und ein späterer Wechsel des Markentons zieht das Verzeichnis
    // mit. Der Text bleibt auf Weiß-über-Tint bei vollem Kontrast.
    <nav
      aria-label={title}
      className={`rounded-sm border border-leaf/15 bg-leaf/[0.06] p-4 ${className}`}
    >
      {/* flex-wrap + nowrap am Knopf: In der schmalen Seitenspalte passt
          „[ Verbergen ]" nicht neben den Titel. Ohne diese beiden Klassen
          bricht der Browser INNERHALB des Knopfes um („[", „Verbergen", „]"
          auf drei Zeilen); so rutscht er stattdessen als Ganzes eine Zeile
          tiefer und steht auf breiten Spalten weiterhin daneben. */}
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-lg font-bold">{title}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="whitespace-nowrap text-sm text-leaf hover:underline"
        >
          [ {open ? hideLabel : showLabel} ]
        </button>
      </p>
      {open && (
        <ol className="mt-3 flex flex-col gap-1.5">
          {entries.map((entry, i) => (
            <li key={entry.id}>
              <TocLink id={entry.id} num={`${i + 1}`} label={entry.label} />
              {entry.children.length > 0 && (
                <ol className="mt-1 flex flex-col gap-1 pl-5">
                  {entry.children.map((child, j) => (
                    <li key={child.id}>
                      <TocLink
                        id={child.id}
                        num={`${i + 1}.${j + 1}`}
                        label={child.label}
                      />
                      {child.children && child.children.length > 0 && (
                        <ol className="mt-1 flex flex-col gap-1 pl-5">
                          {child.children.map((leaf, k) => (
                            <li key={leaf.id}>
                              <TocLink
                                id={leaf.id}
                                num={`${i + 1}.${j + 1}.${k + 1}`}
                                label={leaf.label}
                              />
                            </li>
                          ))}
                        </ol>
                      )}
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
