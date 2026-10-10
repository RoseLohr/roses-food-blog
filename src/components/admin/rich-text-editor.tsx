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
import { useCallback, useEffect, useRef } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { htmlToMarkdown } from "@/lib/rich-text";
import { t } from "@/i18n/de";

const rt = t().richtext;

/** Was beobachtet wird. Einmal benannt, damit Anhalten und Wieder-Anhängen
 *  nicht auseinanderlaufen können. */
const BEOBACHTET: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
};

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
  // Der Formularwert lebt bewusst DIREKT (unkontrolliert) im Hidden-Feld und wird
  // bei JEDER Inhaltsänderung imperativ geschrieben — NICHT über React-State.
  // Damit hängt der abgeschickte Wert nicht am React-Render-/Flush- oder
  // Event-Timing (auf iOS/Safari sonst die Ursache für „Kurzbeschreibung wird
  // nicht gespeichert"), sondern steht immer aktuell im DOM.
  const hiddenRef = useRef<HTMLTextAreaElement>(null);
  // onChange stabil halten, damit der Beobachter unten [] als Deps nutzen kann.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Der Beobachter in einer Ref, damit der Füll-Effekt ihn anhalten kann —
  // siehe die Begründung an jenem Effekt.
  const beobachterRef = useRef<MutationObserver | null>(null);

  // Editor-Inhalt → Markdown → Hidden-Feld (+ onChange). Rein imperativ.
  const sync = useCallback(() => {
    if (!ref.current) return;
    const md = htmlToMarkdown(ref.current);
    if (hiddenRef.current) hiddenRef.current.value = md;
    onChangeRef.current?.(md);
  }, []);

  // Editor aus dem Markdown befüllen — aber NICHT, während der Nutzer darin
  // tippt (sonst springt der Cursor bei kontrollierter Nutzung, z. B.
  // Schritt-Editoren). Beim (Neu-)Mounten ist der Editor nicht fokussiert.
  //
  // DER BEOBACHTER WIRD DABEI ANGEHALTEN — und das ist kein Feinschliff:
  //
  // Beim Mounten laufen die Effekte der Reihe nach, dieser hier ZUERST. Das
  // Befüllen passiert also, bevor unten `observe()` steht, und bleibt
  // unbemerkt. Bei jedem SPÄTEREN Wechsel von `initialMarkdown` ist der
  // Beobachter aber längst angehängt (seine Abhängigkeit `sync` ist stabil, er
  // wird nie neu aufgesetzt). Er meldet das Befüllen dann als Inhaltsänderung,
  // `sync()` liest den Text aus dem DOM ZURÜCK nach Markdown und reicht ihn
  // über `onChange` nach außen — der Aufrufer speichert also nicht mehr das,
  // was er hereingegeben hat, sondern das Ergebnis eines Umwegs md → HTML → md.
  // Dieser Umweg ist NICHT verlustfrei: Gemessen an echtem Chromium
  // verschwindet ein `![alt](url)` im Text vollständig, und aus einer
  // verschachtelten Liste wird eine flache. Beim Rezept-Editor landete das
  // über das versteckte Feld in der Datenbank — stiller Inhaltsverlust, ohne
  // dass jemand den Text angefasst hätte.
  //
  // `disconnect()` leert auch die noch nicht zugestellten Einträge; deshalb
  // genügt Anhalten → schreiben → wieder anhängen, ohne Merker und ohne
  // `takeRecords()`.
  useEffect(() => {
    if (!ref.current) return;
    if (typeof document !== "undefined" && document.activeElement === ref.current)
      return;
    const html = renderMarkdown(initialMarkdown).trim();
    beobachterRef.current?.disconnect();
    ref.current.innerHTML = html || "<p><br></p>";
    if (hiddenRef.current) hiddenRef.current.value = initialMarkdown;
    if (beobachterRef.current) beobachterRef.current.observe(ref.current, BEOBACHTET);
  }, [initialMarkdown]);

  // Kern des Fixes: ein MutationObserver spiegelt JEDE Inhaltsänderung des Editors
  // (Tippen, Formatieren, Einfügen, auch programmatisch) sofort ins Hidden-Feld —
  // unabhängig davon, ob input/blur feuern oder React neu rendert. Das macht den
  // abgeschickten Wert robust gegen das Event-/Flush-Timing (u. a. iOS/Safari).
  // Ausgenommen ist allein das Befüllen oben: Das ist keine Eingabe, sondern
  // dieser Editor, der seine eigene Vorgabe übernimmt.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => sync());
    beobachterRef.current = obs;
    obs.observe(el, BEOBACHTET);
    return () => {
      obs.disconnect();
      beobachterRef.current = null;
    };
  }, [sync]);

  // Zusätzliches Sicherheitsnetz: unmittelbar vor dem Absenden erneut
  // synchronisieren (Capture-Phase), falls eine Änderung noch nicht gespiegelt war.
  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form || !name) return;
    const onSubmit = () => sync();
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, [name, sync]);

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
      {/* Markdown wird versteckt mitgesendet; ohne JS bleibt der Ausgangswert
          erhalten. Unkontrolliert (defaultValue) + imperativer .value-Schreib in
          sync()/onSubmit — s. Kommentar oben. */}
      {name && (
        <textarea
          ref={hiddenRef}
          name={name}
          defaultValue={initialMarkdown}
          readOnly
          hidden
        />
      )}
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
