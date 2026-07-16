"use client";

/**
 * Klickbares Thumbnail in der Medienbibliothek: öffnet das Bild in großer
 * Auflösung als Lightbox (Overlay). Escape oder Klick schließt.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n/de";

const dict = t();

export function MediaThumb({
  thumbUrl,
  fullUrl,
  alt,
  className,
}: {
  thumbUrl: string;
  fullUrl: string;
  alt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full cursor-zoom-in"
        aria-label={`${alt || dict.admin.media.title} – ${dict.admin.media.viewLarge}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={className}
        />
      </button>

      {open &&
        createPortal(
          // a11y-Ausnahme (begründet): Klick schließt nur zusätzlich; Tastatur
          // über Escape (globaler keydown) und den Schließen-Button.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
          <div
            role="dialog"
            aria-modal="true"
            aria-label={dict.admin.media.viewLarge}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          >
            <button
              type="button"
              aria-label={dict.imagePicker.close}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/30"
            >
              ×
            </button>
            {/* a11y-Ausnahme (begründet): onClick verhindert nur das Schließen
                beim Klick aufs Bild selbst; keine eigenständige Interaktion. */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
            <img
              src={fullUrl}
              alt={alt}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[92vh] max-w-full object-contain shadow-2xl"
            />
          </div>,
          document.body,
        )}
    </>
  );
}
