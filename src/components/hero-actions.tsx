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
  publicPath,
  printPath,
}: {
  title: string;
  /** öffentlicher Pfad des Inhalts, z. B. „/rezepte/mein-rezept" */
  publicPath: string;
  /** ohne Angabe wird kein Druck-Button angezeigt */
  printPath?: string;
}) {
  const [copied, setCopied] = useState(false);

  /**
   * Geteilt wird die ÖFFENTLICHE Adresse des Inhalts auf der Domain, unter der
   * der Besucher gerade steht. Beide Hälften sind bewusst gewählt:
   *
   * - Herkunft aus window.location: früher kam die ganze URL serverseitig aus
   *   der Umgebungsvariable BASE_URL. Weicht die von der tatsächlich
   *   aufgerufenen Domain ab (Domainwechsel, mit/ohne www), verschickte der
   *   Knopf stumm eine falsche Adresse. Der Browser kann das nicht.
   * - Pfad vom Aufrufer, NICHT window.location.pathname: die Rezeptansicht
   *   erscheint auch in der Admin-Vorschau unter einem geschützten Pfad. Der
   *   aktuelle Pfad wäre dort „/admin/rezepte/<id>/vorschau" — der Empfänger
   *   landete bei Login/403, und die interne Rezept-ID wäre mit verschickt
   *   (Befund gpt-5.6-sol, PR #58).
   */
  function seitenUrl() {
    return window.location.origin + publicPath;
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
