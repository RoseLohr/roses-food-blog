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

/** Google-Maps-Link zur GPS-Position des Fotos (EXIF), plattformübergreifend. */
function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Popup-Inhalt: Bild, darunter Restaurant + „Ort", darunter Gericht.
 * Der Ort (Restaurant-Stadt) ist ein Link auf Google Maps an die EXIF-Position
 * des Fotos — öffnet in einem neuen Tab. Die Koordinaten stammen aus den
 * EXIF-Daten des Gericht-Fotos (bereits im Pin enthalten).
 */
function popupHtml(p: TravelMapPin): string {
  const cityLink = p.restaurantCity
    ? `<a href="${esc(mapsUrl(p.lat, p.lng))}" target="_blank" rel="noopener noreferrer"
         title="${esc(dict.travelList.mapOpenInMaps)}"
         style="color:#2b857b;text-decoration:underline">${esc(p.restaurantCity)}</a>`
    : "";
  const location = cityLink
    ? `${esc(p.restaurantName)} · ${cityLink}`
    : esc(p.restaurantName);
  return `
    <div style="width:180px">
      <img src="${esc(p.thumbUrl)}" alt="${esc(p.imageAlt)}"
        style="display:block;width:100%;height:120px;object-fit:cover;margin-bottom:8px" />
      <p style="margin:0;font-weight:700;font-size:13px;color:#111111">${location}</p>
      <p style="margin:2px 0 0;font-size:13px;color:#4c4b5b">${esc(p.dishName)}</p>
    </div>`;
}

// Ab dieser Zoomstufe werden Hauptstädte überhaupt erst eingeblendet
// (maxZoom der Karte ist 8) — hält Welt-/Regionalansicht frei von Städten.
const CAPITAL_MIN_ZOOM = 7;

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

      // Gemeinfreie Weltkarte (Natural Earth 50 m) als Vektor-Hintergrund:
      // cremefarbenes Land auf blauem Wasser (Container-Hintergrund) plus
      // Ländernamen. Keine Kacheln → keine Fremd-Requests, strikte CSP bleibt.
      const labelLayer = L.layerGroup();
      const labels: { marker: import("leaflet").Marker; min: number }[] = [];
      try {
        const geo = await fetch("/geo/world-50m.geojson").then((r) => r.json());
        if (cancelled || !map) return;
        L.geoJSON(geo, {
          interactive: false,
          style: {
            color: "#cdbfa6", // dezente Ländergrenzen
            weight: 0.5,
            fillColor: "#f4efe6", // cremefarbenes Land
            fillOpacity: 1,
          },
        }).addTo(map);
        labelLayer.addTo(map);
        for (const f of geo.features ?? []) {
          const pr = f?.properties;
          if (!pr?.name || typeof pr.lx !== "number" || typeof pr.ly !== "number")
            continue;
          const marker = L.marker([pr.ly, pr.lx], {
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
              className: "travel-map-label",
              html: `<span style="display:inline-block;transform:translate(-50%,-50%);white-space:nowrap;pointer-events:none;color:#4b4550;font-family:'Nunito Sans',system-ui,sans-serif;font-size:11px;font-weight:600;text-shadow:0 0 2px #fff,0 0 3px #fff">${esc(String(pr.name))}</span>`,
              iconSize: [0, 0],
            }),
          });
          labels.push({ marker, min: typeof pr.min === "number" ? pr.min : 0 });
        }
        map.attributionControl.addAttribution(
          "Karte: Natural Earth (gemeinfrei)",
        );
      } catch {
        /* Ohne Basemap bleibt die Karte nutzbar (nur Pins auf Hintergrund). */
      }
      if (cancelled || !map) return;

      // Nationale Hauptstädte: erst ab höherem Zoom (in ein Land hinein)
      // einblenden. Eigene, gemeinfreie Punktdaten (Natural Earth), lokal
      // ausgeliefert — weiterhin keine externen Kartenserver.
      const capitalLayer = L.layerGroup();
      const capitals: { marker: import("leaflet").Marker; min: number }[] = [];
      try {
        const caps: Array<{ n: string; lat: number; lng: number; min?: number }> =
          await fetch("/geo/capitals.json").then((r) => r.json());
        if (!cancelled && map && Array.isArray(caps)) {
          capitalLayer.addTo(map);
          for (const c of caps) {
            if (
              typeof c?.lat !== "number" ||
              typeof c?.lng !== "number" ||
              !c?.n
            )
              continue;
            const marker = L.marker([c.lat, c.lng], {
              interactive: false,
              keyboard: false,
              icon: L.divIcon({
                className: "travel-map-capital",
                html: `<span style="display:inline-flex;align-items:center;gap:3px;transform:translateY(-50%);white-space:nowrap;pointer-events:none;font-family:'Nunito Sans',system-ui,sans-serif;font-size:10px;font-weight:600;color:#3a3540;text-shadow:0 0 2px #fff,0 0 3px #fff"><span style="width:5px;height:5px;border-radius:9999px;background:#b23b3b;box-shadow:0 0 0 1.5px #fff;flex:none"></span>${esc(String(c.n))}</span>`,
                iconSize: [0, 0],
              }),
            });
            capitals.push({
              marker,
              min: typeof c.min === "number" ? c.min : 4,
            });
          }
        }
      } catch {
        /* Hauptstädte sind optional — Karte bleibt ohne sie nutzbar. */
      }
      if (cancelled || !map) return;

      // Beschriftungen zoomabhängig ein-/ausblenden (kleinere Länder und die
      // Hauptstädte erst beim Reinzoomen), damit die Weltansicht nicht
      // überladen wirkt.
      const refreshLabels = () => {
        if (!map) return;
        const z = map.getZoom();
        for (const { marker, min } of labels) {
          const show = z >= min - 0.5;
          const has = labelLayer.hasLayer(marker);
          if (show && !has) labelLayer.addLayer(marker);
          else if (!show && has) labelLayer.removeLayer(marker);
        }
        for (const { marker, min } of capitals) {
          // Erst deutlich hineingezoomt (in ein Land/eine Region) einblenden —
          // in der Regional-/Länderansicht bleiben die Städte ausgeblendet.
          const show = z >= Math.max(CAPITAL_MIN_ZOOM, min);
          const has = capitalLayer.hasLayer(marker);
          if (show && !has) capitalLayer.addLayer(marker);
          else if (!show && has) capitalLayer.removeLayer(marker);
        }
      };
      map.on("zoomend", refreshLabels);

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
      refreshLabels();

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
    // relative z-0: eigener Stacking-Context, damit Leaflets hohe z-index-Werte
    // (Steuerelemente bis ~800) nicht über den klebenden Header/das mobile Menü
    // (z-40) hinausragen.
    <section aria-label={dict.travelList.mapLabel} className="relative z-0 mt-8">
      <div
        ref={containerRef}
        role="application"
        aria-label={dict.travelList.mapLabel}
        className="h-[360px] w-full shadow-sm sm:h-[440px]"
        style={{ background: "#a8d1e0" }}
      />
    </section>
  );
}
