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
 *    Markdown als CODE liest. Fließtext darf und soll weiter sagen, dass es
 *    certbot hier nicht gibt; genau das steht als Zitatblock in README §2. Ein
 *    Codeblock unter einer Überschrift, die „historisch" enthält, ist
 *    ausgenommen; so ist der aufbewahrte Host-nginx-Weg gekennzeichnet.
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
 *    anderes Bezugssystem.
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
 * ─────────────────────────────────────────────────────────────────────────
 * WARUM HIER ZWEI FREMDE PARSER LAUFEN UND KEINE EIGENEN WÄHLER
 *
 * Die ersten Fassungen zerlegten Markdown und TypeScript von Hand. Der
 * Pflicht-Approver hat in VIER Runden ELF Umgehungen gefunden (PR #109) — und
 * das ist kein Ausreißer, sondern die Regel: Ein handgeschriebener Zerleger hat
 * so viele Löcher, wie das Format Sonderfälle hat. Die gefundenen, zur
 * Erinnerung und als Selbsttestfälle unten festgenagelt:
 *
 *   a) Eine Raute IM Codeblock galt als Überschrift und schaltete die
 *      „historisch"-Ausnahme für den Rest der Datei ein.
 *   b) `~~~` galt nicht als Zaun — der Block wurde gar nicht erst geprüft.
 *   c) Eingerückter Code wurde nie geprüft (Markdown kennt drei Codeformen).
 *   f) Ein Zaun aus VIER Backticks wurde von einem inneren Dreier geschlossen.
 *   g) Nur Kommentare am ZEILENANFANG wurden gesehen; `const x = 1; // A7`
 *      lief durch.
 *   d) Die Zeilenprüfung sprang bei einer eindeutigen Abkürzung ab.
 *   e) Zeilennummer an einem VERZEICHNIS, Bereich rückwärts, Zeile 0 galten
 *      als gültig.
 *   h) `split("\n").length` zählte bei abschließendem Umbruch eine Zeile zu
 *      viel — ein Verweis auf N+1 war grün.
 *   j) EINE ÜBERSCHRIFT IN EINEM ZITAT ODER LISTENPUNKT setzte die
 *      „historisch"-Ausnahme für alles Folgende — auch außerhalb des Zitats.
 *      Abschnitte macht jetzt nur eine Überschrift auf oberster Ebene.
 *   k) DIE LISTE DER OBERSTEN VERZEICHNISSE WAR VERDRAHTET und unvollständig
 *      (`.zap`, `.lighthouse`, `.admin-data`, `.repro-data` fehlten). Sie wird
 *      jetzt aus dem Repository HERGELEITET — entdecken statt aufzählen.
 *   i) JEDER eindeutige PRÄFIX galt als gültige Abkürzung. Damit lief ein
 *      vertippter Pfad (`src/lib/media.t`) grün durch — die Frage „gibt es
 *      diese Datei?" war ausgehöhlt, nicht bloß umgangen. Siehe `aufloesen`.
 *
 * a, b, c, f und j sind Markdown-Sonderfälle; g ist ein TypeScript-Sonderfall.
 * Sechs von elf Löchern kamen also daher, dass hier zwei Sprachen nachgebaut
 * wurden, die das Projekt längst richtig zerlegen kann:
 *
 *   * `marked` (Produktionsabhängigkeit, treibt `src/lib/markdown.ts`) liefert
 *     Codeblöcke und Überschriften als Token. Alle vier Markdown-Löcher fallen
 *     damit ersatzlos weg — nicht geflickt, sondern gegenstandslos.
 *   * `typescript` (Entwicklungsabhängigkeit, treibt `npm run typecheck`)
 *     liefert die Kommentarbereiche aus dem GEPARSTEN Baum. Nachgemessen an
 *     `const r = /a\/\//; // A5`: Der reine Scanner liest daraus „//; // A5"
 *     und liegt falsch, der Parser liefert „// A5" und liegt richtig.
 *
 * d, e, h, i und k bleiben eigene Logik — sie handeln von Dateien und Zahlen,
 * nicht von Grammatik. j fällt nicht ganz weg: `marked` liefert die
 * Verschachtelung korrekt, aber WELCHE Überschrift einen Abschnitt aufmacht,
 * ist eine Entscheidung dieses Gates und musste hier getroffen werden.
 *
 * `.css` wird BEWUSST als Ganzes durchsucht statt über einen dritten Zerleger:
 * CSS kennt keine Bezeichner der Form „A2", der Anlass für die
 * Kommentar-Einschränkung entfällt dort also. Ein Fehlalarm wäre ein
 * `grid-area: A2` — sichtbar und in einem Zug korrigierbar. Ein dritter
 * handgeschriebener Zerleger wäre die Wiederholung genau des Fehlers, den
 * dieser Umbau abstellt.
 *
 * Kalibrierung (A-36): `--selftest` führt für jede Prüfung einen synthetischen
 * Verstoß ein und bestätigt, dass sie ihn fängt — und für die Ausnahmen, dass
 * sie NICHT feuern.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import ts from "typescript";

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

