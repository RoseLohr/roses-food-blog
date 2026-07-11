"use client";

/**
 * Datenschutzfreundliches Teilen (A8): Web Share API, Link kopieren,
 * mailto — keine externen Skripte.
 */
import { useState } from "react";
import { t } from "@/i18n/de";

const dict = t();

export function ShareButtons({
  title,
  url,
  printPath,
}: {
  title: string;
  url: string;
  /** Pfad zur dedizierten Druckansicht; ohne Angabe wird die Seite selbst gedruckt */
  printPath?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const btn =
    "rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-cream";

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {canShare && (
        <button
          type="button"
          className={btn}
          onClick={() => navigator.share({ title, url }).catch(() => {})}
        >
          {dict.recipe.share}
        </button>
      )}
      <button
        type="button"
        className={btn}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* Clipboard nicht verfügbar */
          }
        }}
      >
        {copied ? dict.recipe.copied : dict.recipe.copyLink}
      </button>
      <a
        className={btn}
        href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`}
      >
        {dict.recipe.shareByEmail}
      </a>
      {printPath ? (
        <a className={btn} href={printPath}>
          {dict.recipe.print}
        </a>
      ) : (
        <button type="button" className={btn} onClick={() => window.print()}>
          {dict.recipe.print}
        </button>
      )}
    </div>
  );
}
