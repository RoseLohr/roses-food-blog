"use client";

/**
 * Minimaler First-Party-Beacon: sendet beim Verlassen/Verbergen der Seite
 * die Verweildauer (sendBeacon). Kein Cookie, keine ID mit Nutzerbezug —
 * das Token gehört zum Seitenaufruf, nicht zur Person.
 */
import { useEffect } from "react";

export function DurationBeacon({ token }: { token: string }) {
  useEffect(() => {
    const start = performance.now();
    let sent = false;

    const send = () => {
      if (sent) return;
      sent = true;
      const payload = JSON.stringify({
        token,
        ms: Math.round(performance.now() - start),
      });
      navigator.sendBeacon(
        "/api/beacon",
        new Blob([payload], { type: "application/json" }),
      );
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") send();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      send();
    };
  }, [token]);

  return null;
}