/**
 * Oberste Verzeichnisse dieses Repositories — HERGELEITET, nicht verdrahtet.
 *
 * Hier stand eine Liste aus elf Namen. Sie war unvollständig: `.zap`,
 * `.lighthouse`, `.admin-data` und `.repro-data` fehlten, Verweise dorthin
 * wurden also gar nicht erst geprüft (Loch k, Befund des Pflicht-Approvers,
 * vierte Runde). Eine Liste, die jemand pflegen muss, vergisst neue Einträge —
 * dieselbe Lehre wie beim Shell-Syntax-Schritt und bei
 * `tests/gate-verdrahtung.test.ts`: entdecken statt aufzählen.
 */
export function wurzelnAus(alle) {
  const raus = new Set();
  for (const f of alle) {
    const i = f.indexOf("/");
    if (i > 0) raus.add(f.slice(0, i));
  }
  return raus;
}

/** Trennt eine angehängte Zeilenangabe (`…:42`, `…:10-20`) vom Pfad ab. */
const ZEILEN_TEIL = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/;

/** Anweisungen, die zum abgeschalteten Host-nginx-Betrieb gehören. */
export const VERALTETE_ANLEITUNG = /\bcertbot\b|\bsites-available\b|\/etc\/letsencrypt\b/;

/** „A1"…„A11" ohne Bindestrich — die Nummerierung, die es nicht gibt.
 *  Der Bindestrich trennt sie von den Prüfkennungen A-16, A-20, A-33; das
 *  vorangestellte `/` von Pfadbestandteilen wie `https://x/A7/y`. */
export const TOTE_NUMMER = /(?<![A-Za-z0-9_/.-])A(1[01]|[1-9])(?![0-9A-Za-z-])/;

/** Zeilennummer (1-basiert) des Zeichens an `pos`. */
function zeileVon(text, pos) {
  return text.slice(0, pos).split("\n").length;
}

/**
 * Prüfung 1: verbotene Anleitung in Code.
 *
 * Was Code ist, entscheidet `marked` — dieselbe Zerlegung, die auch die Seiten
 * rendert. Damit zählen alle drei Markdown-Codeformen (```-Zaun, ~~~-Zaun,
 * Einrückung) ohne eigenes Zutun, und eine Raute im Block ist keine
 * Überschrift.
 *
 * Gibt die beanstandeten Zeilennummern zurück (1-basiert).
 */
