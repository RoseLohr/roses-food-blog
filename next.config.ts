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
  // Der eingebaute /_next/image-Optimizer lädt zur Laufzeit natives sharp —
  // das würde auf CPUs ohne SSE4.2 (LOW_CPU) einen unabfangbaren SIGILL
  // auslösen und den ganzen Serverprozess killen. Die App nutzt ihn ohnehin
  // nicht (eigene WebP-Varianten via <img srcSet> aus der Medienbibliothek),
  // daher komplett deaktivieren.
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
    ];
  },
};

export default nextConfig;
