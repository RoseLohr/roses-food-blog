"use client";

/**
 * Weltkarte auf /reisen: zeigt pro Gericht einen Pin an der Foto-GPS-Position.
 * Klick auf einen Pin öffnet ein Popup mit Bild, Restaurant- und Gerichtname;
 * Klick auf die Karte oder ein Zoom schließt es wieder.
 *
 * Vollständig selbst gehostet und CSP-konform: Leaflet (BSD, lokal gebündelt)
 * plus eine gemeinfreie Weltkarte (Natural Earth als GeoJSON aus /public).
 * KEINE externen Kartenkacheln — daher keine Fremd-Requests, keine Besucher-
 * IPs an Dritte, die strikte CSP bleibt unangetastet.
 */
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { t } from "@/i18n/de";

const dict = t();

export interface TravelMapPin {
  lat: number;
  lng: number;
  dishName: string;
  restaurantName: string;
  restaurantCity: string;
  thumbUrl: string;
  imageAlt: string;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  );
}

/** Popup-Inhalt: Bild, darunter Restaurant, darunter Gericht. */
function popupHtml(p: TravelMapPin): string {
  const location = p.restaurantCity
    ? `${esc(p.restaurantName)} · ${esc(p.restaurantCity)}`
    : esc(p.restaurantName);
  return `
    <div style="width:180px">
      <img src="${esc(p.thumbUrl)}" alt="${esc(p.imageAlt)}"
        style="display:block;width:100%;height:120px;object-fit:cover;margin-bottom:8px" />
      <p style="margin:0;font-weight:700;font-size:13px;color:#111111">${location}</p>
      <p style="margin:2px 0 0;font-size:13px;color:#4c4b5b">${esc(p.dishName)}</p>
    </div>`;
}

const PIN_SVG = `
  <svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z"
      fill="#339e92" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" />
    <circle cx="12" cy="9" r="2.6" fill="#ffffff" />
  </svg>`;

export function TravelMap({ pins }: { pins: TravelMapPin[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let map: import("leaflet").Map | null = null;

    (async () => {
      const leafletModule = await import("leaflet");
      // CJS-Interop: L liegt unter .default (Fallback: Namespace direkt).
      const L = leafletModule.default ?? leafletModule;
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, {
        minZoom: 1,
        maxZoom: 8,
        worldCopyJump: true,
        scrollWheelZoom: true,
        // Popup schließt bei Klick auf die Karte (Standard) — explizit gesetzt.
        closePopupOnClick: true,
      });
      map.attributionControl.setPrefix("Leaflet");
      map.setView([20, 0], 2);

      // Gemeinfreie Weltkarte (Natural Earth) als Vektor-Hintergrund, keine Kacheln.
      try {
        const geo = await fetch("/geo/world-110m.geojson").then((r) => r.json());
        if (cancelled || !map) return;
        L.geoJSON(geo, {
          interactive: false,
          style: {
            color: "#c3ccca", // Ländergrenzen
            weight: 0.6,
            fillColor: "#e8ebea", // Landfläche
            fillOpacity: 1,
          },
        }).addTo(map);
        map.attributionControl.addAttribution(
          "Karte: Natural Earth (gemeinfrei)",
        );
      } catch {
        /* Ohne Basemap bleibt die Karte nutzbar (nur Pins auf Hintergrund). */
      }
      if (cancelled || !map) return;

      const icon = L.divIcon({
        html: PIN_SVG,
        className: "travel-map-pin",
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -26],
      });

      const markers: import("leaflet").Marker[] = [];
      for (const p of pins) {
        const marker = L.marker([p.lat, p.lng], {
          icon,
          title: `${p.restaurantName} – ${p.dishName}`,
        });
        marker.bindPopup(popupHtml(p), { minWidth: 180, maxWidth: 200 });
        marker.addTo(map);
        markers.push(marker);
      }

      // Mit Pins: auf sie zoomen (bei einem Pin nicht zu nah). Ohne Pins bleibt
      // die ganze Welt sichtbar (setView oben).
      if (markers.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.3), { maxZoom: 6 });
      }

      // „Beim Zoomen“ verschwindet ein offenes Popup wieder.
      map.on("zoomstart", () => map?.closePopup());

      // Manche mobilen Browser (u. a. iOS Safari) vermessen den Container beim
      // Init noch nicht endgültig — Größe kurz danach neu berechnen, sonst
      // bleibt die Karte gelegentlich leer/grau.
      setTimeout(() => map?.invalidateSize(), 250);
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [pins]);

  return (
    <section aria-label={dict.travelList.mapLabel} className="mt-8">
      <div
        ref={containerRef}
        role="application"
        aria-label={dict.travelList.mapLabel}
        className="h-[360px] w-full bg-cream shadow-sm sm:h-[440px]"
        style={{ background: "#eef2f3" }}
      />
    </section>
  );
}