export function verboteneAnleitung(md) {
  const treffer = [];
  let unterHistorisch = false;
  let suchAb = 0;

  const lauf = (tokens, oberste) => {
    for (const t of tokens) {
      // Abschnitte macht NUR eine Überschrift auf oberster Ebene. Eine
      // Überschrift in einem Zitat oder Listenpunkt (`> ## Historisch`) tut das
      // nicht — sie setzte die Ausnahme trotzdem und ließ jeden folgenden
      // Codeblock ungeprüft, auch außerhalb des Zitats (Loch j, Befund des
      // Pflicht-Approvers, vierte Runde; an beiden Formen nachgestellt).
      if (t.type === "heading") {
        if (oberste) unterHistorisch = /historisch/i.test(t.text ?? "");
      } else if (t.type === "code") {
        // Vorwärts suchen: Token stehen in Dokumentreihenfolge, auch die in
        // Listen verschachtelten. Zwei gleiche Blöcke stören deshalb nicht.
        const pos = md.indexOf(t.raw, suchAb);
        if (pos !== -1) suchAb = pos + t.raw.length;
        if (!unterHistorisch) {
          const start = pos === -1 ? 0 : zeileVon(md, pos);
          t.raw.split("\n").forEach((zeile, j) => {
            if (VERALTETE_ANLEITUNG.test(zeile)) treffer.push(start + j);
          });
        }
      }
      // Verschachtelte Blöcke (Codeblock in einer Liste, in einem Zitat, in
      // einer Tabellenzelle) hängen an eigenen Token-Listen.
      if (Array.isArray(t.tokens)) lauf(t.tokens, false);
      if (Array.isArray(t.items)) lauf(t.items, false);
      if (Array.isArray(t.rows)) for (const zeile of t.rows) lauf(zeile, false);
      if (Array.isArray(t.header)) lauf(t.header, false);
    }
  };

  lauf(new Marked({ gfm: true }).lexer(md), true);
  return treffer.sort((a, b) => a - b);
}

/** Prüfung 2a: tote Annahmenummer in Fließtext (Markdown, CSS). */
export function toteNummern(text) {
  const treffer = [];
  text.split("\n").forEach((zeile, i) => {
    if (TOTE_NUMMER.test(zeile)) treffer.push(i + 1);
  });
  return treffer;
}

/**
 * Prüfung 2b: tote Annahmenummer in einem TypeScript-KOMMENTAR.
 *
 * Nur im Kommentar, weil „A2" im Code ein Bezeichner sein darf. Die
 * Kommentarbereiche kommen aus dem geparsten Baum statt aus einem eigenen
 * Zeichenlauf — nur so sind nachgestellte Kommentare, Zeichenketten,
 * Vorlagenliterale und Regex-Literale sicher auseinanderzuhalten.
 */
export function toteNummernInKommentaren(quelle, datei = "x.ts") {
  const art = datei.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true, art);
  const bereiche = new Map();
  const merke = (r) => {
    if (r) for (const b of r) bereiche.set(`${b.pos}:${b.end}`, b);
  };
  const lauf = (n) => {
    merke(ts.getLeadingCommentRanges(quelle, n.getFullStart()));
    merke(ts.getTrailingCommentRanges(quelle, n.getEnd()));
    n.getChildren().forEach(lauf);
  };
  lauf(sf);

  const treffer = new Set();
  for (const b of bereiche.values()) {
    const text = quelle.slice(b.pos, b.end);
    const global = new RegExp(TOTE_NUMMER.source, "g");
    for (const m of text.matchAll(global)) treffer.add(zeileVon(quelle, b.pos + m.index));
  }
  return [...treffer].sort((a, b) => a - b);
}

