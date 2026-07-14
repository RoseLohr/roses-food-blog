"use client";

/**
 * Eingabefeld für den Bild-Dateinamen (bestimmt die URL). Bereinigt die
 * Eingabe schon beim Tippen: Kleinbuchstaben, Umlaut-Transliteration, nur
 * a–z/0–9/„-". Spiegelt die serverseitige Bereinigung fürs Sofort-Feedback.
 */
import { useState } from "react";

const UMLAUT: Record<string, string> = {
  Ä: "ae",
  ä: "ae",
  Ö: "oe",
  ö: "oe",
  Ü: "ue",
  ü: "ue",
  ß: "ss",
};

/** Live-Bereinigung (lässt „-" auch am Ende zu, damit man weitertippen kann). */
export function sanitizeFilenameLive(v: string): string {
  return v
    .replace(/[ÄäÖöÜüß]/g, (c) => UMLAUT[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 60);
}

export function FilenameInput({
  id,
  name,
  placeholder,
  className,
  defaultValue = "",
}: {
  id?: string;
  name: string;
  placeholder?: string;
  className?: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <input
      id={id}
      name={name}
      value={value}
      onChange={(e) => setValue(sanitizeFilenameLive(e.target.value))}
      placeholder={placeholder}
      className={className}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}
