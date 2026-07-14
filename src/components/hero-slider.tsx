"use client";

/**
 * Startseiten-Hero im Tiny-Salt-Look („slider-style-2"):
 * - Vollflächiges Bild mit dunklem Overlay, mittig Kategorie (grün),
 *   Playfair-Titel und Like-Meta.
 * - Runde Vor/Zurück-Pfeile.
 * - Darunter eine synchronisierte Thumbnail-Leiste (aktives Bild hell mit
 *   weißem Rahmen, inaktive abgedunkelt), die den Rand überlappt.
 * Bedienbar per Maus, Tastatur (Pfeiltasten + Buttons) und mit Auto-Wechsel,
 * der pausierbar ist und bei prefers-reduced-motion automatisch stoppt.
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CompactLike } from "@/components/compact-like";
import { t } from "@/i18n/de";

const dict = t();

export interface SlideData {
  id: number;
  /** Rezept-ID des verlinkten Rezepts (für Likes); null wenn nicht verlinkt. */
  recipeId: number | null;
  imgSrc: string;
  imgSrcSet: string;
  alt: string;
  caption: string;
  href: string | null;
  category?: string | null;
  likeCount?: number | null;
}

export function HeroSlider({
  slides,
  intervalSeconds,
}: {
  slides: SlideData[];
  intervalSeconds: number;
}) {
  const [index, setIndex] = useState(0);
  // Explizite Nutzer-Pause (Button) getrennt von der transienten Pause bei
  // Hover/Fokus — sonst würde Hovern den Button-Zustand überschreiben.
  const [userPaused, setUserPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const baseId = useId();

  useEffect(() => {
    // prefers-reduced-motion: nicht automatisch wechseln; Steuerung zeigt „Play".
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setUserPaused(true);
    }
  }, []);

  const count = slides.length;
  const goTo = useCallback(
    (i: number) => setIndex(((i % count) + count) % count),
    [count],
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  const multi = count > 1;
  const autoplay = multi && !userPaused && !interacting;

  useEffect(() => {
    if (!autoplay) return;
    const timer = setInterval(next, Math.max(2, intervalSeconds) * 1000);
    return () => clearInterval(timer);
  }, [autoplay, intervalSeconds, next]);

  if (count === 0) return null;
  const slide = slides[index];

  function onKeyDown(e: React.KeyboardEvent) {
    if (!multi) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    }
  }

  return (
    <section
      aria-roledescription="Karussell"
      aria-label={dict.home.sliderLabel}
      // mb reserviert Platz für die nach unten überlappende Thumbnail-Leiste.
      className={`featured-slider relative select-none ${multi ? "mb-20 sm:mb-24" : ""}`}
      // Transiente Pause bei Hover/Fokus (getrennt vom Pause-Button-Zustand).
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setInteracting(false);
        }
      }}
      onKeyDown={onKeyDown}
    >
      {/* Hauptbühne */}
      <div
        id={baseId}
        className="relative min-h-[22rem] overflow-hidden bg-ink sm:min-h-[28rem] lg:min-h-[32rem]"
      >
        {/* Hintergrundbild + Overlay */}
        <img
          key={slide.id}
          src={slide.imgSrc}
          srcSet={slide.imgSrcSet}
          sizes="(max-width: 1024px) 100vw, 1024px"
          alt={slide.alt}
          width={1280}
          height={720}
          decoding="async"
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div aria-hidden className="absolute inset-0 bg-black/50" />

        {/* Ganze Bildfläche als Link zum Rezept (unter Pfeilen/Thumbs). */}
        {slide.href && (
          <Link
            href={slide.href}
            aria-label={slide.caption}
            className="absolute inset-0 z-10"
          />
        )}

        {/* Inhalt — pointer-events-none, damit der Klick die Bildflächen-
            Verlinkung erreicht; nur der Titel-Link bleibt separat klickbar. */}
        <div
          aria-live={autoplay ? "off" : "polite"}
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 px-14 pb-16 text-center text-white sm:px-20"
        >
          {slide.category && (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-leaf-soft">
              {slide.category}
            </p>
          )}
          <h2 className="font-display text-[1.75rem] font-semibold leading-tight drop-shadow-sm sm:text-[2.25rem] lg:text-[2.75rem]">
            {slide.href ? (
              <Link
                href={slide.href}
                className="pointer-events-auto hover:text-white/90"
              >
                {slide.caption}
              </Link>
            ) : (
              slide.caption
            )}
          </h2>
          {typeof slide.likeCount === "number" && slide.recipeId != null && (
            <CompactLike
              recipeId={slide.recipeId}
              initialCount={slide.likeCount}
              iconClassName="h-4 w-4"
              className="pointer-events-auto text-sm tracking-wide text-white hover:text-white/90"
            />
          )}
        </div>

        {/* Pfeile */}
        {multi && (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label={dict.home.sliderPrev}
              className="absolute left-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-2xl text-white/90 drop-shadow-lg transition hover:bg-white/15 hover:text-white"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={next}
              aria-label={dict.home.sliderNext}
              className="absolute right-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-2xl text-white/90 drop-shadow-lg transition hover:bg-white/15 hover:text-white"
            >
              ›
            </button>
          </>
        )}
      </div>

      {/* Thumbnail-Navigation — überlappt den unteren Rand */}
      {multi && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 translate-y-1/2">
          <ul className="pointer-events-auto mx-auto flex max-w-4xl items-stretch justify-center gap-2 px-4 sm:gap-3 sm:px-8">
            {slides.map((s, i) => {
              const active = i === index;
              return (
                <li key={s.id} className="min-w-0 flex-1 basis-40 sm:max-w-[13rem]">
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    aria-label={`${dict.home.sliderGoTo} ${i + 1}`}
                    aria-current={active}
                    aria-controls={baseId}
                    className={`group relative block aspect-[3/2] w-full overflow-hidden border-2 shadow-md transition ${
                      active ? "border-white" : "border-white/70"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.imgSrc}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                    <span
                      aria-hidden
                      className={`absolute inset-0 transition-opacity ${
                        active ? "bg-black/0" : "bg-black/60 group-hover:bg-black/40"
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