/**
 * Pfadverweise einer Zeile: alles in Backticks, das wie ein Repo-Pfad aussieht.
 *
 * Als Verweis gilt ein Stück nur, wenn sein erstes Wegstück ein tatsächlich
 * vorhandenes oberstes Verzeichnis ist — oder wenn es mit `./` ausdrücklich als
 * repo-relativ ausgezeichnet ist. Platzhalter (`*`, `<…>`, `{…}`) sind keine
 * Verweise, sondern Muster.
 *
 * WARUM NACKTE DATEINAMEN NICHT GEPRÜFT WERDEN — gemessen, nicht vermutet: Von
 * über neunzig Stücken der Form „name.endung" ohne Wegstück sind neun
 * tatsächlich Dateien im Wurzelverzeichnis. Der große Rest sind Kurzformen für
 * Dateien in Unterverzeichnissen (`boundary-check.mjs`, `route.ts`,
 * `globals.css`), Versionsnummern, Adressen und Ausdrücke aus dem Quelltext.
 * Eine Prüfung darauf bräuchte eine Ausnahmeliste — und eine Ausnahmeliste ist
 * der Anfang der Weichspülung. Dasselbe gilt für „irgendein Stück mit
 * Schrägstrich": `try/catch`, `text/html`, `application/json`, `@/db` und
 * `A-20/B-05` wären sonst Pfadverweise. Die Herleitung aus den echten obersten
 * Verzeichnissen trennt beides sauber, ohne dass jemand etwas pflegen muss.
 */
