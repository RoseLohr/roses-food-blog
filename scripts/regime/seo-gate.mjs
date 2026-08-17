#!/usr/bin/env node
/**
 * SEO-/LLM-Gate (blockierend in CI).
 *
 * Anlass (Befund 08/2026): Die ausgelieferte robots.txt verwies monatelang auf
 * „http://localhost:3000/sitemap.xml", die Sitemap auf eine längst abgelegte
 * Domain, und weder Kategorie- noch Reisefilter-Seiten standen überhaupt darin.
 * Kein einziger Test hat davon Notiz genommen. Dieses Gate schließt genau die
 * Lücken, durch die das gefallen ist:
 *
 *   1. ROUTEN-ABDECKUNG   Jede öffentliche Route ist in src/lib/seo/routes.ts
 *                         registriert — als indexierbar oder als begründete
 *                         Ausnahme. Eine neue Seite kann nicht mehr still aus
 *                         Sitemap und llms.txt herausfallen.
 *   2. LAUFZEIT-ARTEFAKTE robots.txt/sitemap.xml/llms.txt sind Routen-Handler
 *                         mit force-dynamic. Die Metadata-Konvention
 *                         (app/robots.ts, app/sitemap.ts) backt den Ursprung
 *                         beim BUILD ein — sie darf nicht zurückkommen.
 *   3. EIN URSPRUNG       Keine hartkodierte Domain, kein localhost, kein
 *                         zweiter BASE_URL-Leser außerhalb lib/base-url.ts.
 *   4. CANONICAL          Jede indexierbare öffentliche Seite setzt eines;
 *                         jede ausgenommene Seite setzt noindex.
 *
 *   (Standard)   Exit≠0 bei jedem Verstoß.
 *   --selftest   Jede Prüfung MUSS ihren geseedeten Verstoß fangen (A-36).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const ROUTES_TS = "src/lib/seo/routes.ts";
const BASE_URL_TS = "src/lib/base-url.ts";
const PUBLIC_DIR = "src/app/(public)";

/** Artefakt-Routen: Pfad → verbotene Metadata-Konventions-Alternative. */
const ARTIFACT_ROUTES = [
  { route: "src/app/robots.txt/route.ts", verboten: "src/app/robots.ts" },
  { route: "src/app/sitemap.xml/route.ts", verboten: "src/app/sitemap.ts" },
  { route: "src/app/llms.txt/route.ts", verboten: null },
];

/**
 * Dateien, in denen „localhost" ein legitimer Fachbegriff ist: der CSRF-Schutz
 * kennt Entwickler-Ursprünge, die Ursprungs-Auflösung erkennt Loopback. Der
 * eigentliche Defekt — localhost als RÜCKFALL — wird davon nicht gedeckt; den
 * fängt LOCALHOST_RUECKFALL überall, auch in diesen beiden Dateien.
 */
const LOCALHOST_ERLAUBT = new Set(["src/lib/csrf.ts", "src/lib/base-url.ts"]);

