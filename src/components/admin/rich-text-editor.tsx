"use client";

/**
 * Sehr einfacher WYSIWYG-Editor: bearbeitet redaktionelle Inhalte direkt im
 * Theme-Look (contentEditable + .prose-content) und kennt nur die erwarteten
 * Elemente (Fett, Kursiv, Überschriften, Listen, Zitat, Link). Beim Tippen wird
 * der Inhalt in Markdown serialisiert und in ein verstecktes Feld geschrieben —
 * die Serverseite bleibt unverändert (speichert weiter Markdown). Da nur die
 * Whitelist abgebildet wird und der gespeicherte Markdown beim Anzeigen erneut
 * sicher gerendert wird, kann man das Layout nicht „aufbrechen“.
 */
import { useEffect, useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { htmlToMarkdown } from "@/lib/rich-text";
import { t } from "@/i18n/de";

const rt = t().richtext;

export function RichTextEditor({
  name,
  initialMarkdown,
  label,
  readOnly = false,
  minHeightClass = "min-h-40",
  onChange,
}: {
  /** Formularfeldname; ohne wird kein Hidden-Feld gerendert (kontrolliert). */
  name?: string;
  initialMarkdown: string;
  label?: string;
  readOnly?: boolean;
  minHeightClass?: string;
  /** Kontrollierte Nutzung: Markdown bei jeder Änderung nach außen geben. */
  onChange?: (markdown: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [markdown, setMarkdown] = useState(initialMarkdown);

  // Editor aus dem Markdown befüllen — aber NICHT, während der Nutzer darin
  // tippt (sonst springt der Cursor bei kontrollierter Nutzung, z. B.
  // Schritt-Editoren). Beim (Neu-)Mounten ist der Editor nicht fokussiert.
  useEffect(() => {
    if (!ref.current) return;
    if (typeof document !== "undefined" && document.activeElement === ref.current)
      return;
    const html = renderMarkdown(initialMarkdown).trim();
    ref.current.innerHTML = html || "<p><br></p>";
  }, [initialMarkdown]);

  const sync = () => {
    if (ref.current) {
      const md = htmlToMarkdown(ref.current);
      setMarkdown(md);
      onChange?.(md);
    }
  };

  const exec = (command: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, value);
    sync();
  };

  const buttons: Array<{ label: string; title: string; run: () => void }> = [
    { label: "B", title: rt.bold, run: () => exec("bold") },
    { label: "I", title: rt.italic, run: () => exec("italic") },
    { label: "H2", title: rt.heading2, run: () => exec("formatBlock", "H2") },
    { label: "H3", title: rt.heading3, run: () => exec("formatBlock", "H3") },
    { label: "•", title: rt.bulletList, run: () => exec("insertUnorderedList") },
    { label: "1.", title: rt.numberedList, run: () => exec("insertOrderedList") },
    { label: "❝", title: rt.quote, run: () => exec("formatBlock", "BLOCKQUOTE") },
    {
      label: "🔗",
      title: rt.link,
      run: () => {
        const url = window.prompt(rt.linkPrompt, "https://");
        if (url) exec("createLink", url);
      },
    },
    {
      label: "⌫",
      title: rt.clear,
      run: () => {
        exec("removeFormat");
        exec("formatBlock", "P");
      },
    },
  ];

  function handlePaste(e: React.ClipboardEvent) {
    // Nur reinen Text einfügen — kein fremdes HTML, das wir nicht abbilden.
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    sync();
  }

  return (
    <div>
      {label && <span className="mb-1 block text-sm font-medium">{label}</span>}
      {/* Markdown wird versteckt mitgesendet; ohne JS bleibt der Ausgangswert erhalten. */}
      {name && <textarea name={name} value={markdown} readOnly hidden />}
      {!readOnly && (
        <div className="flex flex-wrap gap-1 border border-b-0 border-ink-soft/30 bg-cream/60 p-1">
          {buttons.map((b) => (
            <button
              key={b.title}
              type="button"
              title={b.title}
              aria-label={b.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={b.run}
              className="min-w-[2rem] rounded px-2 py-1 text-sm font-semibold text-ink hover:bg-white"
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={ref}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        onInput={sync}
        onBlur={sync}
        onPaste={handlePaste}
        className={`prose-content ${minHeightClass} max-w-none border border-ink-soft/30 bg-white p-3 focus:outline-none focus:ring-2 focus:ring-rose-primary/40 ${
          readOnly ? "opacity-90" : ""
        }`}
      />
    </div>
  );
}