export function pfadverweise(zeile, wurzeln) {
  const raus = [];
  for (const m of zeile.matchAll(/`([^`\s]+)`/g)) {
    if (/[*<>{}]/.test(m[1])) continue;
    let stueck = m[1];
    const repoRelativ = stueck.startsWith("./");
    if (repoRelativ) stueck = stueck.slice(2);
    const t = ZEILEN_TEIL.exec(stueck);
    // KEINE Bereinigung nachgestellter Interpunktion: Sie stand hier und wusch
    // Tippfehler. Innerhalb von Backticks gehört jedes Zeichen zum Verweis; am
    // Bestand nachgesehen trägt kein einziger Pfad dort einen Punkt am Ende.
    const pfad = t[1];
    if (!repoRelativ && !(pfad.includes("/") && wurzeln.has(pfad.slice(0, pfad.indexOf("/"))))) continue;
    raus.push({
      text: m[1],
      pfad,
      von: t[2] === undefined ? null : Number(t[2]),
      bis: t[3] === undefined ? (t[2] === undefined ? null : Number(t[2])) : Number(t[3]),
    });
  }
  return raus;
}

/**
 * Löst einen Verweis auf die Datei auf, die er meint.
 *
 * Neben dem exakten Pfad zählt GENAU EINE Abkürzung: die Nummer eines
 * nummerierten Dokuments. `audit/06` meint `audit/06-residual-risk-register.md`;
 * diese Schreibweise steht in der Verfassung (Artikel XIII, Residuals-Register),
 * und die ist hash-attestiert — sie für eine Linting-Bequemlichkeit
 * umzuschreiben wäre die falsche Richtung.
 *
 * WARUM NICHT „irgendein eindeutiger Präfix" (Loch i, Befund des
 * Pflicht-Approvers, dritte Runde): Diese Regel stand hier und war eine
 * Tippfehler-Waschanlage. `src/lib/media.t` ist ein eindeutiger Präfix von
 * `src/lib/media.ts` — ein vertippter Pfad wäre grün durchgelaufen, und damit
 * hätte ausgerechnet die Prüfung „gibt es diese Datei?" ihren Zweck verloren.
 * JEDE Verkürzung wäre erlaubt gewesen.
 *
 * Jetzt muss die Abkürzung auf eine ZWEISTELLIGE Zahl als letztes Wegstück
 * enden, und die gefundene Datei muss unmittelbar danach einen Bindestrich
 * tragen. `src/lib/media.t` erfüllt das nicht, `audit/06` schon. Die Ausnahme
 * ist damit benannt statt offen.
 *
 * Der aufgelöste Pfad wird ZURÜCKGEGEBEN und nicht bloß als „trifft/trifft
 * nicht" verworfen: Sonst hängt die Zeilenprüfung am Rohpfad und springt bei
 * jeder Abkürzung ab (Loch d).
 */
export function aufloesen(pfad, alle) {
  if (fs.existsSync(pfad)) return pfad;
  if (!/(?:^|\/)\d{2}$/.test(pfad)) return null;
  // `git ls-files --cached` führt auch Einträge, deren Datei im Arbeitsbaum
  // gerade fehlt. Ohne diese Prüfung stürbe `zeilenBefund` später an einem
  // `statSync` — eine Kontrolle, die abstürzt, meldet nichts.
  const treffer = alle.filter((f) => f.startsWith(`${pfad}-`) && fs.existsSync(f));
  return treffer.length === 1 ? treffer[0] : null;
}

/**
 * Zahl der Zeilen einer Datei.
 *
 * `split("\n").length` ist hier falsch: Endet die Datei mit einem
 * Zeilenumbruch — das tut praktisch jede —, liefert die Zerlegung ein leeres
 * letztes Stück und damit eine Zeile zu viel. Ein Verweis auf N+1 galt so als
 * gültig (Loch h).
 */
export function zeilenzahl(roh) {
  if (roh === "") return 0;
  return roh.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

/**
 * Prüft eine Zeilenangabe gegen die aufgelöste Datei.
 * Gibt den Beanstandungstext zurück oder `null`, wenn sie in Ordnung ist.
 */
export function zeilenBefund(datei, von, bis) {
  if (!fs.statSync(datei).isFile()) return "Zeilennummer an einem Verzeichnis";
  if (von < 1) return "Zeilennummer 0 gibt es nicht";
  if (bis < von) return `Zeilenbereich rückwärts (${von}–${bis})`;
  const zeilen = zeilenzahl(fs.readFileSync(datei, "utf8"));
  if (bis > zeilen) return `jenseits des Dateiendes (${datei} hat ${zeilen} Zeilen)`;
  return null;
}

function main() {
  const alle = dateien();
  const wurzeln = wurzelnAus(alle);
  let verstoesse = 0;
  const melde = (art, ort, text) => {
    console.error(`❌ ${art} ${ort}: ${text}`);
    verstoesse++;
  };

  let gezaehlt = 0;
  for (const datei of alle) {
    const imAudit = datei.startsWith("audit/");
    const endung = path.extname(datei);
    const istMd = endung === ".md";
    const istTs = datei.startsWith("src/") && (endung === ".ts" || endung === ".tsx");
    const istCss = datei.startsWith("src/") && endung === ".css";
    if (!istMd && !istTs && !istCss) continue;
    const text = fs.readFileSync(datei, "utf8");
    const zeilen = text.split("\n");

    if (istMd && !imAudit) {
      for (const nr of verboteneAnleitung(text)) {
        melde("Veraltete Anleitung im Code (A2/A3)", `${datei}:${nr}`, zeilen[nr - 1].trim());
      }
    }

    if (!imAudit) {
      const nummern = istTs ? toteNummernInKommentaren(text, datei) : toteNummern(text);
      for (const nr of nummern) {
        melde("Verweis auf eine Nummerierung, die es nicht gibt", `${datei}:${nr}`, zeilen[nr - 1].trim());
      }
    }

    if (!istMd) continue;
    zeilen.forEach((zeile, i) => {
      for (const v of pfadverweise(zeile, wurzeln)) {
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
  const z3 = "```";
  const z4 = "````";
  const welle = "~~~";
  const alle = dateien();
  const wurzeln = wurzelnAus(alle);
  const faelle = [
    // Prüfung 1 — der Verstoß wird in ALLEN Markdown-Codeformen gefangen.
    ["Anleitung im ```-Zaun", verboteneAnleitung(`## Setup\n\n${z3}\nsudo certbot --nginx\n${z3}\n`).length === 1],
    ["Anleitung im ~~~-Zaun (Loch b)", verboteneAnleitung(`## Setup\n\n${welle}\nsudo certbot --nginx\n${welle}\n`).length === 1],
    ["Anleitung eingerückt (Loch c)", verboteneAnleitung("## Setup\n\n    sudo certbot --nginx\n").length === 1],
    ["Vierer-Zaun bleibt offen (Loch f)", verboteneAnleitung(`## Setup\n\n${z4}\n${z3}\nsudo certbot --nginx\n${z4}\n`).length === 1],
    ["Raute im Zaun schaltet nichts ab (Loch a)", verboteneAnleitung(`## Setup\n\n${z3}\n# historisch: alter Weg\nsudo certbot --nginx\n${z3}\n`).length === 1],
    ["Codeblock in einer Liste wird gesehen", verboteneAnleitung(`## Setup\n\n- Schritt:\n\n  ${z3}\n  sudo certbot --nginx\n  ${z3}\n`).length === 1],
    // … und feuert NICHT, wo er nicht feuern darf.
    ["historischer Block bleibt frei", verboteneAnleitung(`## Historisch: alter Weg\n\n${z3}\nsudo certbot --nginx\n${z3}\n`).length === 0],
    // … aber eine Überschrift IM Zitat oder Listenpunkt macht keinen Abschnitt auf (Loch j).
    ["Zitat-Überschrift leakt nicht (Loch j)", verboteneAnleitung(`## Setup\n\n> ## Historisch: alter Weg\n\n${z3}\nsudo certbot --nginx\n${z3}\n`).length === 1],
    ["Listen-Überschrift leakt nicht (Loch j)", verboteneAnleitung(`## Setup\n\n- ### Historisch\n\n${z3}\nsudo certbot --nginx\n${z3}\n`).length === 1],
    ["Fließtext bleibt frei", verboteneAnleitung("certbot gibt es hier nicht.\n").length === 0],
    ["Zitatblock bleibt frei", verboteneAnleitung("> `certbot` steht hier bewusst nicht mehr.\n").length === 0],
    ["Listenfortsetzung bleibt frei", verboteneAnleitung("- Punkt\n- certbot ist Geschichte\n").length === 0],
    ["Zeilennummer stimmt", verboteneAnleitung(`## Setup\n\n${z3}\nsudo certbot --nginx\n${z3}\n`)[0] === 4],
    // Prüfung 2 — tote Nummer im Fließtext, aber keine Prüfkennung.
    ["tote Nummer", toteNummern("gilt laut A7 weiterhin").length === 1],
    ["Prüfkennung bleibt frei", toteNummern("A-16 verbietet Stubs, A-33 fordert SLI").length === 0],
    ["Pfadbestandteil bleibt frei", toteNummern("siehe https://x/A7/y").length === 0],
    // Prüfung 2b — im Quelltext zählt NUR der Kommentar, aber jeder.
    ["Bezeichner bleibt frei", toteNummernInKommentaren("const A2 = messwert;").length === 0],
    ["Blockkommentar wird gesehen", toteNummernInKommentaren("/**\n * i18n-vorbereitet (A3)\n */\nexport const x = 1;").length === 1],
    ["nachgestellter Kommentar wird gesehen (Loch g)", toteNummernInKommentaren("const x = 1; // A7").length === 1],
    ["Kommentar hinter einer Zeichenkette", toteNummernInKommentaren('const u = "https://x"; /* A7 */').length === 1],
    ["tote Nummer IN einer Zeichenkette bleibt frei", toteNummernInKommentaren('const s = "// A7";').length === 0],
    ["Vorlagenliteral bleibt frei", toteNummernInKommentaren("const t = `hallo // A9`;").length === 0],
    ["Regex-Literal verwirrt den Parser nicht", toteNummernInKommentaren("const r = /a\\/\\//; // A5").length === 1],
    ["Division verwirrt den Parser nicht", toteNummernInKommentaren("const y = 6 / 2 / 3; // A4").length === 1],
    // Prüfung 3 — Pfad wird erkannt, Muster und Fremdpfade nicht.
    ["Pfad erkannt", pfadverweise("siehe `src/lib/media.ts`", wurzeln)[0]?.pfad === "src/lib/media.ts"],
    ["Zeilennummer erkannt", pfadverweise("siehe `src/lib/media.ts:42`", wurzeln)[0]?.bis === 42],
    ["Bereich erkannt", pfadverweise("siehe `src/lib/media.ts:10-20`", wurzeln)[0]?.von === 10],
    ["Muster ignoriert", pfadverweise("siehe `scripts/regime/*.mjs`", wurzeln).length === 0],
    ["Fremdpfad ignoriert", pfadverweise("liegt in `/etc/nginx/conf.d/x.conf`", wurzeln).length === 0],
    // Hergeleitete statt verdrahtete Wurzelliste (Loch k).
    ["verstecktes Verzeichnis wird erkannt (Loch k)", pfadverweise("siehe `.zap/rules.tsv`", wurzeln)[0]?.pfad === ".zap/rules.tsv"],
    ["`./` gilt als repo-relativ", pfadverweise("siehe `./deploy.sh`", wurzeln)[0]?.pfad === "deploy.sh"],
    ["kein Pfad: try/catch", pfadverweise("ein `try/catch` im Branding-Pfad", wurzeln).length === 0],
    ["kein Pfad: text/html", pfadverweise("liefert `text/html`", wurzeln).length === 0],
    ["kein Pfad: Prüfkennungen", pfadverweise("betrifft `A-20/B-05`", wurzeln).length === 0],
    ["kein Pfad: Modulkürzel", pfadverweise("importiert `@/db` nicht statisch", wurzeln).length === 0],
    ["kein Pfad: nackter Dateiname", pfadverweise("siehe `boundary-check.mjs`", wurzeln).length === 0],
    // Abkürzung löst auf — und die Zeilenprüfung greift trotzdem (Loch d).
    ["Abkürzung löst auf", aufloesen("audit/06", alle) === "audit/06-residual-risk-register.md"],
    ["Erfundener Pfad löst nicht auf", aufloesen("src/gibt-es-nicht.ts", alle) === null],
    // … aber NUR die Dokumentnummer, kein beliebiger Präfix (Loch i).
    ["vertippter Pfad löst nicht auf (Loch i)", aufloesen("src/lib/media.t", alle) === null],
    ["Verkürzung löst nicht auf (Loch i)", aufloesen("src/lib/bildreihe", alle) === null],
    ["einstellige Nummer ist keine Abkürzung", aufloesen("audit/0", alle) === null],
    ["Pfad mit Punkt am Ende wird nicht gewaschen", pfadverweise("siehe `src/lib/media.ts.`", wurzeln)[0]?.pfad === "src/lib/media.ts."],
    ["Zeilenprüfung greift auch bei Abkürzung (Loch d)", zeilenBefund(aufloesen("audit/06", alle), 99999, 99999) !== null],
    // Unmögliche Angaben (Loch e).
    ["Zeile an einem Verzeichnis (Loch e)", zeilenBefund("src/lib", 999, 999) !== null],
    ["Bereich rückwärts (Loch e)", zeilenBefund("package.json", 100, 10) !== null],
    ["Zeile 0 (Loch e)", zeilenBefund("package.json", 0, 0) !== null],
    ["gültige Zeile bleibt frei", zeilenBefund("package.json", 1, 2) === null],
    // Phantomzeile am Dateiende (Loch h).
    ["abschließender Umbruch zählt nicht (Loch h)", zeilenzahl("a\nb\n") === 2],
    ["ohne abschließenden Umbruch", zeilenzahl("a\nb") === 2],
    ["leere Datei hat null Zeilen", zeilenzahl("") === 0],
    ["CRLF zählt gleich", zeilenzahl("a\r\nb\r\n") === 2],
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