/** `?? "http://localhost…"` / `|| "http://127.0.0.1…"` — der Ur-Befund. */
const LOCALHOST_RUECKFALL =
  /(\?\?|\|\|)\s*["'`]https?:\/\/(localhost|127\.0\.0\.1|\[?::1)/;

// --- reine Prüf-Funktionen (im Selbsttest gegen Seeds gefahren) -------------

/** Dateipfad im App-Router → Routenmuster („/rezepte/[slug]"). */
export function routeOf(relPath) {
  const withoutFile = relPath
    .replace(/^src\/app\//, "")
    .replace(/\/(page|route)\.tsx?$/, "");
  const segments = withoutFile
    .split("/")
    .filter((s) => s !== "" && !/^\(.*\)$/.test(s));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/** 1. Jede gefundene Route ist registriert. */
export function pruefeRoutenAbdeckung(gefunden, registriert) {
  const bekannt = new Set(registriert);
  return gefunden
    .filter((r) => !bekannt.has(r))
    .map(
      (r) =>
        `Route ${r} ist in ${ROUTES_TS} nicht registriert — als indexierbare Route eintragen oder mit Begründung ausnehmen.`,
    );
}

/** Registrierte Route, die es gar nicht (mehr) gibt — Karteileiche. */
export function pruefeKarteileichen(gefunden, registriert) {
  const vorhanden = new Set(gefunden);
  return registriert
    .filter((r) => !vorhanden.has(r))
    .map((r) => `Route ${r} ist in ${ROUTES_TS} registriert, existiert aber nicht (mehr).`);
}

/** 2. Artefakt-Route existiert, ist force-dynamic, Konvention ist weg. */
export function pruefeArtefakt({ route, quelltext, verbotenExistiert, verboten }) {
  const fehler = [];
  if (quelltext === null) {
    fehler.push(`SEO-Artefakt ${route} fehlt.`);
    return fehler;
  }
  if (!/export const dynamic\s*=\s*["']force-dynamic["']/.test(quelltext)) {
    fehler.push(
      `${route} ohne \`export const dynamic = "force-dynamic"\` — Next rendert die Datei sonst beim BUILD vor und friert den Ursprung ein (genau der localhost-Befund).`,
    );
  }
  if (verbotenExistiert) {
    fehler.push(
      `${verboten} ist zurück. Die Metadata-Konvention wird beim Build vorgerendert; das Artefakt gehört als Routen-Handler nach ${route}.`,
    );
  }
  return fehler;
}

/**
 * Zeilen ohne Kommentare. Kommentare erklären den Befund („… lieferte
 * http://localhost:3000/sitemap.xml aus") — sie dürfen ihn nicht auslösen.
 * Die geprüfte Zeile wird geleert, nicht entfernt: Zeilennummern bleiben gültig.
 */
export function codeZeilen(quelltext) {
  let imBlock = false;
  return quelltext.split("\n").map((zeile) => {
    let code = "";
    // Zeichenketten müssen mitgeführt werden: Ohne das hielte der Scanner das
    // „//" in „https://…" für einen Zeilenkommentar und übersähe genau die
    // hartkodierten URLs, um die es hier geht.
    let anfuehrung = null;
    for (let i = 0; i < zeile.length; i++) {
      const zeichen = zeile[i];
      const zwei = zeile.slice(i, i + 2);
      if (imBlock) {
        if (zwei === "*/") {
          imBlock = false;
          i++;
        }
        continue;
      }
      if (anfuehrung !== null) {
        code += zeichen;
        if (zeichen === "\\" && i + 1 < zeile.length) {
          code += zeile[i + 1];
          i++;
        } else if (zeichen === anfuehrung) {
          anfuehrung = null;
        }
        continue;
      }
      if (zwei === "//") return code;
      if (zwei === "/*") {
        imBlock = true;
        i++;
        continue;
      }
      if (zeichen === "'" || zeichen === '"' || zeichen === "`") anfuehrung = zeichen;
      code += zeichen;
    }
    return code;
  });
}

/** 3. Ein Ursprung: keine fremde/veraltete Domain, kein zweiter env-Leser. */
export function pruefeUrsprung(datei, quelltext) {
  const fehler = [];
  for (const [i, zeile] of codeZeilen(quelltext).entries()) {
    const stelle = `${datei}:${i + 1}`;
    if (/kochbuch\.klee\.me/.test(zeile)) {
      fehler.push(`${stelle}: abgelegte Domain kochbuch.klee.me im Quelltext.`);
    }
    if (/\bgourmetcompass\.de\b/.test(zeile) && datei !== BASE_URL_TS) {
      fehler.push(
        `${stelle}: Domain hartkodiert. Die kanonische Domain steht ausschließlich in ${BASE_URL_TS} (SITE_ORIGIN).`,
      );
    }
    if (/localhost/.test(zeile) && !LOCALHOST_ERLAUBT.has(datei)) {
      fehler.push(
        `${stelle}: localhost im Quelltext — ein nicht-öffentlicher Ursprung gehört in keine Route.`,
      );
    }
    if (LOCALHOST_RUECKFALL.test(zeile)) {
      fehler.push(
        `${stelle}: localhost als Rückfall. Genau so entstand „Sitemap: http://localhost:3000/sitemap.xml" im ausgelieferten Image.`,
      );
    }
    if (/process\.env\.BASE_URL/.test(zeile) && datei !== BASE_URL_TS) {
      fehler.push(
        `${stelle}: zweiter BASE_URL-Leser. Ursprünge kommen aus getBaseUrl()/getPublicBaseUrl().`,
      );
    }
  }
  return fehler;
}

/**
 * 4. Indexierbare Seite → Canonical; ausgenommene Seite → noindex.
 *
 * Nur für `page.tsx`: Ein Routen-Handler (`route.ts`) rendert kein HTML und
 * kennt die Metadata-API gar nicht — dort wäre die Forderung sinnlos.
 */
export function pruefeCanonical({ datei, route, quelltext, ausgenommen }) {
  const fehler = [];
  if (!datei.endsWith("page.tsx")) return fehler;
  const hatCanonical = /canonical\s*:/.test(quelltext);
  const hatNoindex = /index\s*:\s*false/.test(quelltext);
  if (ausgenommen) {
    if (!hatNoindex) {
      fehler.push(
        `${datei}: Route ${route} ist von der Indexierung ausgenommen, setzt aber kein \`robots: { index: false }\`.`,
      );
    }
    return fehler;
  }
  if (!hatCanonical) {
    fehler.push(
      `${datei}: Route ${route} ist indexierbar, setzt aber kein \`alternates.canonical\` — ohne Canonical indexiert Google Parameter-Varianten als eigene Seiten.`,
    );
  }
  return fehler;
}

// --- Registry lesen ---------------------------------------------------------

/** Alle Zeichenketten eines benannten Array-Blocks aus routes.ts. */
function bloecke(quelltext, name, muster) {
  const start = quelltext.indexOf(name);
  if (start < 0) throw new Error(`${name} nicht in ${ROUTES_TS} gefunden.`);
  const ende = quelltext.indexOf("] as const;", start);
  if (ende < 0) throw new Error(`${name} ist in ${ROUTES_TS} nicht abgeschlossen.`);
  const block = quelltext.slice(start, ende);
  return [...block.matchAll(muster)].map((m) => m[1]);
}

function leseRegistry() {
  const quelltext = fs.readFileSync(path.join(ROOT, ROUTES_TS), "utf8");
  const statisch = bloecke(quelltext, "STATIC_ROUTES", /path:\s*"([^"]+)"/g);
  const dynamisch = bloecke(quelltext, "DYNAMIC_ROUTE_PATTERNS", /"(\/[^"]*)"/g);
  const ausgenommen = bloecke(quelltext, "EXCLUDED_ROUTES", /path:\s*"([^"]+)"/g);
  if (statisch.length === 0 || dynamisch.length === 0) {
    throw new Error(`Registry in ${ROUTES_TS} wirkt leer — Parser prüfen.`);
  }
  return { statisch, dynamisch, ausgenommen };
}

function seitenDateien() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^(page\.tsx|route\.ts)$/.test(e.name)) {
        out.push(path.relative(ROOT, p).replaceAll("\\", "/"));
      }
    }
  };
  walk(path.join(ROOT, PUBLIC_DIR));
  return out.sort();
}

