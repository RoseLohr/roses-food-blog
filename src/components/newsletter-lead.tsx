"use client";

/**
 * Einladungszeile der Newsletter-Box, pfadabhängig: Auf den Reise-Seiten
 * (/reisen und /reisen/…) heißt es „Keine Reise mehr verpassen", überall
 * sonst „Kein Rezept mehr verpassen". Gleiche Technik wie HideOnHome —
 * die Box sitzt im gemeinsamen Footer-Layout, das die Route nicht kennt.
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
