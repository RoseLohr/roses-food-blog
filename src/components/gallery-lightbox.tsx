"use client";

/**
 * Wiederverwendbare Bild-Galerie mit Lightbox (öffentlich, Client).
 *
 * Rendert eine oder mehrere Foto-Thumbnails (responsiv, `srcSet`+`sizes` wie
 * `ResponsiveImg`) als klickbare Buttons. Ein Klick öffnet das Bild groß in
 * einem Overlay (Portal). Bei mehreren Bildern gibt es Vor/Zurück-Pfeile,
 * Pfeiltasten links/rechts und einen Zähler „2 von 3". Escape oder Klick auf
 * den Hintergrund schließt.
 *
 * Genutzt für Restaurant-Fotos (Einzelbild → nur Zoom) und Gericht-Fotos
 * (mehrere Bilder → durchblätterbar). Die Thumbnail-Anordnung bleibt beim
 * Aufrufer (className/Grid), damit das bestehende Layout unverändert bleibt.
 *
 * A11y: Solange das Overlay offen ist, wird der Fokus IN den Dialog geholt und
 * dort gefangen (Fokusfalle) — Hintergrund-Bedienelemente sind per Tab nicht
 * erreichbar (aria-modal). Beim Schließen kehrt der Fokus auf das öffnende
 * Thumbnail zurück. Die Body-Scroll-Sperre stellt den VORHERIGEN overflow-Wert
 * wieder her (kein Überschreiben einer fremden Sperre).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { imageUrl, srcset } from "@/lib/image-url";
import { t } from "@/i18n/de";

const dict = t();

export interface GalleryImage {
  fileKey: string;
  altText: string;
  width: number;
  height: number;
  /** Verfügbare Varianten-Breiten, aufsteigend (aus media_variant). */
  variantWidths: number[];
}

export function GalleryLightbox({
  images,
  thumbSizes,
  thumbClassName,
  groupClassName,
  label,
}: {
  images: GalleryImage[];
  /** `sizes`-Attribut der Thumbnails — Pflicht, weil `srcSet` gesetzt wird. */
  thumbSizes: string;
  /** Klassen je Thumbnail-`<img>` (Format/Objektpassung). */
  thumbClassName?: string;
  /** Optionaler Wrapper um mehrere Thumbnails (z. B. Grid/Stack). Bei einem
   *  einzelnen Bild weglassen → das Thumbnail steht ohne Zusatz-Wrapper. */
  groupClassName?: string;
  /** Kontext fürs Vorlese-Label, z. B. Gericht-/Restaurantname. */
  label?: string;
}) {
  // Nur Bilder mit Varianten sind darstellbar (identisch zu ResponsiveImg).
  const shown = images.filter((im) => im.variantWidths.length > 0);
  const count = shown.length;
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const isOpen = openIndex !== null;

  const dialogRef = useRef<HTMLDivElement>(null);
  // Element, das den Dialog geöffnet hat — dorthin kehrt der Fokus zurück.
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const prev = useCallback(
    () => setOpenIndex((i) => (i === null ? i : (i - 1 + count) % count)),
    [count],
  );
  const next = useCallback(
    () => setOpenIndex((i) => (i === null ? i : (i + 1) % count)),
    [count],
  );

  // Effekt an `isOpen` (nicht an `openIndex`) gekoppelt: Blättern re-initialisiert
  // Fokus/Sperre NICHT, nur Öffnen/Schließen.
  useEffect(() => {
    if (!isOpen) return;
    const opener = openerRef.current;
    const dialog = dialogRef.current;

    // Body-Scroll sperren, aber den vorherigen Inline-Wert merken + zurückgeben.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = (): HTMLElement[] =>
      dialog ? Array.from(dialog.querySelectorAll<HTMLElement>("button")) : [];
    // Fokus in den Dialog holen (erster Button = Schließen).
    focusables()[0]?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key === "ArrowLeft") {
        prev();
        return;
      }
      if (e.key === "ArrowRight") {
        next();
        return;
      }
      if (e.key === "Tab") {
        // Fokusfalle: Tab zirkuliert nur innerhalb des Dialogs.
        const els = focusables();
        if (els.length === 0) {
          e.preventDefault();
          return;
        }
        const first = els[0];
        const last = els[els.length - 1];
        const active = document.activeElement;
        const inside = dialog?.contains(active as Node) ?? false;
        if (e.shiftKey) {
          if (!inside || active === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (!inside || active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Fokus zurück auf das öffnende Thumbnail.
      opener?.focus();
    };
  }, [isOpen, close, prev, next]);

  if (count === 0) return null;

  const thumbs = shown.map((im, i) => {
    const widths = im.variantWidths;
    const largest = widths[widths.length - 1];
    const displayHeight = Math.round((largest / im.width) * im.height);
    return (
      <button
        key={im.fileKey}
        type="button"
        onClick={(e) => {
          openerRef.current = e.currentTarget;
          setOpenIndex(i);
        }}
        className="block w-full cursor-zoom-in"
        aria-label={`${label ? `${label}: ` : ""}${im.altText || ""} – ${dict.gallery.zoom}`
          .replace(/\s+–/, " –")
          .trim()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl(im.fileKey, largest)}
          srcSet={srcset(im.fileKey, widths)}
          sizes={thumbSizes}
          alt={im.altText}
          width={largest}
          height={displayHeight}
          loading="lazy"
          decoding="async"
          className={thumbClassName}
        />
      </button>
    );
  });

  const current = openIndex !== null ? shown[openIndex] : null;

  return (
    <>
      {groupClassName ? <div className={groupClassName}>{thumbs}</div> : thumbs}

      {current &&
        createPortal(
          // a11y-Ausnahme (begründet): Der Klick auf den Hintergrund schließt nur
          // ZUSÄTZLICH; die Tastaturpfade sind der Schließen-Button und Escape
          // (globaler keydown). Pfeiltasten blättern, Tab bleibt im Dialog.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={dict.gallery.dialogLabel}
            onClick={close}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          >
            <button
              type="button"
              onClick={close}
              aria-label={dict.gallery.close}
              className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white hover:bg-white/30"
            >
              ×
            </button>

            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    prev();
                  }}
                  aria-label={dict.gallery.prev}
                  className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl leading-none text-white hover:bg-white/30 sm:left-6"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    next();
                  }}
                  aria-label={dict.gallery.next}
                  className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-3xl leading-none text-white hover:bg-white/30 sm:right-6"
                >
                  ›
                </button>
                <p
                  aria-live="polite"
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white"
                >
                  {dict.gallery.counter(openIndex! + 1, count)}
                </p>
              </>
            )}

            {/* a11y-Ausnahme (begründet): onClick verhindert nur das Schließen beim
                Klick aufs Bild selbst — keine eigenständige Interaktion. */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
            <img
              src={imageUrl(
                current.fileKey,
                current.variantWidths[current.variantWidths.length - 1],
              )}
              srcSet={srcset(current.fileKey, current.variantWidths)}
              sizes="100vw"
              alt={current.altText}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[92vh] max-w-full object-contain shadow-2xl"
            />
          </div>,
          document.body,
        )}
    </>
  );
}