// --- Selbsttest (A-36) ------------------------------------------------------

function selbsttest() {
  const proben = [
    [
      "Routen-Abdeckung",
      () => pruefeRoutenAbdeckung(["/neu"], ["/"]).length === 1,
      () => pruefeRoutenAbdeckung(["/"], ["/"]).length === 0,
    ],
    [
      "Karteileiche",
      () => pruefeKarteileichen([], ["/weg"]).length === 1,
      () => pruefeKarteileichen(["/da"], ["/da"]).length === 0,
    ],
    [
      "force-dynamic",
      () =>
        pruefeArtefakt({
          route: "x",
          quelltext: "export async function GET() {}",
          verbotenExistiert: false,
          verboten: null,
        }).length === 1,
      () =>
        pruefeArtefakt({
          route: "x",
          quelltext: 'export const dynamic = "force-dynamic";',
          verbotenExistiert: false,
          verboten: null,
        }).length === 0,
    ],
    [
      "Metadata-Konvention zurück",
      () =>
        pruefeArtefakt({
          route: "x",
          quelltext: 'export const dynamic = "force-dynamic";',
          verbotenExistiert: true,
          verboten: "src/app/robots.ts",
        }).length === 1,
      () => pruefeArtefakt({ route: "x", quelltext: null }).length === 1,
    ],
    [
      "abgelegte Domain",
      () => pruefeUrsprung("src/x.ts", 'const u = "https://kochbuch.klee.me";').length === 1,
      () => pruefeUrsprung("src/x.ts", 'const u = "/rezepte";').length === 0,
    ],
    [
      "localhost-Rückfall",
      () => pruefeUrsprung("src/x.ts", 'const u = "http://localhost:3000";').length > 0,
      () => pruefeUrsprung("src/lib/csrf.ts", '"http://localhost:3000",').length === 0,
    ],
    [
      "zweiter BASE_URL-Leser",
      () => pruefeUrsprung("src/x.ts", "process.env.BASE_URL ?? null").length === 1,
      () => pruefeUrsprung(BASE_URL_TS, "process.env.BASE_URL ?? null").length === 0,
    ],
    [
      "localhost als Rückfall (auch in base-url.ts)",
      () =>
        pruefeUrsprung(BASE_URL_TS, 'return env ?? "http://localhost:3000";').length === 1,
      () => pruefeUrsprung(BASE_URL_TS, 'host === "localhost"').length === 0,
    ],
    [
      "Kommentar löst nicht aus",
      () =>
        pruefeUrsprung("src/x.ts", '// früher: "http://localhost:3000"\nconst a = 1;')
          .length === 0,
      () =>
        pruefeUrsprung("src/x.ts", '/* kochbuch.klee.me */\nconst u = "https://kochbuch.klee.me";')
          .length === 1,
    ],
    [
      "fehlendes Canonical",
      () =>
        pruefeCanonical({
          datei: "src/x/page.tsx",
          route: "/x",
          quelltext: "export const metadata = { title: 'x' };",
          ausgenommen: false,
        }).length === 1,
      () =>
        pruefeCanonical({
          datei: "src/x/page.tsx",
          route: "/x",
          quelltext: "alternates: { canonical: '/x' }",
          ausgenommen: false,
        }).length === 0,
    ],
    [
      "fehlendes noindex auf Ausnahme",
      () =>
        pruefeCanonical({
          datei: "src/x/page.tsx",
          route: "/x",
          quelltext: "export const metadata = {};",
          ausgenommen: true,
        }).length === 1,
      () =>
        pruefeCanonical({
          datei: "src/x/route.ts",
          route: "/x",
          quelltext: "export async function GET() {}",
          ausgenommen: true,
        }).length === 0,
    ],
  ];

  let schlecht = 0;
  for (const [name, faengtSeed, laesstSauberesDurch] of proben) {
    const ok = faengtSeed() && laesstSauberesDurch();
    console.log(`   ${ok ? "✓" : "✗"} Selbsttest: ${name}`);
    if (!ok) schlecht++;
  }
  if (schlecht > 0) {
    console.error(`\n⛔ SEO-Gate: ${schlecht} Prüfung(en) fangen ihren Seed nicht (A-36).`);
    process.exit(1);
  }
}

