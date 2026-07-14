"use client";

/**
 * Blendet seinen Inhalt auf der Startseite aus (dort ist z. B. der
 * Newsletter-Block im Footer unerwünscht), rendert ihn sonst normal.
 * Nimmt den (server-gerenderten) Inhalt als children entgegen.
 */
import { usePathname } from "next/navigation";

export function HideOnHome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <>{children}</>;
}
