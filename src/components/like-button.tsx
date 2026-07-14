"use client";

/**
 * Like ohne Anmeldung: anonyme Client-ID (UUID) in localStorage,
 * Dedup serverseitig (Annahme B9). Funktioniert progressiv — ohne JS
 * wird nur der Zähler angezeigt.
 */
import { useEffect, useState } from "react";
import { IconHeart } from "./icons";
import { getLikedIds, sendLike } from "@/lib/likes-client";
import { t } from "@/i18n/de";

const dict = t();

export function LikeButton({
  recipeId,
  initialCount,
}: {
  recipeId: number;
  initialCount: number;
}) {
  const [count, setCount] = useState(initialCount);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLiked(getLikedIds().includes(recipeId));
  }, [recipeId]);

  async function like() {
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
      onClick={like}
      disabled={liked || busy}
      aria-pressed={liked}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
        liked
          ? "border-rose-primary bg-rose-primary/10 text-rose-primary"
          : "border-ink/20 hover:border-rose-primary hover:text-rose-primary"
      }`}
    >
      <IconHeart className="h-4 w-4" filled={liked} />
      {liked ? dict.recipe.liked : dict.recipe.like}
      <span className="tabular-nums">({count})</span>
    </button>
  );
}
