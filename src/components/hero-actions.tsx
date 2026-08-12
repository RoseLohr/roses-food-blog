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
  printPath,
}: {
  title: string;
  /** ohne Angabe wird kein Druck-Button angezeigt */
  printPath?: string;
}) {
  const [copied, setCopied] = useState(false);

  /**
   * Teilen heißt „diese Seite teilen" — maßgeblich ist also die Adresse, unter
   * der der Besucher gerade steht.
   *
   * Früher kam die URL serverseitig aus der Umgebungsvariable BASE_URL. Die
   * kann von der tatsächlichen Domain abweichen (Domainwechsel, www/ohne www,
   * Vorschau-Adresse) — dann verschickte der Teilen-Knopf stumm eine falsche
   * Adresse. window.location kann das per Definition nicht.
   *
   * Ohne Query und Fragment: geteilt wird das Rezept, nicht der Filter- oder
   * Kampagnen-Anhang, mit dem der Besucher zufällig hergekommen ist.
   */
  function seitenUrl() {
    return window.location.origin + window.location.pathname;
  }

  async function inZwischenablage(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Zwischenablage nicht verfügbar (kein sicherer Kontext, Rechte
      // verweigert). Mehr als nichts zu tun bleibt hier nicht — der Nutzer
      // kann die Adresse weiterhin aus der Adresszeile kopieren.
    }
  }

  async function share() {
    const url = seitenUrl();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
      } catch (fehler) {
        // Abbruch durch den Nutzer ist kein Fehlerfall — alles andere schon:
        // dann greift die Zwischenablage, statt dass gar nichts passiert.
        if ((fehler as Error)?.name !== "AbortError") await inZwischenablage(url);
      }
      return;
    }
    await inZwischenablage(url);
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
