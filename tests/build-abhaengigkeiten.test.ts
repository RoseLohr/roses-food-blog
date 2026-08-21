/**
 * Der Image-Build darf nicht daran scheitern, dass ein Paket beim Installieren
 * etwas übersetzen will.
 *
 * VORFALL 2026-08-16 (Commit 298e6b6, Produktion konnte nicht aktualisiert
 * werden): `npm ci` brach im `deps`-Stage ab —
 *
 *   npm error path /app/node_modules/better-sqlite3
 *   npm error command sh -c node-gyp rebuild
 *   npm error gyp ERR! find Python … Could not find any Python installation
 *
 * URSACHE, GENAU: better-sqlite3 13 liefert fertige Binärdateien mit
 * (`prebuilds/linux-x64.node`), enthält aber ZUGLEICH eine `binding.gyp` und
 * definiert kein eigenes `install`-Skript. Genau dann ergänzt npm von sich aus
 * `node-gyp rebuild`. Gescheitert ist dabei NICHT das Übersetzen: Die
 * binding.gyp ist extra so gebaut, dass sie bei vorhandener Binärdatei nichts
 * tut (beide Targets unter `force_build==1 or prebuild_exists==0`, sonst
 * `type: none`). node-gyp kommt dort nur nie an — schon der configure-Schritt
 * braucht Python, und `node:22-bookworm-slim` hat keins. Es scheiterte also die
 * Vorbereitung eines Leerlaufs. Bis Version 12 stand dort
 * `prebuild-install || node-gyp rebuild`; der Sprung auf 13.0.1 (PR #46)
 * entfernte das Skript. 13.0.2 und 13.0.3 sind unverändert — ein
 * Versionssprung behebt es nicht.
 *
 * Die Korrektur ist `npm ci --ignore-scripts` im Containerfile: Ohne
 * Lifecycle-Skripte wird die mitgelieferte Binärdatei benutzt, so wie vom
 * Paket vorgesehen — und es läuft kein Fremdcode beim Installieren.
 *
 * DREI LINIEN SICHERN DAS AB:
 *  1. Diese Datei ratifiziert, WELCHE Pakete beim Installieren etwas täten.
 *     `--ignore-scripts` gilt für den ganzen Baum; käme ein Paket hinzu, das
 *     sein Skript WIRKLICH braucht, würde es ohne Kontrolle still falsch
 *     installiert und der Fehler zeigte sich erst zur Laufzeit.
 *  2. Der Schnelltest im Containerfile lässt better-sqlite3 wirklich arbeiten
 *     (Tabelle anlegen, schreiben, lesen) statt es nur zu laden.
 *  3. Der CI-Job `image` BAUT das Image tatsächlich. Das ist die einzige
 *     Kontrolle, die den Vorfall von 2026-08-16 wirklich gefangen hätte —
 *     Textprüfungen wie die hier lesen den Bauplan, sie bauen nicht. Ohne
 *     Job 3 wäre diese Datei eine Kontrolle, die Sicherheit nur behauptet.
 *
 * DATENQUELLE der Ratifizierung ist package-lock.json, nicht node_modules. npm
 * hält dort `hasInstallScript` fest — auch für den impliziten node-gyp-Fall
 * (better-sqlite3 steht mit `hasInstallScript: true` drin, obwohl es kein
 * eigenes Skript definiert). Ein Durchlauf durch node_modules übersähe zudem
 * alles, was auf DIESER Plattform nicht installiert wird (z. B. fsevents, nur
 * macOS) — die Kontrolle wäre je nach Rechner unterschiedlich streng.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const containerfile = fs.readFileSync(path.join(ROOT, "Containerfile"), "utf8");
const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const lock = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"),
) as { packages: Record<string, { hasInstallScript?: boolean; version?: string }> };

/**
 * Das Containerfile in LOGISCHE Instruktionen zerlegen — Kommentarzeilen raus,
 * Backslash-Fortsetzungen zusammengefügt, Leerraum vereinheitlicht.
 *
 * Warum nicht zeilenweise prüfen (Befund der Gegenprüfung, 2026-08-16): Eine
 * zeilengebundene Zusicherung ist blind für genau die Schreibweise, die diese
 * Datei selbst benutzt. `RUN apt-get install -y \` + Umbruch + `python3` stünde
 * dann nicht „in einer Zeile mit apt-get install" — die Kontrolle bliebe grün,
 * obwohl die Werkzeugkette zurück im Image ist. Der Docker-Parser fügt genau so
 * zusammen; also muss die Kontrolle das auch tun.
 */
