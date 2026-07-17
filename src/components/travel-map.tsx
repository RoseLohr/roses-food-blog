"use client";

/**
 * Weltkarte auf /reisen: EIN Pin je Restaurant. Klick öffnet ein Popup mit
 * dem Restaurantnamen (verlinkt zum Reisebericht), dem Ort (Google-Maps-Link)
 * und allen Gerichten des Restaurants als Karussell (Pfeile links/rechts;
 * Foto und Gerichtname verlinken zum Gericht im Bericht).
 *
 * Liegen Restaurants zu dicht beieinander, fasst leaflet.markercluster sie
 * zu einem Zähler-Kreis zusammen; ein Klick zoomt hinein bzw. fächert
 * überlappende Pins auf (Spiderfy).
 *
 * Vollständig selbst gehostet und CSP-konform: Leaflet + markercluster
 * (beide lokal gebündelt) plus eine gemeinfreie Weltkarte (Natural Earth als
 * GeoJSON aus /public). KEINE externen Kartenkacheln — daher keine
 * Fremd-Requests, keine Besucher-IPs an Dritte.
 */
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import type { TravelMapPin } from "@/lib/travel-map";
import { t } from "@/i18n/de";

const dict = t();

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

/** Google-Maps-Link zur Pin-Position, plattformübergreifend. */
function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Popup-Inhalt als DOM-Element: Kopfzeile (Restaurant → Bericht, Ort →
 * Google Maps) + Gericht-Karussell. Als Element statt HTML-String, damit
 * die Pfeil-Buttons echte Click-Handler bekommen.
 */
function popupElement(p: TravelMapPin): HTMLElement {
  const root = document.createElement("div");
  root.style.width = "200px";
  const restaurantUrl = `/reisen/${encodeURIComponent(p.travelSlug)}#restaurant-${p.restaurantId}`;

  const head = document.createElement("p");
  head.style.cssText = "margin:0;font-weight:700;font-size:13px;color:#111111";
  const restLink = document.createElement("a");
  restLink.href = restaurantUrl;
  restLink.textContent = p.restaurantName;
  restLink.style.cssText = "color:#111111;text-decoration:none";
  head.appendChild(restLink);
  if (p.restaurantCity) {
    head.appendChild(document.createTextNode(" · "));
    const cityLink = document.createElement("a");
    cityLink.href = mapsUrl(p.lat, p.lng);
    cityLink.target = "_blank";
    cityLink.rel = "noopener noreferrer";
    cityLink.title = dict.travelList.mapOpenInMaps;
    cityLink.textContent = p.restaurantCity;
    cityLink.style.cssText =
      "color:#277a70;text-decoration:underline;font-weight:400";
    head.appendChild(cityLink);
  }
  root.appendChild(head);

  if (p.dishes.length === 0) return root;

  // --- Karussell -----------------------------------------------------------
  let index = 0;
  const count = p.dishes.length;

  const frame = document.createElement("div");
  frame.style.cssText = "position:relative;margin-top:8px";
  const mediaLink = document.createElement("a");
  const img = document.createElement("img");
  img.style.cssText = "display:block;width:100%;height:120px;object-fit:cover";
  const placeholder = document.createElement("span");
  placeholder.style.cssText =
    "display:flex;align-items:center;justify-content:center;width:100%;height:120px;background:#f4f6f5;color:#4c4b5b;font-size:11px";
  mediaLink.appendChild(img);
  mediaLink.appendChild(placeholder);
  frame.appendChild(mediaLink);

  const nameRow = document.createElement("p");
  nameRow.style.cssText =
    "margin:6px 0 0;font-size:13px;display:flex;justify-content:space-between;gap:8px;align-items:baseline";
  const nameLink = document.createElement("a");
  nameLink.style.cssText = "color:#277a70;text-decoration:underline;min-width:0";
  const counter = document.createElement("span");
  counter.style.cssText = "color:#4c4b5b;font-size:11px;white-space:nowrap";
  nameRow.appendChild(nameLink);
  if (count > 1) nameRow.appendChild(counter);

  const arrow = (dir: -1 | 1, label: string): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", label);
    btn.textContent = dir < 0 ? "‹" : "›";
    btn.style.cssText =
      `position:absolute;top:50%;${dir < 0 ? "left:6px" : "right:6px"};` +
      "transform:translateY(-50%);width:26px;height:26px;border:0;border-radius:9999px;" +
      "background:rgba(255,255,255,0.92);color:#111111;font-size:17px;line-height:1;" +
      "cursor:pointer;box-shadow:0 1px 3px rgba(17,17,17,0.35);display:flex;align-items:center;justify-content:center;padding:0 0 2px";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      index = (index + dir + count) % count;
      render();
    });
    return btn;
  };
  if (count > 1) {
    frame.appendChild(arrow(-1, dict.travelList.mapPrevDish));
    frame.appendChild(arrow(1, dict.travelList.mapNextDish));
  }

  const render = () => {
    const dish = p.dishes[index];
    const dishUrl = `/reisen/${encodeURIComponent(p.travelSlug)}#dish-${dish.dishId}`;
    mediaLink.href = dishUrl;
    mediaLink.setAttribute("aria-label", dish.name);
    if (dish.thumbUrl) {
      img.src = dish.thumbUrl;
      img.alt = dish.imageAlt || dish.name;
      img.style.display = "block";
      placeholder.style.display = "none";
    } else {
      img.removeAttribute("src");
      img.style.display = "none";
      placeholder.textContent = dish.name;
      placeholder.style.display = "flex";
    }
    nameLink.href = dishUrl;
    nameLink.textContent = dish.name;
    counter.textContent = dict.travelList.mapDishCount(index + 1, count);
  };
  render();

  root.appendChild(frame);
  root.appendChild(nameRow);
  return root;
}

