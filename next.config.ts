import type { NextConfig } from "next";

// Strikte CSP ohne externe Quellen (Auftrag Abschnitt 10). 'unsafe-inline'
// bei script-src ist für die Inline-Bootstrap-Skripte von Next.js nötig —
// externe Hosts bleiben dennoch vollständig blockiert. HSTS setzt nginx.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  // hash-wasm extern halten, damit es als auflösbares Paket im Standalone-
  // node_modules liegt (scripts/migrate.mjs importiert es zur Laufzeit).
  serverExternalPackages: ["better-sqlite3", "sharp", "hash-wasm"],
  poweredByHeader: false,
  // Komprimiert wird VOM REVERSE PROXY, nicht hier.
  //
  // Warum das nötig ist: Mit `compress: true` (Next-Default) verlässt jede
  // Antwort den Server bereits als gzip. nginx komprimiert eine Antwort, die
  // schon ein Content-Encoding trägt, NICHT noch einmal — es reicht sie durch.
  // Ein `brotli on;` im nginx wäre damit wirkungslos, egal wie es konfiguriert
  // ist. Erst wenn Next unkomprimiert ausliefert, kann nginx brotli anwenden
  // (gemessen am geteilten Sockel: 166,1 KiB gzip gegenüber 143,7 KiB brotli,
  // siehe scripts/regime/bundle-budget.mjs).
  //
  // VORAUSSETZUNG, ehrlich benannt: Vor der App MUSS ein komprimierender Proxy
  // stehen. Das ist der dokumentierte Betrieb (README §4, bootstrap.sh richtet
  // nginx samt TLS ein) und die Vorlage deploy/nginx.conf.example bringt gzip
  // UND brotli mit. Wer die App OHNE Proxy direkt auf Port 3000 exponiert,
  // liefert nach dieser Änderung unkomprimiert aus — bootstrap.sh weist beim
  // Überspringen der nginx-Einrichtung ausdrücklich darauf hin.
  compress: false,
  // Der eingebaute /_next/image-Optimizer lädt zur Laufzeit natives sharp.
  // Die App nutzt ihn nicht (eigene WebP-Varianten via <img srcSet> aus der
  // Medienbibliothek), daher komplett deaktivieren — das hält die native
  // Bibliothek aus dem Anfragepfad heraus.
  images: { unoptimized: true },
  experimental: {
    // Persistenter Turbopack-Build-Cache (.next/cache/turbopack). deploy.sh
    // reicht das Verzeichnis als Host-Mount in den Image-Build durch —
    // Folge-Deployments bauen dadurch nur noch das Geänderte neu.
    turbopackFileSystemCacheForBuild: true,
    serverActions: {
      // Bild-Uploads in der Medienbibliothek (max. 15 MB + Formular-Overhead)
      bodySizeLimit: "20mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Verbietet das Einbetten fremder Ressourcen, die sich nicht per
          // Cross-Origin-Resource-Policy dazu bekennen. Gemeldet vom
          // wöchentlichen DAST-Lauf (ZAP-Regel 90004, Issue #75).
          //
          // `require-corp` ist hier die strenge und trotzdem gefahrlose Wahl:
          // Diese Anwendung bettet NICHTS Fremdes ein — kein iframe, kein
          // embed, keine externe Kachelquelle (die Karte ist Leaflet mit
          // Markern, ohne Tile-Layer), und die CSP oben erlaubt ohnehin nur
          // 'self' und data:. Geprüft wurde das nicht nur am Quelltext, sondern
          // am laufenden Server: Alle Seiten, die die E2E-Sammlung ansieht,
          // laden ihre Ressourcen weiterhin vollständig.
          //
          // Bewusst OHNE Cross-Origin-Opener-Policy: Erst beide Header zusammen
          // ergeben „cross-origin isolated". COOP `same-origin` kappt aber
          // window.open-Beziehungen zu fremden Seiten, und das ist eine eigene
          // Entscheidung — nicht das, was hier gemeldet wurde.
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        // Self-hosted Schriften unter /public/fonts liefert Next.js ohne
        // Langzeit-Cache aus (Lighthouse: „Effiziente Cache-Verweildauer").
        // immutable + 1 Jahr ist NUR sicher, weil die URLs per „?v=<Inhalts-
        // Hash>" versioniert sind (globals.css + layout.tsx): ein Font-Tausch
        // erzeugt einen neuen Hash → neue URL → kein Stale bei Bestandsclients.
        // Erzwungen durch scripts/regime/font-cache.mjs (Hash == Datei-Inhalt).
        source: "/fonts/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Marken-SVGs (/public/brand) liefert Next.js sonst nur mit kurzem Cache
        // aus (Lighthouse: „Effiziente Cache-Verweildauer", 4 h). immutable + 1
        // Jahr ist NUR sicher, weil die URLs per „?v=<Inhalts-Hash>" versioniert
        // sind (site-logo.tsx): ein Icon-Tausch erzeugt eine neue URL → kein
        // Stale bei Bestandsclients. Erzwungen durch scripts/regime/font-cache.mjs.
        source: "/brand/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