// --- Hauptlauf --------------------------------------------------------------

if (process.argv.includes("--selftest")) selbsttest();

const registry = leseRegistry();
const registriert = [
  ...registry.statisch,
  ...registry.dynamisch,
  ...registry.ausgenommen,
];
const ausgenommen = new Set(registry.ausgenommen);

const dateien = seitenDateien();
const routen = dateien.map(routeOf);

const fehler = [
  ...pruefeRoutenAbdeckung(routen, registriert),
  ...pruefeKarteileichen(routen, registriert),
];

for (const artefakt of ARTIFACT_ROUTES) {
  const abs = path.join(ROOT, artefakt.route);
  fehler.push(
    ...pruefeArtefakt({
      route: artefakt.route,
      quelltext: fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null,
      verbotenExistiert:
        artefakt.verboten !== null && fs.existsSync(path.join(ROOT, artefakt.verboten)),
      verboten: artefakt.verboten,
    }),
  );
}

for (const [i, datei] of dateien.entries()) {
  const quelltext = fs.readFileSync(path.join(ROOT, datei), "utf8");
  fehler.push(
    ...pruefeCanonical({
      datei,
      route: routen[i],
      quelltext,
      ausgenommen: ausgenommen.has(routen[i]),
    }),
  );
}

// Ursprungs-Prüfung über den gesamten Produktionsquelltext (ohne Tests).
const alleQuellen = [];
const walkSrc = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSrc(p);
    else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) {
      alleQuellen.push(path.relative(ROOT, p).replaceAll("\\", "/"));
    }
  }
};
walkSrc(path.join(ROOT, "src"));
for (const datei of alleQuellen) {
  fehler.push(...pruefeUrsprung(datei, fs.readFileSync(path.join(ROOT, datei), "utf8")));
}

if (fehler.length > 0) {
  for (const f of fehler) console.error(`   ✗ ${f}`);
  console.error(`\n⛔ SEO-Gate: ${fehler.length} Verstoß/Verstöße. Merge blockiert.`);
  process.exit(1);
}
console.log(
  `[seo-gate] ${routen.length} öffentliche Routen registriert, ${ARTIFACT_ROUTES.length} Artefakte laufzeit-dynamisch, ${alleQuellen.length} Quelldateien mit einem Ursprung. Grün.`,
);
