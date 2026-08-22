#!/usr/bin/env node
/**
 * Doku-Gates — REGRESSIONSSCHUTZ, ausdrücklich KEINE Drift-Erkennung.
 *
 * Was dieses Skript NICHT kann, damit sich niemand darauf verlässt: Es kann
 * nicht prüfen, ob eine Aussage über den Server stimmt. Ob der Proxy-Host die
 * Anwendung wirklich unter der beschriebenen Adresse erreicht, steht in keiner
 * Datei — das sind die Messfragen M1–M8 in `audit/12-infrastruktur-fahrplan.md`,
 * und solange sie offen sind, kann kein statisches Gate sie beantworten. Wer
 * hier eine Drift-Erkennung hineinliest, hat eine Kontrolle, die im
 * entscheidenden Fall stumm ist.
 *
 * Was es kann: verhindern, dass drei bereits behobene Fehlerklassen
 * zurückkommen. Alle drei sind am Bestand gemessen, nicht vermutet.
 *
 * 1. VERALTETE ANLEITUNG (Spur A2/A3, `audit/11-infrastruktur-befund.md` §1).
 *    Die README beschrieb einen Debian-nginx auf dem Host samt certbot. Den
 *    gibt es hier nicht; wer der Anleitung folgte, richtete einen ZWEITEN
 *    Webserver ein, der mit dem Betrieb nichts zu tun hat. Für den
 *    A-37-Takeover-Drill war das der schwerwiegendste Befund.
 *
 *    Verboten sind die Anweisungen, nicht die Wörter: geprüft wird NUR, was
 *    Code ist — umzäunt (``` oder ~~~) oder eingerückt. Fließtext darf und
 *    soll weiter sagen, dass es certbot hier nicht gibt; genau das steht als
 *    Zitatblock in README §2. Ein Codeblock unter einer Überschrift, die
 *    „historisch" enthält, ist ausgenommen; so ist der aufbewahrte
 *    Host-nginx-Weg gekennzeichnet.
 *
 * 2. TOTE ANNAHMENUMMERN. Verweise der Form „A1"…„A11" zeigten auf eine
 *    Nummerierung aus dem Projektauftrag, die im Repository NIRGENDS
 *    niedergeschrieben ist (`governance/mandate.md` kennt sie nicht). Wer sie
 *    las, suchte etwas, das es nicht gibt. Sie sind aus README, `docs/` und
 *    `src/` entfernt; hier bleiben sie draußen.
 *
 *    `audit/` ist ausgenommen, und das ist kein Schlupfloch: Dort sind A1–A3
 *    die SPURENNAMEN der Infrastruktur-Erhebung, in derselben Datei in einer
 *    Tabelle definiert (`audit/11-infrastruktur-befund.md`). Gleiches Zeichen,
 *    anderes Bezugssystem. In `src/` wird nur in Kommentarzeilen gesucht —
 *    „A2" kann dort sonst ein Bezeichner sein.
 *
 * 3. PFADVERWEISE INS LEERE. Beim A2/A3-Inventar waren von 565 nachgeschlagenen
 *    Referenzen 53 Zeilennummern falsch und 43 Fundstellen übersehen. Ein
 *    Pfad in Backticks, den es nicht gibt, ist eine Behauptung, die beim Lesen
 *    nicht auffällt.
 *
 *    Für `audit/` gilt eine engere Regel — und der Grund ist inhaltlich: Ein
 *    Befund- oder Fahrplandokument nennt planmäßig Dinge, die es noch nicht
 *    gibt (`scripts/regime/erhebung.sh` aus Spur A1) oder nicht mehr. Ein
 *    Verweis MIT Zeilennummer kann das aber nie sein: Man zitiert keine Zeile
 *    einer Datei, die nicht existiert. Dort wird deshalb genau das geprüft.
 *
 *    Ehrlich zur Reichweite: Die Zeilennummer wird nur erkannt, wenn sie IN
 *    denselben Backticks steht (`datei.ts:42`). Steht sie als eigenes Stück
 *    hinter dem Pfad, sieht dieses Gate sie nicht.
 *
 * FÜNF LÖCHER, DIE DIE ERSTE FASSUNG HATTE (Veto des Pflicht-Approvers
 * gpt-5.6-sol, PR #109 — drei davon von ihm benannt, zwei beim Nachziehen
 * derselben Klasse gefunden). Jedes ist unten als Selbsttestfall festgenagelt:
 *
 *   a) ÜBERSCHRIFTEN WURDEN AUCH IM CODEBLOCK AUSGEWERTET. Eine Shell-Zeile
 *      `# historisch: alter Weg` INNERHALB eines Zauns setzte die Ausnahme —
 *      und schaltete das Anleitungsgate für den Rest des Blocks und alles
 *      danach ab. In Markdown ist eine Raute im Zaun gar keine Überschrift.
 *   b) `~~~` GALT NICHT ALS ZAUN. Ein damit umzäunter Block wurde nicht als
 *      Code erkannt und deshalb GAR NICHT geprüft — die Umgehung bestand aus
 *      einem anderen Zaunzeichen.
 *   c) EINGERÜCKTER CODE WURDE NICHT GEPRÜFT. Markdown kennt drei Codeformen;
 *      erkannt wurde eine.
 *   d) DIE ZEILENPRÜFUNG SPRANG BEI EINER ABKÜRZUNG AB. `audit/06:99999`
 *      löste nur für die Existenzfrage auf; die Zeilenzahl wurde danach
 *      übersprungen, weil der Rohpfad nicht existiert.
 *   e) UNMÖGLICHE ANGABEN GALTEN ALS GÜLTIG. `src/lib:999` (Zeile an einem
 *      VERZEICHNIS), `datei:100-10` (Bereich rückwärts) und `datei:0` liefen
 *      grün durch, weil nur die Obergrenze gegen die Dateilänge geprüft wurde.
 *
 * Kalibrierung (A-36): `--selftest` führt für jede Prüfung einen synthetischen
 * Verstoß ein und bestätigt, dass sie ihn fängt — und für die Ausnahmen
 * (historischer Block, Fließtext, Prüfkennung, Bezeichner in `src/`), dass sie
 * NICHT feuern.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

/**
 * Dateiliste wie in `source-gates.mjs`: `--others --exclude-standard` nimmt
 * neue, noch nicht verfolgte Dateien MIT. Ohne das ist ein örtlicher Lauf vor
 * dem Commit grün, obwohl die neue Datei den Verstoß trägt — genau so ist am
 * 2026-08-21 ein Heredoc-Verstoß erst in CI aufgefallen.
 */
