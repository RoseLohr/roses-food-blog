"use client";

/**
 * Kompakte, klickbare Like-Anzeige („♥ N Likes") für Rezeptkacheln und den
 * Startseiten-Slider. Klick zählt ein Like hoch (einmal je Client, Dedup
 * serverseitig). Verhindert die Navigation eines umschließenden Links
 * (stopPropagation/preventDefault). Ohne JS bleibt der Zähler als Text sichtbar.
 */
import { useEffect, useState } from "react";
import { IconHeart } from "./icons";
import { getLikedIds, sendLike } from "@/lib/likes-client";
import { t } from "@/i18n/de";

const dict = t();

export function CompactLike({
  recipeId,
  initialCount,
  className,
  iconClassName = "h-3.5 w-3.5",
}: {
  recipeId: number;
  initialCount: number;
  /** Farb-/Textklassen vom Aufrufer (Kachel: ink-soft, Slider: weiß). */
  className?: string;
  iconClassName?: string;
}) {
  const [count, setCount] = useState(initialCount);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLiked(getLikedIds().includes(recipeId));
  }, [recipeId]);

  async function onClick(e: React.MouseEvent) {
    // Nicht dem umschließenden Link folgen, sondern liken.
    e.preventDefault();
    e.stopPropagation();
    if (liked || busy) return;
    setBusy(true);
    try {
      const n = await sendLike(recipeId);
      if (n !== null) {
        setCount(n);
        setLiked(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={liked || busy}
      aria-pressed={liked}
      aria-label={liked ? dict.recipe.liked : dict.recipe.like}
      className={`inline-flex items-center gap-1.5 transition-colors disabled:cursor-default ${className ?? ""}`}
    >
      <IconHeart className={iconClassName} filled={liked} />
      {count} {dict.recipeList.likesSuffix}
    </button>
  );
}
