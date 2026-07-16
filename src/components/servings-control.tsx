"use client";

/**
 * Portionsrechner: erhöht/verringert die Portionszahl und aktualisiert
 * alle Mengenangaben (Spans mit data-menge/data-einheit) im zugehörigen
 * Container. Die Ausgangsmengen sind serverseitig gerendert (SSR bleibt
 * vollständig, funktioniert ohne JS mit den Originalportionen).
 */
import { useEffect, useState } from "react";
import { scaledDisplay } from "@/lib/servings";
import { t } from "@/i18n/de";

const dict = t();

export function ServingsControl({
  baseServings,
  containerId,
}: {
  baseServings: number;
  containerId: string;
}) {
  const [servings, setServings] = useState(baseServings);

  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;
    for (const el of container.querySelectorAll<HTMLElement>("[data-menge]")) {
      const amount = Number(el.dataset.menge);
      const unit = el.dataset.einheit ?? "";
      el.textContent = scaledDisplay(amount, unit, baseServings, servings);
    }
  }, [servings, baseServings, containerId]);

  const btn =
    "flex h-6 w-6 items-center justify-center rounded-full border border-ink/20 text-sm font-bold leading-none hover:border-leaf hover:text-leaf";

  return (
    <span className="inline-flex items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={() => setServings((s) => Math.max(1, s - 1))}
        aria-label={dict.recipe.decreaseServings}
        className={btn}
      >
        −
      </button>
      {/* Nur die Zahl — das Wort „Portionen" steht bereits als Label über
          dem Chip; so bleibt alles einzeilig und die ± -Knöpfe wirken ruhig. */}
      <span aria-live="polite" className="min-w-6 text-center tabular-nums">
        {servings}
      </span>
      <button
        type="button"
        onClick={() => setServings((s) => Math.min(99, s + 1))}
        aria-label={dict.recipe.increaseServings}
        className={btn}
      >
        +
      </button>
    </span>
  );
}
