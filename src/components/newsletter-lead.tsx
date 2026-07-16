"use client";

/**
 * Einladungszeile der Newsletter-Box, pfadabhängig: Auf den Reise-Seiten
 * (/reisen und /reisen/…) heißt es „Keine Reise mehr verpassen", überall
 * sonst „Kein Rezept mehr verpassen". Als Client-Komponente kennt sie die
 * Route, während die Box selbst im gemeinsamen Footer-Layout sitzt.
 */
import { usePathname } from "next/navigation";
import { t } from "@/i18n/de";

const d = t().newsletter;

export function NewsletterLead() {
  const pathname = usePathname();
  const isTravel = pathname === "/reisen" || pathname.startsWith("/reisen/");
  return (
    <p className="nl-box__title">
      {isTravel ? d.formLeadTravel : d.formLead}
    </p>
  );
}
