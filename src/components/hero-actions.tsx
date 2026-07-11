"use client";

/**
 * Runde Aktions-Buttons über dem Hero-Bild (Drucken, Teilen) —
 * angelehnt an klassische Rezept-Karten-Layouts.
 */
import { useState } from "react";
import { IconPrinter, IconShare } from "./icons";
import { t } from "@/i18n/de";

const dict = t();

const circle =
  "flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-ink shadow-md transition-colors hover:bg-white hover:text-rose-primary";

export function HeroActions({
  title,
  url,
  printPath,
}: {
  title: string;
  url: string;
  /** ohne Angabe wird kein Druck-Button angezeigt */
  printPath?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (typeof navigator.share === "function") {
      await navigator.share({ title, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard nicht verfügbar */
    }
  }

  return (
    <div className="absolute right-4 top-4 flex gap-2 print:hidden">
      {printPath && (
        <a href={printPath} className={circle} aria-label={dict.recipe.print} title={dict.recipe.print}>
          <IconPrinter className="h-5 w-5" />
        </a>
      )}
      <button
        type="button"
        onClick={share}
        className={circle}
        aria-label={copied ? dict.recipe.copied : dict.recipe.share}
        title={copied ? dict.recipe.copied : dict.recipe.share}
      >
        {copied ? <span className="text-xs font-bold">✓</span> : <IconShare className="h-5 w-5" />}
      </button>
    </div>
  );
}
