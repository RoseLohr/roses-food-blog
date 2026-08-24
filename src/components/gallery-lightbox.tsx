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
import {
  focusPosition,
  imageUrl,
  optimalVariant,
  srcset,
} from "@/lib/media-url";
import type { MediaImageLike } from "./responsive-img";
import { t } from "@/i18n/de";

const dict = t();

/**
 * Ein Bild der Galerie.
 *
 * Die Bildfelder selbst (`fileKey`, Maße, Varianten, Fokuspunkt) sind
 * `MediaImageLike` — dieselbe Form, die `ResponsiveImg` verlangt, und die
 * Galerie reicht ihre Bilder genau dorthin weiter. Sie standen hier bis 08/2026
 * ein zweites Mal ausgeschrieben; zwei Beschreibungen derselben Sache laufen
 * auseinander, sobald eine von beiden ein Feld bekommt.
 */
export interface GalleryImage extends MediaImageLike {
  /**
   * Darstellung DIESES Thumbnails, wenn die Gruppe nicht einheitlich ist.
   *
   * Gebraucht von den Bildern im Fließtext des Reiseberichts: Dort nimmt der
   * KLICK-RAHMEN selbst am Layout teil (er schwebt als Bildplatz im Text oder
   * ist Flex-Kind eines Paares), und jedes Bild hat seine eigene Breite —
   * also auch seine eigene Breitenangabe. `sizes` gehört deshalb neben die
   * Klasse: So kann kein Aufrufer die Breite ändern und die Angabe vergessen,
   * was wieder eine gelogene Breitenangabe wäre.
   *
   * Reine Daten (kein Callback) — die Komponente läuft im Client, die
   * Aufrufer sind Server-Komponenten.
   */
  thumb?: {
    /** Breitenangabe nur für dieses Bild (statt `thumbSizes` der Gruppe). */
    sizes?: string;
    /** Klassen des Klick-Rahmens (Float, Anteil der Spalte, Flex-Kind). */
    frameClassName?: string;
    /** Inline-Stile des Rahmens — z. B. `--ar` für die Verteilung im Paar. */
    frameStyle?: React.CSSProperties;
  };
}

export function GalleryLightbox({
  images,
  thumbSizes,
  thumbClassName,
  groupClassName,
  lead,
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
  /** „Bühne und Streifen": Das ERSTE Foto steht groß allein, die übrigen
   *  darunter im `groupClassName`-Raster. Beide Teile gehören zu EINER
   *  Galerie — das Blättern im Pop-up läuft weiter über die vollständige
   *  Reihe, und der Zähler zählt alle Fotos. Weil die Bühne andere Maße hat
   *  als die Streifen, bringt sie ihr eigenes `sizes` mit (beides zusammen in
   *  EINEM Feld: so kann kein Aufrufer die Klasse setzen und das `sizes`
   *  vergessen — das wäre wieder eine gelogene Breitenangabe). */
  lead?: { className: string; sizes: string };
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
    const objectPosition = focusPosition(im.focusX, im.focusY);
    const istBuehne = lead !== undefined && i === 0;
    return (
      <button
        key={im.fileKey}
        type="button"
        onClick={(e) => {
          openerRef.current = e.currentTarget;
          setOpenIndex(i);
        }}
        // Bringt das Bild eigene Rahmen-Klassen mit, bestimmen SIE die Breite —
        // `w-full` würde ihnen sonst ins Layout reden.
        className={`block cursor-zoom-in ${im.thumb?.frameClassName ?? "w-full"}`}
        style={im.thumb?.frameStyle}
        aria-label={`${label ? `${label}: ` : ""}${im.altText || ""} – ${dict.gallery.zoom}`
          .replace(/\s+–/, " –")
          .trim()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          // src-Fallback: Mittelvariante (nur für Konsumenten ohne srcset) —
          // nie die größte Datei für ein Thumbnail. width/height = echte
          // Originalmaße (Seitenverhältnis fürs Layout, CSS steuert die Größe).
          src={imageUrl(im.fileKey, optimalVariant(widths, 640))}
          srcSet={srcset(im.fileKey, widths)}
          sizes={im.thumb?.sizes ?? (istBuehne ? lead.sizes : thumbSizes)}
          alt={im.altText}
          width={im.width}
          height={im.height}
          loading="lazy"
          decoding="async"
          className={istBuehne ? lead.className : thumbClassName}
          style={objectPosition ? { objectPosition } : undefined}
        />
      </button>
    );
  });

  const current = openIndex !== null ? shown[openIndex] : null;

  // Anordnung der Thumbnails: mit `lead` steht das erste Foto vor der Gruppe,
  // ohne `lead` liegen alle im (optionalen) Gruppen-Wrapper.
  const rest = lead ? thumbs.slice(1) : thumbs;
  const angeordnet = (
    <>
      {lead && thumbs[0]}
      {rest.length > 0 &&
        (groupClassName ? <div className={groupClassName}>{rest}</div> : rest)}
    </>
  );

  return (
    <>
      {angeordnet}

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
              className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-2xl leading-none text-white shadow-lg ring-1 ring-white/70 hover:bg-black/80"
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
                  className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-3xl leading-none text-white shadow-lg ring-1 ring-white/70 hover:bg-black/80 sm:left-6"
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
                  className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-3xl leading-none text-white shadow-lg ring-1 ring-white/70 hover:bg-black/80 sm:right-6"
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
                Klick auf Bild/Unterschrift — keine eigenständige Interaktion. */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
            <figure onClick={(e) => e.stopPropagation()} className="max-w-full">
              <img
                src={imageUrl(
                  current.fileKey,
                  optimalVariant(current.variantWidths, 1280),
                )}
                srcSet={srcset(current.fileKey, current.variantWidths)}
                // Reale Anzeigebreite statt pauschal 100vw: object-contain in
                // max-h-[88vh] deckelt die Breite über das Seitenverhältnis —
                // ein Hochformat-Foto füllt nie den ganzen Schirm. Spart auf
                // Desktop typischerweise eine bis zwei Variantenstufen.
                sizes={`min(calc(100vw - 2rem), calc(88vh * ${(
                  current.width / current.height
                ).toFixed(4)}))`}
                alt={current.altText}
                width={current.width}
                height={current.height}
                className="mx-auto max-h-[88vh] max-w-full object-contain shadow-2xl"
              />
              {current.altText && (
                // Bildunterschrift = Alt-Text. aria-hidden, weil derselbe Text
                // bereits als alt am Bild hängt (keine Doppel-Vorlesung).
                <figcaption
                  aria-hidden
                  className="mx-auto mt-2 max-w-[85vw] text-center text-sm text-white/90"
                >
                  {current.altText}
                </figcaption>
              )}
            </figure>
          </div>,
          document.body,
        )}
    </>
  );
}
