"use client";

/**
 * Startseiten-Slider: konfigurierbares Wechselintervall, pausierbar
 * (Button + automatisch bei prefers-reduced-motion), Tastaturbedienung
 * über Vor/Zurück-Buttons und Punkte.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n/de";

const dict = t();

export interface SlideData {
  id: number;
  imgSrc: string;
  imgSrcSet: string;
  alt: string;
  caption: string;
  href: string | null;
}

export function HeroSlider({
  slides,
  intervalSeconds,
}: {
  slides: SlideData[];
  intervalSeconds: number;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = mq.matches;
    if (mq.matches) setPaused(true);
  }, []);

  const next = useCallback(
    () => setIndex((i) => (i + 1) % slides.length),
    [slides.length],
  );

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const timer = setInterval(next, Math.max(2, intervalSeconds) * 1000);
    return () => clearInterval(timer);
  }, [paused, intervalSeconds, next, slides.length]);

  if (slides.length === 0) return null;
  const slide = slides[index];

  return (
    <section
      aria-roledescription="Karussell"
      aria-label={dict.home.sliderLabel}
      className="relative overflow-hidden rounded-2xl"
    >
      <div aria-live={paused ? "polite" : "off"}>
        {slide.href ? (
          <Link href={slide.href} className="block">
            <img
              src={slide.imgSrc}
              srcSet={slide.imgSrcSet}
              sizes="(max-width: 1024px) 100vw, 768px"
              alt={slide.alt}
              width={1280}
              height={720}
              decoding="async"
              className="aspect-[16/9] w-full object-cover"
            />
            {slide.caption && (
              <p className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10 font-display text-xl font-bold text-white md:text-2xl">
                {slide.caption}
              </p>
            )}
          </Link>
        ) : (
          <img
            src={slide.imgSrc}
            srcSet={slide.imgSrcSet}
            sizes="(max-width: 1024px) 100vw, 768px"
            alt={slide.alt}
            width={1280}
            height={720}
            decoding="async"
            className="aspect-[16/9] w-full object-cover"
          />
        )}
      </div>

      {slides.length > 1 && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
            aria-label={dict.home.sliderPrev}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 font-bold shadow hover:bg-white"
          >
            ‹
          </button>
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`${dict.home.sliderGoTo} ${i + 1}`}
              aria-current={i === index}
              className={`h-2.5 w-2.5 rounded-full shadow ${
                i === index ? "bg-white" : "bg-white/50 hover:bg-white/80"
              }`}
            />
          ))}
          <button
            type="button"
            onClick={next}
            aria-label={dict.home.sliderNext}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 font-bold shadow hover:bg-white"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            aria-label={paused ? dict.home.sliderPlay : dict.home.sliderPause}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow hover:bg-white"
          >
            {paused ? "▶" : "⏸"}
          </button>
        </div>
      )}
    </section>
  );
}
