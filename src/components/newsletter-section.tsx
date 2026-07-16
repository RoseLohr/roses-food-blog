/**
 * Newsletter-Box („Version 3": Teal-Band, E-Mail zuerst). Links die Einladung,
 * rechts das schlanke Formular (nur E-Mail + Einwilligung). Vorname, Nachname
 * und Interessen werden bewusst erst NACH der Bestätigung abgefragt
 * (Willkommensschritt auf der Bestätigungsseite), um die Anmeldehürde niedrig
 * zu halten. Wird im Footer eingebunden.
 */
import { NewsletterForm } from "./newsletter-form";
import { getNewsletterVisible } from "@/lib/settings";
import { t } from "@/i18n/de";

const dict = t();
const d = dict.newsletter;

export function NewsletterSection({ source }: { source: string }) {
  // Im Admin (Newsletter → Anzeige) lässt sich die Box blogweit ausblenden.
  if (!getNewsletterVisible()) return null;

  return (
    <section aria-label={d.formTitle} className="nl-box print:hidden">
      <svg
        className="nl-box__envelope"
        viewBox="0 0 96 72"
        fill="none"
        stroke="#fff"
        strokeWidth={3}
        aria-hidden
      >
        <rect x="2" y="2" width="92" height="68" />
        <path d="M2 4 L48 42 L94 4" />
      </svg>
      <div className="nl-box__cols">
        <div>
          <p className="nl-box__eyebrow">{d.formTitle}</p>
          <p className="nl-box__title">{d.formLead}</p>
          <p className="nl-box__intro">{d.formIntro}</p>
        </div>
        <NewsletterForm source={source} />
      </div>
    </section>
  );
}