function dateien() {
  return execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** Oberste Verzeichnisse dieses Repositories — nur damit fängt ein Pfadverweis an. */
const WURZELN = "src|scripts|tests|docs|deploy|governance|audit|drizzle|config|public|\\.github";
const PFAD_RE = new RegExp(`^((?:${WURZELN})/[^:\\s]*?)(?::(\\d+)(?:-(\\d+))?)?$`);

/** Anweisungen, die zum abgeschalteten Host-nginx-Betrieb gehören. */
export const VERALTETE_ANLEITUNG = /\bcertbot\b|\bsites-available\b|\/etc\/letsencrypt\b/;

/** „A1"…„A11" ohne Bindestrich — die Nummerierung, die es nicht gibt.
 *  Der Bindestrich trennt sie von den Prüfkennungen A-16, A-20, A-33. */
export const TOTE_NUMMER = /(?<![A-Za-z0-9_/.-])A(1[01]|[1-9])(?![0-9A-Za-z-])/;

/** Kommentarzeile in TypeScript/CSS — nur dort wird in `src/` gesucht. */
export const KOMMENTARZEILE = /^\s*(\/\/|\/\*|\*)/;

/**
 * Prüfung 1: verbotene Anleitung in Code.
 *
 * Markdown kennt DREI Codeformen, und alle drei zählen: ```-Zaun, ~~~-Zaun und
 * Einrückung. Eine eingerückte Zeile, die mit einem Listenzeichen oder `>`
 * beginnt, ist Fortsetzung von Fließtext und kein Code.
 *
 * Gibt die beanstandeten Zeilennummern zurück (1-basiert).
 */
export function verboteneAnleitung(text) {
  const treffer = [];
  let zaun = null; // Zeichen des offenen Zauns, oder null
  let unterHistorisch = false;
  text.split("\n").forEach((zeile, i) => {
    const zaunZeile = /^\s*(```|~~~)/.exec(zeile);
    if (zaunZeile) {
      if (zaun === null) {
        zaun = zaunZeile[1];
        return;
      }
      if (zaun === zaunZeile[1]) {
        zaun = null;
        return;
      }
      // Fremdes Zaunzeichen INNERHALB eines Zauns schließt nichts — die Zeile
      // ist gewöhnlicher Code und fällt unten durch die Prüfung.
    }
    // Überschriften NUR außerhalb eines Zauns: `# …` im Codeblock ist eine
    // Raute, keine Überschrift (Loch a).
    if (zaun === null && /^#{1,6}\s/.test(zeile)) {
      unterHistorisch = /historisch/i.test(zeile);
      return;
    }
    const eingerueckt = /^(\t| {4})/.test(zeile) && !/^\s*([-*+>]|\d+\.)\s/.test(zeile);
    if ((zaun !== null || eingerueckt) && !unterHistorisch && VERALTETE_ANLEITUNG.test(zeile)) {
      treffer.push(i + 1);
    }
  });
  return treffer;
}

/** Prüfung 2: tote Annahmenummer. `nurKommentare` für Quelltext. */
export function toteNummern(text, nurKommentare) {
  const treffer = [];
  text.split("\n").forEach((zeile, i) => {
    if (nurKommentare && !KOMMENTARZEILE.test(zeile)) return;
    if (TOTE_NUMMER.test(zeile)) treffer.push(i + 1);
  });
  return treffer;
}

/**
 * Pfadverweise einer Zeile: alles in Backticks, das wie ein Repo-Pfad aussieht.
 * Platzhalter (`*`, `<…>`, `{…}`) sind keine Verweise, sondern Muster.
 */
export function pfadverweise(zeile) {
  const raus = [];
  for (const m of zeile.matchAll(/`([^`\s]+)`/g)) {
    if (/[*<>{}]/.test(m[1])) continue;
    const t = PFAD_RE.exec(m[1]);
    if (!t) continue;
    raus.push({
      text: m[1],
      pfad: t[1].replace(/[.,;:)]+$/, ""),
      von: t[2] === undefined ? null : Number(t[2]),
      bis: t[3] === undefined ? (t[2] === undefined ? null : Number(t[2])) : Number(t[3]),
    });
  }
  return raus;
}

/**
 * Löst einen Verweis auf die Datei auf, die er meint.
 *
 * Auch eine EINDEUTIGE Abkürzung zählt: `audit/06` meint
 * `audit/06-residual-risk-register.md`, und diese Schreibweise steht unter
 * anderem in der Verfassung. Mehrdeutig ist sie kein Verweis mehr — dann `null`,
 * genau wie bei „gibt es nicht".
 *
 * Der aufgelöste Pfad wird ZURÜCKGEGEBEN und nicht bloß als „trifft/trifft
 * nicht" verworfen: Sonst hängt die Zeilenprüfung am Rohpfad und springt bei
 * jeder Abkürzung ab (Loch d).
 */
export function aufloesen(pfad, alle) {
  if (fs.existsSync(pfad)) return pfad;
  const treffer = alle.filter((f) => f.startsWith(pfad));
  return treffer.length === 1 ? treffer[0] : null;
}

/**
 * Prüft eine Zeilenangabe gegen die aufgelöste Datei.
 * Gibt den Beanstandungstext zurück oder `null`, wenn sie in Ordnung ist.
 */
export function zeilenBefund(datei, von, bis) {
  if (!fs.statSync(datei).isFile()) return "Zeilennummer an einem Verzeichnis";
  if (von < 1) return "Zeilennummer 0 gibt es nicht";
  if (bis < von) return `Zeilenbereich rückwärts (${von}–${bis})`;
  const zeilen = fs.readFileSync(datei, "utf8").split("\n").length;
  if (bis > zeilen) return `jenseits des Dateiendes (${datei} hat ${zeilen} Zeilen)`;
  return null;
}

function main() {
  const alle = dateien();
  let verstoesse = 0;
  const melde = (art, ort, text) => {
    console.error(`❌ ${art} ${ort}: ${text}`);
    verstoesse++;
  };

  let gezaehlt = 0;
  for (const datei of alle) {
    const imAudit = datei.startsWith("audit/");
    const istQuelle = datei.startsWith("src/") && /\.(ts|tsx|css)$/.test(datei);
    const istMd = datei.endsWith(".md");
    if (!istMd && !istQuelle) continue;
    const text = fs.readFileSync(datei, "utf8");
    const zeilen = text.split("\n");

    if (istMd && !imAudit) {
      for (const nr of verboteneAnleitung(text)) {
        melde("Veraltete Anleitung im Code (A2/A3)", `${datei}:${nr}`, zeilen[nr - 1].trim());
      }
    }

    if (!imAudit) {
      for (const nr of toteNummern(text, istQuelle)) {
        melde("Verweis auf eine Nummerierung, die es nicht gibt", `${datei}:${nr}`, zeilen[nr - 1].trim());
      }
    }

    if (!istMd) continue;
    zeilen.forEach((zeile, i) => {
      for (const v of pfadverweise(zeile)) {
        // In `audit/` nur Verweise MIT Zeilennummer — siehe Kopf.
        if (imAudit && v.von === null) continue;
        gezaehlt++;
        const ziel = aufloesen(v.pfad, alle);
        if (ziel === null) {
          melde("Pfadverweis ins Leere", `${datei}:${i + 1}`, v.text);
          continue;
        }
        if (v.von === null) continue;
        const befund = zeilenBefund(ziel, v.von, v.bis);
        if (befund) melde("Unbrauchbare Zeilenangabe", `${datei}:${i + 1}`, `${v.text} — ${befund}`);
      }
    });
  }

  if (verstoesse) {
    console.error(`\n⛔ ${verstoesse} Doku-Gate-Verstoß/Verstöße. Build gestoppt.`);
    process.exit(1);
  }
  console.log(`[doku-gate] ${gezaehlt} Pfadverweise, Anleitungen und Nummern geprüft: grün.`);
}

if (process.argv.includes("--selftest")) {
  const zaun = "```";
  const welle = "~~~";
  const alle = dateien();
  const faelle = [
    // Prüfung 1 — fängt den Verstoß in allen drei Codeformen …
    ["Anleitung im ```-Zaun", verboteneAnleitung(`## Setup\n${zaun}\nsudo certbot --nginx\n${zaun}\n`).length === 1],
    ["Anleitung im ~~~-Zaun (Loch b)", verboteneAnleitung(`## Setup\n${welle}\nsudo certbot --nginx\n${welle}\n`).length === 1],
    ["Anleitung eingerückt (Loch c)", verboteneAnleitung("## Setup\n\n    sudo certbot --nginx\n").length === 1],
    // … und feuert NICHT unter einer historischen Überschrift …
    ["historischer Block bleibt frei", verboteneAnleitung(`## Historisch: alter Weg\n${zaun}\nsudo certbot --nginx\n${zaun}\n`).length === 0],
    // … nicht im Fließtext, der die Abwesenheit gerade feststellt …
    ["Fließtext bleibt frei", verboteneAnleitung("certbot gibt es hier nicht.\n").length === 0],
    ["Zitatblock bleibt frei", verboteneAnleitung("> `certbot` steht hier bewusst nicht mehr.\n").length === 0],
    ["Listenfortsetzung bleibt frei", verboteneAnleitung("- Punkt\n    - certbot ist Geschichte\n").length === 0],
    // … und eine Raute IM Zaun schaltet nichts ab (Loch a).
    [
      "Raute im Zaun schaltet nichts ab (Loch a)",
      verboteneAnleitung(`## Setup\n${zaun}\n# historisch: alter Weg\nsudo certbot --nginx\n${zaun}\n`).length === 1,
    ],
    // Prüfung 2 — tote Nummer, aber keine Prüfkennung und kein Bezeichner.
    ["tote Nummer", toteNummern("gilt laut A7 weiterhin", false).length === 1],
    ["Prüfkennung bleibt frei", toteNummern("A-16 verbietet Stubs, A-33 fordert SLI", false).length === 0],
    ["Bezeichner bleibt frei", toteNummern("const A2 = messwert;", true).length === 0],
    ["Kommentar wird gesehen", toteNummern(" * i18n-vorbereitet (A3)", true).length === 1],
    // Prüfung 3 — Pfad wird erkannt, Muster und Fremdpfade nicht.
    ["Pfad erkannt", pfadverweise("siehe `src/lib/media.ts`")[0]?.pfad === "src/lib/media.ts"],
    ["Zeilennummer erkannt", pfadverweise("siehe `src/lib/media.ts:42`")[0]?.bis === 42],
    ["Bereich erkannt", pfadverweise("siehe `src/lib/media.ts:10-20`")[0]?.von === 10],
    ["Muster ignoriert", pfadverweise("siehe `scripts/regime/*.mjs`").length === 0],
    ["Fremdpfad ignoriert", pfadverweise("liegt in `/etc/nginx/conf.d/x.conf`").length === 0],
    // Abkürzung löst auf — und die Zeilenprüfung greift trotzdem (Loch d).
    ["Abkürzung löst auf", aufloesen("audit/06", alle) === "audit/06-residual-risk-register.md"],
    ["Erfundener Pfad löst nicht auf", aufloesen("src/gibt-es-nicht.ts", alle) === null],
    [
      "Zeilenprüfung greift auch bei Abkürzung (Loch d)",
      zeilenBefund(aufloesen("audit/06", alle), 99999, 99999) !== null,
    ],
    // Unmögliche Angaben (Loch e).
    ["Zeile an einem Verzeichnis (Loch e)", zeilenBefund("src/lib", 999, 999) !== null],
    ["Bereich rückwärts (Loch e)", zeilenBefund("package.json", 100, 10) !== null],
    ["Zeile 0 (Loch e)", zeilenBefund("package.json", 0, 0) !== null],
    ["gültige Zeile bleibt frei", zeilenBefund("package.json", 1, 2) === null],
  ];
  const schlecht = faelle.filter(([, ok]) => !ok).map(([name]) => name);
  console.log(
    schlecht.length === 0
      ? `[doku-gate] Selbsttest: ${faelle.length} Fälle, Verstöße gefangen und Ausnahmen geschont ✓`
      : `[doku-gate] Selbsttest FEHLER: ${schlecht.join(", ")}`,
  );
  process.exit(schlecht.length === 0 ? 0 : 1);
}

main();