// Ab dieser Zoomstufe werden Hauptstädte überhaupt erst eingeblendet
// (maxZoom der Karte ist 11) — hält Welt-/Regionalansicht frei von Städten.
const CAPITAL_MIN_ZOOM = 7;

const PIN_SVG = `
  <svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z"
      fill="#277a70" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" />
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
      // Plugin erweitert L um markerClusterGroup (Cluster + Spiderfy).
      await import("leaflet.markercluster");
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, {
        minZoom: 1,
        // Höherer Zoom für Stadt-/Viertel-Nähe. Die Vektor-Weltkarte (50 m)
        // wird dabei grob — für die Pin-Umgebung reicht es, und der
        // Google-Maps-Link im Popup übernimmt die Detailansicht.
        maxZoom: 11,
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

      // Cluster + Spiderfy: dicht beieinanderliegende Restaurants werden zu
      // einem Zähler-Kreis zusammengefasst; Klick zoomt hinein bzw. fächert
      // Pins an (fast) identischer Position auf.
      const clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 40,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true,
        spiderfyDistanceMultiplier: 1.4,
        iconCreateFunction: (cluster) =>
          L.divIcon({
            html: `<span style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;background:#277a70;color:#fff;font-family:'Nunito Sans',system-ui,sans-serif;font-size:13px;font-weight:700;box-shadow:0 0 0 4px rgba(39,122,112,0.3)">${cluster.getChildCount()}</span>`,
            className: "travel-map-cluster",
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          }),
      });

      for (const p of pins) {
        const marker = L.marker([p.lat, p.lng], {
          icon,
          title: p.restaurantCity
            ? `${p.restaurantName} · ${p.restaurantCity}`
            : p.restaurantName,
        });
        marker.bindPopup(() => popupElement(p), { minWidth: 200, maxWidth: 230 });
        clusterGroup.addLayer(marker);
      }
      map.addLayer(clusterGroup);

      // Mit Pins: auf sie zoomen (bei einem Pin nicht zu nah). Ohne Pins bleibt
      // die ganze Welt sichtbar (setView oben).
      if (pins.length > 0) {
        const bounds = L.latLngBounds(
          pins.map((p) => [p.lat, p.lng] as [number, number]),
        );
        map.fitBounds(bounds.pad(0.3), { maxZoom: 6 });
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
