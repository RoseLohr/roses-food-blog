import type { NextConfig } from "next";

// Strikte CSP ohne externe Quellen (Auftrag Abschnitt 10). 'unsafe-inline'
// bei script-src ist für die Inline-Bootstrap-Skripte von Next.js nötig —
// externe Hosts bleiben dennoch vollständig blockiert.
// HSTS setzt diese Anwendung NICHT — wo es gesetzt wird, ist nicht erhoben
// (offene Messfrage, audit/12-infrastruktur-fahrplan.md). Gegenindiz:
// deploy/nginx.conf.example hat die Zeile auskommentiert, und
// deploy/npm/http_top.conf setzt sie nicht.
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
  // Antwort den Server bereits als gzip. Ein Proxy komprimiert eine Antwort,
  // die schon ein Content-Encoding trägt, NICHT noch einmal — er reicht sie
  // durch. Seine Kompressionseinstellungen wären damit wirkungslos, egal wie
  // sie aussehen. Erst wenn Next unkomprimiert ausliefert, kann der Proxy
  // überhaupt komprimieren.
  //
  // VORAUSSETZUNG, ehrlich benannt: Vor der App MUSS ein komprimierender Proxy
  // stehen. Auf diesem Server ist das der Nginx Proxy Manager im Container;
  // was er komprimiert, steht in deploy/npm/http_top.conf und wird von
  // deploy.sh (Abschnitt 9c) bei jedem vollen Lauf eingespielt und nachgemessen.
  // Brotli gibt es dort NICHT — OpenResty hat kein solches Modul, brotli kommt
  // von Cloudflare am Rand. Der Abschnitt 5 von bootstrap.sh richtet dagegen
  // einen HISTORISCHEN Host-nginx ein (siehe README §4).
  // Wer die App OHNE Proxy direkt exponiert, liefert unkomprimiert aus.
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
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          // ── UND DIE ZWEITE HÄLFTE, NACHGEMESSEN (08/2026) ────────────────
          //
          // Hier stand „bewusst OHNE Cross-Origin-Opener-Policy", begründet
          // damit, dass COOP `same-origin` window.open-Beziehungen zu fremden
          // Seiten kappt. Der Satz stimmt allgemein — nur zahlt DIESE
          // Anwendung den Preis nicht. Am Quelltext ausgezählt:
          //
          //     window.open / window.opener / postMessage   ->  0 Fundstellen
          //     target="_blank"                             ->  6 Fundstellen
          //     davon mit rel="noopener"                    ->  6
          //
          // Fünf der sechs sind Admin-Vorschaulinks auf die eigene Seite —
          // same-origin, die COOP ausdrücklich erlaubt. Der sechste ist der
          // Google-Maps-Link im Reisebericht, mit `rel="noopener noreferrer"`.
          // Die Opener-Beziehung ist also überall bereits von Hand gekappt;
          // COOP schneidet nichts ab, was es noch gäbe.
          //
          // Damit ist die Anwendung „cross-origin isolated". Zusätzliche
          // Anforderungen an Unterressourcen entstehen dadurch NICHT — die
          // stellt `require-corp` oben bereits, und die CSP lässt ohnehin nur
          // 'self' und data: zu.
          //
          // Gemeldet als ZAP-Regel 90004 (Issue #75), zehn Fundstellen. Dass
          // die Meldung damit wirklich verschwindet, zeigt erst ein
          // DAST-Lauf — die Kopfzeile auf dem Draht ist die Prämisse, nicht
          // das Ergebnis.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // ── UND DIE DRITTE, MIT EINER GEMESSENEN AUSNAHME (08/2026) ──────
          //
          // CORP sagt, WER diese Antwort einbetten darf. `same-origin` ist
          // hier die richtige Strenge, denn die Dokumente dieser Anwendung
          // sind sitzungsabhängig: Ein angemeldeter Admin bekommt dieselbe
          // öffentliche Adresse MIT seinen Entwürfen ausgeliefert
          // (src/lib/entwurfsansicht.ts). Genau so etwas soll keine fremde
          // Seite als Unterressource ziehen können.
          //
          // GEMESSEN, nicht angenommen — der eine Fall, der daran zerbräche:
          // Newsletter. Der Kampagnen-Editor ist ein Markdown-Editor
          // (`initialMarkdown`), und renderMarkdown() setzt für `![alt](url)`
          // ein echtes <img> in die Mail:
          //
          //     renderMarkdown("![Torte](https://…/uploads/…webp)")
          //       ->  <p><img src="https://…/uploads/…webp" alt="Torte"></p>
          //
          // Ein Webmailer lädt dieses Bild als Unterressource einer FREMDEN
          // Herkunft. Unter `same-origin` bliebe es leer — im Postfach des
          // Lesers, wo es niemand von uns je zu sehen bekäme. Deshalb steht
          // unten ein eigener Block für /uploads.
          //
          // Das ist KEIN Weichspülen: Für /uploads ist `cross-origin` die
          // wahre Aussage. Dort liegen ausschließlich fertig verarbeitete,
          // für alle identische Bildvarianten (Pfad streng validiert,
          // 20-Hex-Schlüssel + w<Breite>.webp) — nichts Sitzungsabhängiges,
          // das ein Angreifer abgreifen könnte. Die Strenge steht da, wo es
          // etwas zu schützen gibt, und die Erlaubnis da, wo das Einbetten
          // der ZWECK ist.
          //
          // Dass der spätere, speziellere Block den allgemeinen ERSETZT und
          // nicht ergänzt, ist am laufenden Server nachgemessen — eine
          // doppelte Kopfzeile wäre je nach Client beliebig ausgelegt worden:
          //
          //     GET /                          ->  CORP: same-origin   (1x)
          //     GET /uploads/<key>/w640.webp   ->  CORP: cross-origin  (1x)
          //     GET /fonts/…                   ->  CORP: same-origin   (1x)
          //
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        // Die gemessene Ausnahme von oben: Bildvarianten sind öffentlich und
        // sollen eingebettet werden (Newsletter-Bilder im Webmailer). Wer
        // diesen Block streicht, macht sie dort still leer — die Mail ist
        // dann schon verschickt. tests/zap-regeln.test.ts hält ihn fest.
        source: "/uploads/:pfad*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
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