function instruktionen(text: string): string[] {
  const fertig: string[] = [];
  let puffer = "";
  for (const roh of text.split("\n")) {
    // Kommentarzeilen entfernt der Parser ebenfalls — auch mitten in einer
    // fortgesetzten Instruktion.
    if (/^\s*#/.test(roh)) continue;
    const setztFort = /\\\s*$/.test(roh);
    puffer += `${roh.replace(/\\\s*$/, " ")} `;
    if (!setztFort) {
      const zusammen = puffer.replace(/\s+/g, " ").trim();
      if (zusammen) fertig.push(zusammen);
      puffer = "";
    }
  }
  const rest = puffer.replace(/\s+/g, " ").trim();
  if (rest) fertig.push(rest);
  return fertig;
}

const ANWEISUNGEN = instruktionen(containerfile);

/**
 * RATIFIZIERT — Pakete, die beim Installieren etwas ausführen würden, mit dem
 * Nachweis, warum das Auslassen unschädlich ist. Nachgemessen am 2026-08-16
 * mit `npm ci --ignore-scripts`: build, alle Tests und die nativen Module liefen.
 *
 * Bewusst mit `null`-Prototyp: Bei einem gewöhnlichen Objektliteral gälten
 * `constructor`, `toString` und Konsorten über die Prototypkette automatisch
 * als ratifiziert — ein Paket dieses Namens käme lautlos durch.
 */
const RATIFIZIERT: Record<string, string> = Object.assign(Object.create(null), {
  "better-sqlite3":
    "Kein eigenes install-Skript; die binding.gyp löst nur den npm-Standard " +
    "`node-gyp rebuild` aus und wäre bei vorhandener Binärdatei ohnehin ein " +
    "Leerlauf. Das Paket liefert prebuilds/linux-x64.node mit. Nachgemessen " +
    "ohne Skripte: Tabelle anlegen, schreiben, lesen — und der Schnelltest im " +
    "Containerfile wiederholt das bei jedem Bau der deps-Stufe.",
  esbuild:
    "postinstall (install.js) prüft/verlinkt nur die Plattform-Binärdatei aus " +
    "@esbuild/*. Nachgemessen ohne postinstall: transformSync, tsx und " +
    "drizzle-kit arbeiten. Kommt im Baum mehrfach in verschiedenen Versionen vor.",
  fsevents:
    "Nur macOS (os: darwin). Im Linux-Image wird es gar nicht erst installiert, " +
    "sein Skript kann dort also nichts bewirken. Lokal auf einem Mac betrifft " +
    "es ausschließlich das Datei-Beobachten im Entwicklungsmodus.",
});

/** Paketnamen aus dem Lockfile, für die npm ein Install-Skript ausführen würde. */
function paketeMitInstallSkript(): Set<string> {
  const namen = new Set<string>();
  for (const [pfad, eintrag] of Object.entries(lock.packages)) {
    if (!eintrag.hasInstallScript) continue;
    // Pfadform: "node_modules/x" oder "node_modules/a/node_modules/@scope/x".
    const stelle = pfad.lastIndexOf("node_modules/");
    if (stelle === -1) continue;
    namen.add(pfad.slice(stelle + "node_modules/".length));
  }
  return namen;
}

describe("Image-Build: keine Übersetzung aus Quelltext beim Installieren", () => {
  const npmCi = ANWEISUNGEN.filter((i) => /^RUN\b.*\bnpm ci\b/.test(i));

  it("es gibt überhaupt eine Installation zu prüfen", () => {
    expect(npmCi.length, "keine `RUN … npm ci`-Anweisung im Containerfile").toBeGreaterThan(0);
  });

  it("JEDE Installation läuft ohne Lifecycle-Skripte", () => {
    // Bewusst alle Vorkommen, nicht nur das erste: Eine zweite Installation in
    // einer späteren Stufe entkäme einer `find()`-Prüfung lautlos.
    const ohne = npmCi.filter((i) => !/(^|\s)--ignore-scripts(\s|$)/.test(i));
    expect(
      ohne,
      "ohne --ignore-scripts ergänzt npm für better-sqlite3 `node-gyp rebuild` — " +
        `im Slim-Image gibt es dafür weder Python noch Compiler:\n${ohne.join("\n")}`,
    ).toEqual([]);
  });

  it("die Fahne wird nicht im selben Atemzug wieder abgeschaltet", () => {
    // `--ignore-scripts=false` ENTHÄLT die Zeichenkette `--ignore-scripts`,
    // schaltet die Skripte aber wieder ein (npm zerlegt das über nopt in Flag +
    // Wert). Eine Prüfung auf „kommt vor" wäre also austrickbar.
    for (const i of npmCi) {
      expect(i, "--ignore-scripts=false hebt die Fahne wieder auf").not.toMatch(
        /--ignore-scripts=(false|0)/,
      );
      expect(i, "--no-ignore-scripts hebt die Fahne wieder auf").not.toMatch(
        /--no-ignore-scripts/,
      );
    }
  });

  it("das Basisimage bekommt keine Werkzeugkette nachinstalliert", () => {
    // Gegenprobe: Wer `--ignore-scripts` entfernt und stattdessen Python und
    // Compiler nachlegt, ermöglicht einen Schritt, der nachweislich nichts
    // erzeugt. Geprüft wird auf den ZUSAMMENGEFÜGTEN Anweisungen, damit die
    // übliche mehrzeilige Schreibweise nicht daran vorbeiläuft.
    const werkzeuge = ANWEISUNGEN.filter(
      (i) =>
        /\bapt(-get)?\b[^\n]*\binstall\b/.test(i) &&
        /(\bpython3?\b|\bbuild-essential\b|\bgcc\b|\bmake\b|\bcmake\b|g\+\+|\bclang\b)/.test(i),
    );
    expect(
      werkzeuge,
      `Werkzeugkette wird ins Image gelegt:\n${werkzeuge.join("\n")}`,
    ).toEqual([]);
  });

  it("die Basisimages bleiben die schlanken (sonst käme die Werkzeugkette durch die Hintertür)", () => {
    // `node:22-bookworm` (ohne -slim) bringt Python und Compiler bereits mit.
    // Ein Wechsel dorthin hebelte die Kontrolle darüber aus, ohne dass je ein
    // apt-get im Containerfile stünde.
    const froms = ANWEISUNGEN.filter((i) => /^FROM\b/.test(i));
    expect(froms.length, "keine FROM-Anweisung gefunden").toBeGreaterThan(0);
    for (const f of froms) {
      expect(f, `Basisimage ohne -slim: ${f}`).toMatch(/node:\d+-bookworm-slim\b/);
    }
  });

  it("der Schnelltest BENUTZT better-sqlite3, statt es nur zu laden", () => {
    // Seit die Binärdatei aus dem Paket kommt statt aus einem Build, ist
    // „require() wirft nicht" zu wenig: Der Test muss die native Bindung
    // wirklich arbeiten lassen — sonst fiele eine unpassende Binärdatei
    // (falsche ABI, falsche glibc) erst im laufenden Betrieb auf.
    //
    // Verankert an der ANWEISUNG, nicht am Vorkommen im Dateitext: Sonst
    // erfüllte auch eine auskommentierte Zeile die Zusicherung, und die
    // Kontrolle ließe sich abschalten, ohne rot zu werden.
    const test = ANWEISUNGEN.find(
      (i) => /^RUN\b/.test(i) && i.includes("require('better-sqlite3')"),
    );
    expect(test, "kein RUN-Schnelltest für better-sqlite3 gefunden").toBeTruthy();
    expect(test).toMatch(/\.prepare\(/);
    expect(test).toMatch(/throw new Error/);
  });
});

describe("Der Bauplan wird nicht nur gelesen, sondern gebaut", () => {
  it("CI baut das Container-Image", () => {
    // DIE eigentliche Lehre aus dem 2026-08-16: Kein Gate hat je das Image
    // gebaut. Der Fehler konnte deshalb nur auf dem Produktionsserver
    // auftreten — nach dem Merge, beim Deploy. Alle Kontrollen oben lesen den
    // Bauplan; nur dieser Job führt ihn aus.
    expect(ci, "kein Image-Build im CI-Gate").toMatch(/docker build|podman build|buildah/);
    expect(ci).toMatch(/-f Containerfile|--file Containerfile/);
  });

  it("der CI-Bau prüft das fertige Image, nicht nur den Bauvorgang", () => {
    // Ein Build, der durchläuft, beweist noch nicht, dass die Binärdatei im
    // AUSGELIEFERTEN Image arbeitet — die deps-Stufe ist nicht das Laufzeit-
    // Image. Deshalb muss der Job das gebaute Image auch starten.
    expect(ci).toMatch(/docker run|podman run/);
  });
});

describe("Tripwire: Pakete mit Install-Skript sind ratifiziert", () => {
  const gefunden = paketeMitInstallSkript();

  it("das WURZELPAKET selbst führt beim Installieren nichts aus", () => {
    // Eigener Eintrag, eigener Test: Im Lockfile steht das Projekt selbst unter
    // dem leeren Schlüssel "" — ohne `node_modules/` im Pfad. Die Auswertung
    // oben überspringt ihn deshalb, und ein `postinstall` in unserer EIGENEN
    // package.json würde vom Image still übergangen (nachgestellt: `npm ci`
    // führt es aus, `npm ci --ignore-scripts` nicht — beide grün). Genau die
    // Sorte Lücke, die erst zur Laufzeit auffällt.
    expect(
      lock.packages[""]?.hasInstallScript ?? false,
      "package.json hat ein install-/postinstall-Skript bekommen. Der Image-Build " +
        "läuft mit --ignore-scripts und würde es überspringen — der Schritt muss " +
        "stattdessen ausdrücklich ins Containerfile.",
    ).toBe(false);
  });

  it("das Lockfile liefert überhaupt Treffer", () => {
    // Ohne diese Zusicherung wäre die Kontrolle darunter still grün, sobald
    // npm das Feld umbenennt oder das Lockfile-Format wechselt — eine
    // Kontrolle, die nicht mehr feuert.
    expect(
      gefunden.size,
      "kein einziges Paket mit hasInstallScript — Lockfile-Format geprüft?",
    ).toBeGreaterThan(0);
  });

  it("kein UNRATIFIZIERTES Paket führt beim Installieren etwas aus", () => {
    const neu = [...gefunden].filter((n) => !Object.hasOwn(RATIFIZIERT, n)).sort();
    expect(
      neu,
      `Neue Pakete mit Install-Skript: ${neu.join(", ")}.\n` +
        "Der Image-Build läuft mit --ignore-scripts. Für jedes dieser Pakete ist zu " +
        "PRÜFEN, ob es sein Skript wirklich braucht — und das Ergebnis gehört mit " +
        "Begründung in die RATIFIZIERT-Tabelle dieser Datei.",
    ).toEqual([]);
  });

  it("die Tabelle führt keine Karteileichen", () => {
    // Eine ratifizierte Zeile ohne zugehöriges Paket ist toter Text, der
    // vortäuscht, etwas sei geprüft worden. Die Liste darf nur schrumpfen,
    // wenn das Paket wirklich verschwindet.
    const verwaist = Object.keys(RATIFIZIERT)
      .filter((n) => !gefunden.has(n))
      .sort();
    expect(
      verwaist,
      `RATIFIZIERT nennt Pakete, die es nicht mehr gibt: ${verwaist.join(", ")}`,
    ).toEqual([]);
  });
});

/**
 * Was `migrate.mjs` lädt, muss auch im Laufzeit-Image liegen.
 *
 * Das Standalone-Image enthält NICHT den Quelltext, sondern nur einzeln
 * kopierte Skripte. Ein `import` in einem dieser Skripte, dessen Ziel niemand
 * kopiert, fällt deshalb nicht beim Bauen auf und nicht im Test — sondern erst
 * beim Start auf dem Server, wenn migrate.mjs abbricht und der Container nicht
 * hochkommt. Diese Kontrolle folgt den relativen Importen und besteht darauf,
 * dass für jede erreichte Datei eine COPY-Zeile existiert.
 */
describe("Laufzeit-Image: Migrationsskripte sind vollständig", () => {
  /** Ziele aller `COPY --from=build /app/X ./Y`-Zeilen, als Repo-Pfade. */
  const kopiert = new Set(
    instruktionen(containerfile)
      .filter((i) => i.startsWith("COPY --from=build /app/"))
      .map((i) => i.split(/\s+/)[2].replace("/app/", "")),
  );

  /** Relative Importe einer Datei, aufgelöst zu Repo-Pfaden. */
  function importe(datei: string): string[] {
    const quelle = fs.readFileSync(path.join(ROOT, datei), "utf8");
    // Statisch (`import x from "./y"`) UND dynamisch (`await import("./y")`) —
    // migrate.mjs benutzt die zweite Form, und genau die hätte eine Kontrolle
    // übersehen, die nur nach dem Schlüsselwort am Zeilenanfang sucht.
    const treffer = [
      ...quelle.matchAll(/(?:^|\s)(?:import|from)\s+["'](\.[^"']+)["']/gm),
      ...quelle.matchAll(/\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g),
    ];
    const ordner = path.posix.dirname(datei);
    return treffer.map((m) => path.posix.normalize(path.posix.join(ordner, m[1])));
  }

  it("jede von migrate.mjs erreichte Datei wird ins Image kopiert", () => {
    const offen = ["scripts/migrate.mjs"];
    const gesehen = new Set<string>();
    const fehlend: string[] = [];
    while (offen.length) {
      const datei = offen.pop()!;
      if (gesehen.has(datei)) continue;
      gesehen.add(datei);
      for (const ziel of importe(datei)) {
        // Ein ganzes Verzeichnis zu kopieren deckt alles darunter ab.
        const abgedeckt = [...kopiert].some(
          (k) => k === ziel || ziel.startsWith(k.endsWith("/") ? k : `${k}/`),
        );
        if (!abgedeckt) fehlend.push(`${datei} → ${ziel}`);
        offen.push(ziel);
      }
    }
    expect(
      fehlend,
      "Diese Importe erreicht migrate.mjs zur Laufzeit, aber das Containerfile " +
        "kopiert ihr Ziel nicht ins Laufzeit-Image. Der Container käme auf dem " +
        "Server nicht hoch.",
    ).toEqual([]);
    // Die Kontrolle muss überhaupt etwas verfolgt haben, sonst ist sie blind.
    expect(gesehen.size).toBeGreaterThan(1);
  });
});
