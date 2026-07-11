"use client";

import { useEffect } from "react";

/** Öffnet nach dem Laden der Druckansicht automatisch den Druckdialog. */
export function PrintOnLoad() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
