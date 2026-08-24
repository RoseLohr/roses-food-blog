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
 *    gibt oder nicht mehr. (Das Beispiel dieser Zeile war lange
 *    `scripts/regime/erhebung.sh` aus Spur A1 — inzwischen gibt es die Datei,
 *    und das ändert an der Regel nichts: Der nächste Fahrplan nennt das
 *    nächste noch nicht Gebaute.) Ein
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
 * Pflicht-Approver hat in ZWÖLF Runden FÜNFUNDZWANZIG Befunde gefunden, einen
 * SECHSUNDZWANZIGSTEN habe ich selbst nachgetragen (PR #109). Das ist kein
 * Ausreißer, sondern die Regel: Ein handgeschriebener Zerleger hat so viele
 * Löcher, wie das Format Sonderfälle hat. Alle sechsundzwanzig, zur Erinnerung
 * und als Selbsttestfälle unten festgenagelt — bis auf t, das keine Umgehung
 * ist, sondern eine Grenze:
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
 *   l) EIN VORANGESTELLTER BINDESTRICH schloss die tote Nummer aus —
 *      „laut Annahme-A7" blieb grün. Am Bestand nachgemessen: Die Ausnahme
 *      fallen zu lassen erzeugt null Fehlalarme.
 *   m) DIE AUFLÖSUNG FRAGTE NUR `fs.existsSync` — also „liegt da etwas auf der
 *      Platte" statt „gehört das zu diesem Repository". `.//etc/passwd` und
 *      `src/../../../../etc/passwd` führten beide aus dem Repository heraus und
 *      galten als gültige Verweise; `zeilenBefund` hätte die fremde Datei
 *      danach zum Zeilenzählen gelesen. Siehe `einwaerts` und `istMitglied`.
 *   i) JEDER eindeutige PRÄFIX galt als gültige Abkürzung. Damit lief ein
 *      vertippter Pfad (`src/lib/media.t`) grün durch — die Frage „gibt es
 *      diese Datei?" war ausgehöhlt, nicht bloß umgangen. Siehe `aufloesen`.
 *   n) NUR BLOCK-CODE WURDE GEPRÜFT, keine Inline-Spannen. Eine Anweisung
 *      mitten im Satz — `sudo certbot --nginx` — blieb grün.
 *   o) DER EIGENE BACKTICK-WÄHLER VERBOT LEERRAUM. Eine nach CommonMark
 *      gültige Spanne mit Rand-Leerraum blieb dadurch ungeprüft.
 *   q) AUS EINEM UNTERVERZEICHNIS GESTARTET PRÜFTE DAS GATE NICHTS und meldete
 *      das als „grün". `git ls-files` liefert Pfade relativ zum
 *      AUFRUFVERZEICHNIS; aus `src/` heraus fand die Filterung keine einzige
 *      Markdown-Datei. Nicht vom Approver benannt, sondern beim eigenen
 *      Nachsehen gefunden — es ist die reinste Form der Klasse, um die es hier
 *      die ganze Zeit geht. Behoben doppelt: Die Dateiliste kommt jetzt aus der
 *      Repo-Wurzel, UND ein Lauf ohne eine einzige geprüfte Datei ist ein
 *      Fehlschlag statt eines Erfolgs.
 *   r) DIE TABELLENKOPFZEILE WURDE NACH DEN DATENZEILEN GELAUFEN. Die
 *      Vorwärtssuche setzt Dokumentreihenfolge voraus; eine Spanne in der
 *      Kopfzeile wurde deshalb nicht mehr gefunden und auf Zeile 1 gemeldet
 *      statt auf ihrer eigenen. Eine falsche Fundstelle schickt den Leser an
 *      die falsche Stelle. Beim Beheben fiel ein zweiter Teil auf: Für
 *      INLINE-Token ist `raw` bereits entrückt und deshalb gar keine Teilkette
 *      der Quelle — siehe `findeStelle`.
 *   s) `audit/` WAR AUCH VON PRÜFUNG 1 AUSGENOMMEN, ohne Begründung. Für die
 *      toten Nummern und die Vorwärtsverweise ist die Ausnahme begründet; für
 *      die veraltete ANLEITUNG stand sie nur aus Symmetrie da. Am Bestand
 *      nachgemessen, bevor sie fiel: null Treffer in `audit/`.
 *   u) EIN TIPPFEHLER IM ERSTEN WEGSTÜCK fiel durch: `srcc/lib/x.ts` galt gar
 *      nicht als Pfad, weil `srcc` kein oberstes Verzeichnis ist. Erkannt wird
 *      jetzt über ZWEI unabhängige Merkmale — bekanntes Wegstück ODER
 *      Dateiendung.
 *   v) INLINE-ANWEISUNGEN WURDEN NUR AN LEERRAUM ERKANNT. `certbot;ls`,
 *      `certbot&&nginx`, `certbot|tee`, `certbot>log` und `$(certbot)` sind
 *      gültige Kommandolisten ohne ein einziges Leerzeichen und liefen durch.
 *      Erkannt wird jetzt zusätzlich an Shell-Metazeichen.
 *   w) DIE FREMDPFAD-REGEL AUS RUNDE ACHT VERSCHLUCKTE `.//etc/passwd`. Nach
 *      dem `./`-Abschnitt blieb ein führender Schrägstrich stehen, der Filter
 *      warf das Stück weg, und das Gate meldete gar nichts statt eines
 *      Verweises ins Leere. Eine Korrektur ist kein Freibrief.
 *   x) DIE BLOCKPRÜFUNG LAS DIE ZAUNZEILE MIT. Deren Infozeichenkette sagt
 *      etwas ÜBER den Block (Sprache, Titel) und ist keine Anweisung IN ihm;
 *      ein Zaun der Form ```conf title="sites-available/…" wurde als Verstoß
 *      gemeldet. Ein Fehlalarm ist kein Loch, kostet aber dieselbe
 *      Glaubwürdigkeit: Eine Kontrolle, die grundlos rot wird, wird
 *      abgeschaltet statt beachtet.
 *   y) KLAMMERN GALTEN PAUSCHAL ALS MUSTER. Next.js schreibt Routengruppen und
 *      dynamische Segmente in den DATEINAMEN; 72 echte Dateien dieses
 *      Repositories tragen Klammern. Verweise darauf wurden nie geprüft — ein
 *      toter Verweis auf halb `src/app/` blieb grün. Geprüft wird jetzt auf
 *      Platzhalter-WEGSTÜCKE statt auf Klammern.
 *   z) DER NACHGESTELLTE BINDESTRICH verdeckte eine tote Nummer mit
 *      angehängtem Wort („A7-neu"). Eine Spanne wie „A1-A11" fing die alte
 *      Fassung schon über die zweite Nummer — das hat erst die Gegenprobe
 *      gezeigt, meine erste Annahme war falsch. Am Bestand kostet die
 *      Lockerung null Fehlalarme.
 *   t) SPANNEN, DIE NUR DER BLOSSE NAME SIND, BLEIBEN FREI. Das ist die einzige
 *      BENANNTE GRENZE dieses Gates und keine Umgehung, die sich schließen
 *      ließe — die Begründung samt Messung steht bei `verboteneAnleitung`.
 *   p) DAS CONTAINMENT WAR REIN LEXIKALISCH. Ein verfolgter Symlink, der aus
 *      dem Repository hinauszeigt, kam durch — und `zeilenBefund` hätte die
 *      fremde Datei gelesen. Siehe `echtDrin`.
 *
 * a, b, c, f, j, n und o sind Markdown-Sonderfälle; g ist ein
 * TypeScript-Sonderfall, r und x weitere Markdown-Fälle. ZEHN von sechsundzwanzig
 * Löchern kamen also daher, dass hier
 * zwei Sprachen nachgebaut wurden, die das Projekt längst richtig zerlegen
 * kann — und n und o kamen erst zutage, NACHDEM die Blockzerlegung schon auf
 * `marked` stand: Ein Rest Handarbeit an den Inline-Spannen war übrig
 * geblieben. Die Lehre hält also auch gegen sich selbst.
 *
 *   * `marked` (Produktionsabhängigkeit, treibt `src/lib/markdown.ts`) liefert
 *     Codeblöcke, Inline-Spannen und Überschriften als Token. Alle sieben
 *     Markdown-Löcher fallen damit ersatzlos weg — nicht geflickt, sondern
 *     gegenstandslos.
 *   * `typescript` (Entwicklungsabhängigkeit, treibt `npm run typecheck`)
 *     liefert die Kommentarbereiche aus dem GEPARSTEN Baum. Nachgemessen an
 *     `const r = /a\/\//; // A5`: Der reine Scanner liest daraus „//; // A5"
 *     und liegt falsch, der Parser liefert „// A5" und liegt richtig.
 *
 * d, e, h, i, k, l, m, p, q, s, u, v, w, y und z bleiben eigene Logik — sie handeln von Dateien und
 * Zahlen, nicht von Grammatik. j fällt nicht ganz weg: `marked` liefert die
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
import os from "node:os";
import { Marked } from "marked";
import ts from "typescript";

/**
 * Dateiliste wie in `source-gates.mjs`: `--others --exclude-standard` nimmt
 * neue, noch nicht verfolgte Dateien MIT. Ohne das ist ein örtlicher Lauf vor
 * dem Commit grün, obwohl die neue Datei den Verstoß trägt — genau so ist am
 * 2026-08-21 ein Heredoc-Verstoß erst in CI aufgefallen.
 */
function dateien() {
  // `cwd` auf die Repo-Wurzel: `git ls-files` liefert sonst Pfade relativ zum
  // AUFRUFVERZEICHNIS. Aus `src/` gestartet fand dieses Gate deshalb keine
  // einzige Markdown-Datei und meldete „0 Pfadverweise … grün" — es hatte
  // nichts geprüft und gab das als Erfolg aus (Loch q, selbst gefunden).
  return execSync("git ls-files --cached --others --exclude-standard", {
    encoding: "utf8",
    cwd: repoWurzel(),
  })
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

/**
 * Endungen, an denen eine Datei DIESES Projekts erkennbar ist.
 *
 * Wozu: Ein Tippfehler im ERSTEN Wegstück — `srcc/lib/x.ts` statt `src/…` —
 * fiel durch, weil `srcc` kein oberstes Verzeichnis ist und das Stück damit gar
 * nicht erst als Pfad galt (Loch u). Die Endung ist das zweite, unabhängige
 * Erkennungsmerkmal: Was auf `.ts` endet und einen Schrägstrich trägt, IST ein
 * Pfadverweis, egal wie das erste Wegstück heißt.
 *
 * Am Bestand nachgemessen, bevor die Regel kam: Sie feuert auf keine einzige
 * vorhandene Stelle. `try/catch`, `text/html`, `application/json`, `@/db`,
 * `A-20/B-05`, Branch-Namen und `zaproxy/action-baseline@v0.12.0` tragen keine
 * dieser Endungen und bleiben draußen.
 *
 * WAS DAMIT NICHT ABGEDECKT IST, ausdrücklich: Ein Tippfehler im ersten
 * Wegstück eines VERZEICHNIS-Verweises ohne Endung — etwa `srcc/lib/prompts` —
 * fällt weiter durch. Die Alternative wäre, jedes Stück mit Schrägstrich als
 * Pfad zu lesen; gemessen wären das 29 Fehlalarme. Das ist eine benannte
 * Grenze, keine stille.
 */
const DATEIENDUNG = /\.(ts|tsx|js|mjs|cjs|json|md|sh|css|yml|yaml|tsv|sql|html|svg|png|webp|woff2|example|conf)$/;

/**
 * Platzhalter machen aus einem Pfad ein MUSTER, keinen Verweis: `*` (Glob),
 * spitze und geschweifte Klammern, Leerraum.
 *
 * RUNDE und eckige KLAMMERN gehören NICHT dazu, und das war ein fail-open
 * (Loch y, Befund des Pflicht-Approvers): Next.js schreibt Routengruppen und
 * dynamische Segmente in den DATEINAMEN — `src/app/(public)/page.tsx`,
 * `src/app/uploads/[...pfad]/route.ts`. In diesem Repository tragen 72 echte
 * Dateien solche Klammern; Verweise darauf wurden pauschal verworfen und damit
 * nie geprüft. Ein toter Verweis auf halb `src/app/` blieb grün.
 */
const IST_MUSTER = /[*<>{}\s]/;

/**
 * Ein WEGSTÜCK, das nur aus Auslassungspunkten besteht, ist ein Platzhalter —
 * `.../ai/ping/route.ts` und `…/04bv4jz9i8omc.css` meinen die Form, nicht die
 * Datei. Die drei Punkte INNERHALB eckiger Klammern (`[...pfad]`) sind dagegen
 * Teil eines echten Dateinamens; deshalb wird auf Wegstücke geprüft und nicht
 * auf die Zeichenkette als Ganzes.
 */
function hatPlatzhalterStueck(pfad) {
  return pfad.split("/").some((teil) => teil === "..." || teil.includes("…"));
}

/** Anweisungen, die zum abgeschalteten Host-nginx-Betrieb gehören. */
export const VERALTETE_ANLEITUNG = /\bcertbot\b|\bsites-available\b|\/etc\/letsencrypt\b/;

/**
 * Woran eine Inline-Spanne als ANWEISUNG erkennbar ist: Leerraum ODER ein
 * Shell-Metazeichen.
 *
 * Der Leerraum allein genügte nicht (Loch v, Befund des Pflicht-Approvers):
 * `certbot;ls`, `certbot&&nginx`, `certbot|tee`, `certbot>log` und
 * `$(certbot)` sind gültige Kommandolisten OHNE ein einziges Leerzeichen und
 * liefen durch. Am Bestand nachgemessen, bevor die Metazeichen dazukamen: Von
 * 3818 Spannen feuert die verschärfte Regel auf NULL — die sechs legitimen
 * Nennungen (`certbot`, `sites-available`, `/etc/letsencrypt/live`) tragen
 * keines dieser Zeichen.
 */
export const IST_ANWEISUNG = /[\s;&|<>$(){}`\\]/;

/** Eine Zaunzeile (öffnend oder schließend), samt möglicher Infozeichenkette. */
export const ZAUNZEILE = /^\s*(?:`{3,}|~{3,})/;

/**
 * „A1"…„A11" — die Nummerierung, die es nicht gibt.
 *
 * Von den Prüfkennungen A-16, A-20, A-33 trennt sie sich von selbst: Dort
 * folgt auf das A kein Ziffernpaar, sondern ein Bindestrich. Das vorangestellte
 * `/` hält Pfadbestandteile wie `https://x/A7/y` heraus.
 *
 * Der NACHGESTELLTE Bindestrich stand ebenfalls in der Ausnahme und verdeckte
 * eine tote Nummer, auf die unmittelbar ein Bindestrich folgt — „laut A7-neu"
 * (Loch z). NACHGEMESSEN, und die Messung hat meine erste Annahme widerlegt:
 * Eine SPANNE wie „A1-A11" fing die alte Fassung bereits, nämlich über die
 * ZWEITE Nummer; der Unterschied liegt allein beim angehängten Wort. Am Bestand
 * kostet die Lockerung null zusätzliche Treffer.
 *
 * Der VORANGESTELLTE Bindestrich stand hier ebenfalls in der Ausnahme und war
 * ein Loch (l): „laut Annahme-A7" blieb grün, obwohl der Verweis genauso tot
 * ist. Am Bestand nachgemessen, bevor die Ausnahme fiel: null Fehlalarme —
 * Kennungen wie `R-A33` und `R-A07` trifft die Regex ohnehin nicht, weil auf
 * das A keine passende Zahl folgt.
 */
export const TOTE_NUMMER = /(?<![A-Za-z0-9_/.])A(1[01]|[1-9])(?![0-9A-Za-z])/;

/** Zeilennummer (1-basiert) des Zeichens an `pos`. */
function zeileVon(text, pos) {
  return text.slice(0, pos).split("\n").length;
}

/**
 * ALLE Code-Stücke eines Markdown-Textes, in Dokumentreihenfolge, mit
 * Zeilennummer und Abschnittslage.
 *
 * Was Code ist, entscheidet `marked` — dieselbe Zerlegung, die auch die Seiten
 * rendert. Damit zählen alle drei Block-Codeformen (```-Zaun, ~~~-Zaun,
 * Einrückung) und die Inline-Spannen ohne eigenes Zutun; eine Raute im Block
 * ist keine Überschrift, und eine Spanne mit Rand-Leerraum (` x `) wird sauber
 * abgeschält (Loch o — der eigene Backtick-Wähler verbot Leerraum und übersah
 * sie deshalb).
 *
 * Abschnitte macht NUR eine Überschrift auf oberster Ebene. Eine Überschrift in
 * einem Zitat oder Listenpunkt (`> ## Historisch`) tut das nicht — sie setzte
 * die Ausnahme trotzdem und ließ jeden folgenden Codeblock ungeprüft, auch
 * außerhalb des Zitats (Loch j).
 */
/**
 * Findet die Stelle eines Token-Rohtextes in der Quelle, ab `suchAb`.
 *
 * Warum nicht schlicht `indexOf`: Für INLINE-Token ist `raw` bereits ENTRÜCKT.
 * Die Fortsetzungszeile eines Listenpunkts verliert ihre Einrückung, bevor
 * `marked` die Zeile inline zerlegt — `raw` ist dann keine Teilkette der Quelle
 * mehr. Nachgemessen an CLAUDE.md:
 *
 *   Quelle : "…bestehen: `npm run typecheck && npm run lint\n  && npm test…"
 *   raw    : "`npm run typecheck && npm run lint\n&& npm test…"
 *
 * Die zwei Leerzeichen fehlen. Deshalb wird zuerst wörtlich und dann über
 * Leerraum TOLERANT gesucht: Jede Folge von Leerraum im Rohtext darf in der
 * Quelle jeder Folge von Leerraum entsprechen. Alles andere muss stimmen.
 */
function findeStelle(quelle, suchAb, roh) {
  const woertlich = quelle.indexOf(roh, suchAb);
  if (woertlich !== -1) return woertlich;
  const muster = new RegExp(roh.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  const treffer = muster.exec(quelle.slice(suchAb));
  return treffer ? suchAb + treffer.index : -1;
}

export function codestuecke(md) {
  const raus = [];
  let unterHistorisch = false;
  let suchAb = 0;

  const lauf = (tokens, oberste) => {
    for (const t of tokens) {
      if (t.type === "heading") {
        if (oberste) unterHistorisch = /historisch/i.test(t.text ?? "");
      } else if (t.type === "code" || t.type === "codespan") {
        // Vorwärts suchen: Token stehen in Dokumentreihenfolge, auch die in
        // Listen verschachtelten. Zwei gleiche Stücke stören deshalb nicht.
        const pos = findeStelle(md, suchAb, t.raw);
        if (pos !== -1) suchAb = pos + t.raw.length;
        raus.push({
          art: t.type === "code" ? "block" : "inline",
          roh: t.raw,
          text: t.text ?? "",
          // Nicht auffindbar heißt NICHT „Zeile 1". Eine erfundene Fundstelle
          // schickt den Leser an die falsche Stelle; `main()` meldet den Fall
          // stattdessen als eigenen Verstoß.
          zeile: pos === -1 ? null : zeileVon(md, pos),
          unterHistorisch,
        });
      }
      // Verschachtelte Stücke (Codeblock in einer Liste, Spanne in einem
      // Zitat, in einer Tabellenzelle) hängen an eigenen Token-Listen.
      //
      // DIE REIHENFOLGE IST TRAGEND: Die Vorwärtssuche unten setzt voraus, dass
      // hier in DOKUMENTREIHENFOLGE gelaufen wird. `header` stand hinter `rows`
      // und damit hinter dem, was im Dokument darunter steht — eine Spanne in
      // der Kopfzeile wurde deshalb nicht mehr gefunden und auf Zeile 1
      // gemeldet statt auf ihrer eigenen (Loch r). Nachgestellt: Kopfzeile in
      // Zeile 5, gemeldet als Zeile 1.
      if (Array.isArray(t.tokens)) lauf(t.tokens, false);
      if (Array.isArray(t.items)) lauf(t.items, false);
      if (Array.isArray(t.header)) lauf(t.header, false);
      if (Array.isArray(t.rows)) for (const zeile of t.rows) lauf(zeile, false);
    }
  };

  lauf(new Marked({ gfm: true }).lexer(md), true);
  return raus;
}

/**
 * Prüfung 1: verbotene Anleitung in Code.
 *
 * Gibt die beanstandeten Zeilennummern zurück (1-basiert).
 */
export function verboteneAnleitung(md) {
  const treffer = [];
  for (const s of codestuecke(md)) {
    if (s.unterHistorisch) continue;
    if (s.art === "block") {
      s.roh.split("\n").forEach((zeile, j) => {
        // DIE ZAUNZEILE IST KEIN INHALT. Ihre Infozeichenkette sagt etwas ÜBER
        // den Block — die Sprache, ein Titel — und ist keine Anweisung IN ihm.
        // Ein Zaun der Form ```conf title="sites-available/…" löste einen
        // Fehlalarm aus (Loch x, Befund des Pflicht-Approvers). Ein Fehlalarm
        // ist kein Loch, aber er kostet dieselbe Glaubwürdigkeit: Eine
        // Kontrolle, die grundlos rot wird, wird abgeschaltet statt beachtet.
        if (ZAUNZEILE.test(zeile)) return;
        if (VERALTETE_ANLEITUNG.test(zeile)) treffer.push(s.zeile === null ? 0 : s.zeile + j);
      });
      continue;
    }
    // EINE INLINE-SPANNE zählt, wenn sie eine ANWEISUNG ist: Leerraum oder ein
    // Shell-Metazeichen. `sudo certbot --nginx` ist eine, `certbot;ls` auch;
    // `certbot` allein ist der blosse Name. Vorher waren Inline-Spannen gar
    // nicht geprüft (Loch n), danach nur die mit Leerraum (Loch v).
    //
    // DIE GRENZE, AUSGESPROCHEN (Loch t, Befund des Pflicht-Approvers): Eine
    // Spanne, die nur der blosse NAME ist und trotzdem als Anweisung gemeint
    // ist — „Führe `certbot` aus" —, fällt hier durch. Das ist keine Nachlässigkeit, sondern die Grenze des
    // Machbaren: Ob eine Nennung eine Anweisung ist, steht im FLIESSTEXT
    // daneben, nicht in der Spanne. Kein Wähler auf der Spanne kann das
    // entscheiden.
    //
    // Und die Gegenrichtung wäre schlimmer, gemessen statt vermutet: Von 3818
    // Spannen tragen SECHS ein verbotenes Wort, alle sechs blosse Namen, alle
    // sechs legitime Feststellungen der ABWESENHEIT — in README §2, in
    // `audit/11-infrastruktur-befund.md` und in `audit/12-infrastruktur-fahrplan.md`
    // ausgerechnet dort, wo diese Regel beschrieben wird. Einwortige Spannen zu
    // verbieten hieße, das Gate auf dem Text rot zu fahren, der es erklärt —
    // und der einzige Ausweg wäre eine Ausnahmeliste. Die ist hier verboten.
    //
    // Vollständig ist dafür die BLOCK-Prüfung, und dort leben Anleitungen.
    if (IST_ANWEISUNG.test(s.text) && VERALTETE_ANLEITUNG.test(s.text)) treffer.push(s.zeile ?? 0);
  }
  return [...new Set(treffer)].sort((a, b) => a - b);
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
 * Der Pfadverweis einer Inline-Code-Spanne — oder `null`, wenn sie keiner ist.
 *
 * Die Spannen kommen aus `codestuecke()`, also von `marked`. Ein eigener
 * Backtick-Wähler stand hier und verbot Leerraum im Inneren; eine nach
 * CommonMark gültige Spanne mit Rand-Leerraum (` src/x.ts `) blieb dadurch
 * ungeprüft (Loch o). Dass hier zum dritten Mal ein Loch aus eigener
 * Markdown-Zerlegung kam, ist die Bestätigung derselben Lehre.
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
export function pfadverweis(inhalt, wurzeln) {
  if (IST_MUSTER.test(inhalt) || hatPlatzhalterStueck(inhalt)) return null;
  let stueck = inhalt;
  const repoRelativ = stueck.startsWith("./");
  if (repoRelativ) stueck = stueck.slice(2);
  // Ein führender Schrägstrich heißt fremdes Dateisystem — ABER nur, wenn das
  // Stück nicht ausdrücklich als repo-relativ ausgezeichnet war. Ohne diese
  // Einschränkung verschluckte die Regel `.//etc/passwd`: Nach dem `./` blieb
  // `/etc/passwd` stehen, der Filter warf es weg, und das Gate meldete
  // GARNICHTS statt eines Verweises ins Leere (Loch w). Das `./` ist eine
  // ausdrückliche Behauptung „liegt in diesem Repository"; widerspricht der
  // Inhalt ihr, gehört das gemeldet, nicht übergangen.
  //
  // ZUR HERKUNFT, weil sie lehrreich ist: Diese Regel kam in Runde acht dazu,
  // um fremde Pfade wie `/etc/nginx/nginx.conf` ruhigzustellen — und riss dabei
  // ein neues Loch auf. Eine Korrektur ist kein Freibrief.
  if (!repoRelativ && stueck.startsWith("/")) return null;
  const t = ZEILEN_TEIL.exec(stueck);
  // KEINE Bereinigung nachgestellter Interpunktion: Sie stand hier und wusch
  // Tippfehler. In einer Code-Spanne gehört jedes Zeichen zum Verweis; am
  // Bestand nachgesehen trägt kein einziger Pfad dort einen Punkt am Ende.
  const pfad = t[1];
  const mitWegstueck = pfad.includes("/");
  const bekannteWurzel = mitWegstueck && wurzeln.has(pfad.slice(0, pfad.indexOf("/")));
  // ZWEI unabhängige Merkmale, nicht eines: bekanntes erstes Wegstück ODER
  // Dateiendung. Sonst fällt ein Tippfehler im ersten Wegstück durch (Loch u).
  const nachEndung = mitWegstueck && DATEIENDUNG.test(pfad);
  if (!repoRelativ && !bekannteWurzel && !nachEndung) return null;
  return {
    text: inhalt,
    pfad,
    von: t[2] === undefined ? null : Number(t[2]),
    bis: t[3] === undefined ? (t[2] === undefined ? null : Number(t[2])) : Number(t[3]),
  };
}

/** Wurzel des Repositories — von git erfragt, nicht aus dem Arbeitsverzeichnis
 *  geraten. Einmal ermittelt und gemerkt. */
let gemerkteWurzel = null;
export function repoWurzel() {
  if (gemerkteWurzel === null) {
    gemerkteWurzel = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  }
  return gemerkteWurzel;
}

/**
 * Pfad relativ zur Repo-Wurzel — oder `null`, wenn er dort HINAUSFÜHRT.
 *
 * Das war Loch m (Befund des Pflicht-Approvers, fünfte Runde). Die Auflösung
 * fragte nur `fs.existsSync`, also „liegt da irgendetwas auf der Platte" statt
 * „ist das eine Datei dieses Repositories". Nachgestellt:
 *
 *   `.//etc/passwd`               → nach dem `./`-Abschnitt `/etc/passwd`, und
 *                                   das existiert → galt als gültiger Verweis.
 *   `src/../../../../etc/passwd`  → geht durch ein ECHTES Wurzelverzeichnis und
 *                                   landet trotzdem bei `/etc/passwd`.
 *
 * Der zweite Fall zeigt, dass das Loch größer war als der `./`-Sonderfall: Der
 * Ausbruch gelang durch jedes zugelassene Wurzelverzeichnis hindurch. Und
 * `zeilenBefund` hätte die fremde Datei anschließend zum Zeilenzählen gelesen.
 */
export function einwaerts(pfad, wurzel = repoWurzel()) {
  const rel = path.relative(wurzel, path.resolve(wurzel, pfad));
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/**
 * Gehört der Pfad zum Repository? Datei oder Verzeichnis.
 *
 * Bewusst gegen die Dateiliste statt gegen die Platte: Ein Pfad, der zufällig
 * existiert, aber nicht zum Repository gehört, ist kein Verweis auf dieses
 * Repository. `git ls-files` listet nur Dateien — ein Verzeichnis erkennt man
 * daran, dass Einträge darunter liegen.
 */
export function istMitglied(rel, alle) {
  return alle.includes(rel) || alle.some((f) => f.startsWith(`${rel}/`));
}

/**
 * Bleibt der Pfad auch NACH Auflösung aller Symlinks im Repository?
 *
 * `einwaerts()` rechnet rein lexikalisch — ein verfolgter Symlink, der aus dem
 * Repository hinauszeigt, käme dort durch, wäre Mitglied der Dateiliste, und
 * `zeilenBefund` läse anschließend die fremde Datei (Loch p, Befund des
 * Pflicht-Approvers, sechste Runde). Git kann Symlinks verfolgen; die
 * lexikalische Prüfung allein genügt deshalb nicht.
 */
export function echtDrin(rel, wurzel = repoWurzel()) {
  let echt;
  let echteWurzel;
  try {
    echt = fs.realpathSync(path.resolve(wurzel, rel));
    echteWurzel = fs.realpathSync(wurzel);
  } catch {
    // Gibt es nicht (oder nicht lesbar) → kein Ziel in diesem Repository.
    return false;
  }
  const drin = path.relative(echteWurzel, echt);
  return drin !== ".." && !drin.startsWith(`..${path.sep}`) && !path.isAbsolute(drin);
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
export function aufloesen(pfad, alle, wurzel = repoWurzel()) {
  const rel = einwaerts(pfad, wurzel);
  if (rel === null) return null;
  if (istMitglied(rel, alle) && echtDrin(rel, wurzel)) return rel;
  if (!/(?:^|\/)\d{2}$/.test(rel)) return null;
  // `git ls-files --cached` führt auch Einträge, deren Datei im Arbeitsbaum
  // gerade fehlt. Ohne diese Prüfung stürbe `zeilenBefund` später an einem
  // `statSync` — eine Kontrolle, die abstürzt, meldet nichts.
  const treffer = alle.filter((f) => f.startsWith(`${rel}-`) && echtDrin(f, wurzel));
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
export function zeilenBefund(datei, von, bis, wurzel = repoWurzel()) {
  const voll = path.resolve(wurzel, datei);
  if (!fs.statSync(voll).isFile()) return "Zeilennummer an einem Verzeichnis";
  if (von < 1) return "Zeilennummer 0 gibt es nicht";
  if (bis < von) return `Zeilenbereich rückwärts (${von}–${bis})`;
  const zeilen = zeilenzahl(fs.readFileSync(voll, "utf8"));
  if (bis > zeilen) return `jenseits des Dateiendes (${datei} hat ${zeilen} Zeilen)`;
  return null;
}

function main() {
  const alle = dateien();
  const wurzeln = wurzelnAus(alle);
  const wurzel = repoWurzel();
  let verstoesse = 0;
  const melde = (art, ort, text) => {
    console.error(`❌ ${art} ${ort}: ${text}`);
    verstoesse++;
  };

  let gezaehlt = 0;
  let gepruefteMd = 0;
  for (const datei of alle) {
    const imAudit = datei.startsWith("audit/");
    const endung = path.extname(datei);
    const istMd = endung === ".md";
    const istTs = datei.startsWith("src/") && (endung === ".ts" || endung === ".tsx");
    const istCss = datei.startsWith("src/") && endung === ".css";
    if (!istMd && !istTs && !istCss) continue;
    const text = fs.readFileSync(path.join(wurzel, datei), "utf8");
    const zeilen = text.split("\n");
    if (istMd) gepruefteMd++;

    if (istMd) {
      // AUCH `audit/`. Die Ausnahme dort ist für die toten Nummern und die
      // Vorwärtsverweise begründet (eigenes Bezugssystem, geplante Dateien) —
      // für die veraltete ANLEITUNG gab es nie einen Grund, sie stand nur aus
      // Symmetrie da (Loch s). Am Bestand nachgemessen, bevor sie fiel: null
      // Treffer in `audit/`. Wer dort eine historische Anweisung zitieren will,
      // nimmt dieselbe „historisch"-Überschrift wie alle anderen.
      for (const nr of verboteneAnleitung(text)) {
        melde("Veraltete Anleitung im Code (A2/A3)", `${datei}:${nr || "?"}`, (zeilen[nr - 1] ?? "").trim());
      }
    }

    if (!imAudit) {
      const nummern = istTs ? toteNummernInKommentaren(text, datei) : toteNummern(text);
      for (const nr of nummern) {
        melde("Verweis auf eine Nummerierung, die es nicht gibt", `${datei}:${nr}`, zeilen[nr - 1].trim());
      }
    }

    if (!istMd) continue;
    for (const s of codestuecke(text)) {
      if (s.zeile === null) {
        melde("Fundstelle nicht bestimmbar", datei, `\`${s.text}\` — die Zerlegung findet das Stück nicht wieder`);
        continue;
      }
      if (s.art !== "inline") continue;
      const v = pfadverweis(s.text, wurzeln);
      if (v === null) continue;
      // In `audit/` nur Verweise MIT Zeilennummer — siehe Kopf.
      if (imAudit && v.von === null) continue;
      gezaehlt++;
      const ziel = aufloesen(v.pfad, alle, wurzel);
      if (ziel === null) {
        melde("Pfadverweis ins Leere", `${datei}:${s.zeile}`, v.text);
        continue;
      }
      if (v.von === null) continue;
      const befund = zeilenBefund(ziel, v.von, v.bis, wurzel);
      if (befund) melde("Unbrauchbare Zeilenangabe", `${datei}:${s.zeile}`, `${v.text} — ${befund}`);
    }
  }

  // EIN LAUF, DER NICHTS GEPRÜFT HAT, IST NICHT GRÜN. Genau das passierte aus
  // einem Unterverzeichnis heraus: keine Datei gefunden, „grün" gemeldet. Der
  // Fahrplan nennt diese Klasse selbst — „Belege, die nicht fehlschlagen
  // können". Diese Zusicherung ist der Riegel davor, und sie ist absichtlich
  // NICHT als Zahl kalibriert: Es geht nicht um „genug", sondern um „überhaupt".
  if (gepruefteMd === 0) {
    console.error(
      "⛔ Doku-Gate hat KEINE Markdown-Datei gefunden. Das ist kein grüner Lauf, " +
        "sondern ein kaputter: Entweder ist das Repository leer, oder die Dateiliste " +
        "kommt aus dem falschen Verzeichnis.",
    );
    process.exit(1);
  }

  if (verstoesse) {
    console.error(`\n⛔ ${verstoesse} Doku-Gate-Verstoß/Verstöße. Build gestoppt.`);
    process.exit(1);
  }
  console.log(
    `[doku-gate] ${gepruefteMd} Markdown-Dateien, ${gezaehlt} Pfadverweise, ` +
      `Anleitungen und Nummern geprüft: grün.`,
  );
}

/**
 * Fährt das Gate in einem FRISCHEN, leeren Repository und meldet, ob es dort
 * fehlschlägt.
 *
 * Das ist der Beweis für den Riegel aus Loch q. Ihn nur zu behaupten wäre
 * genau die Sorte Beleg, die nicht fehlschlagen kann: Die Bedingung
 * `gepruefteMd === 0` liest sich richtig, und ob der Lauf dann WIRKLICH mit
 * Rückgabewert 1 endet, sieht man erst, wenn man es tut.
 */
function leerlaufProbe() {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "doku-gate-leer-"));
  try {
    execSync("git init -q", { cwd: ordner, stdio: "pipe" });
    fs.writeFileSync(path.join(ordner, "nur-text.txt"), "keine Markdown-Datei hier\n");
    execSync(`node ${JSON.stringify(path.join(repoWurzel(), "scripts/regime/doku-gate.mjs"))}`, {
      cwd: ordner,
      stdio: "pipe",
    });
    return false; // durchgelaufen → der Riegel greift NICHT
  } catch {
    return true; // Fehlschlag → der Riegel greift
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
}

/**
 * Zeile der Spanne in der KOPFZEILE einer Tabelle, die in Zeile 5 beginnt.
 * Stand `header` hinter `rows`, kam hier 1 heraus statt 5 (Loch r).
 */
function tabellenProbe() {
  const md = [
    "# Titel",
    "",
    "Ein Satz.",
    "",
    "| `src/lib/media.ts` | Spalte |",
    "|---|---|",
    "| `src/db/schema.ts` | Wert |",
    "",
  ].join("\n");
  return codestuecke(md).find((s) => s.text === "src/lib/media.ts")?.zeile ?? null;
}

/** Der Inhalt der ersten Inline-Spanne — für den Selbsttest von Loch o. */
function spannenText(md) {
  return codestuecke(md).find((s) => s.art === "inline")?.text ?? null;
}

/**
 * Legt WIRKLICH einen Symlink an, der aus dem Repository hinauszeigt, und
 * fragt `echtDrin`. Gedacht wäre hier zu wenig: Genau die Annahme „das kann ja
 * nicht durchkommen" war Loch p.
 *
 * Das Verzeichnis heißt `.gate-selftest-doku` — dasselbe Muster wie die
 * übrigen Gate-Selbsttests, und `.gitignore` deckt es über den Eintrag
 * `.gate-selftest-` samt Stern ab. (Ausgeschrieben stünde hier ein Stern
 * gefolgt von einem Schrägstrich; das beendet diesen Kommentar mitten im Satz.)
 */
function symlinkProbe() {
  const ordner = path.join(repoWurzel(), ".gate-selftest-doku");
  const verweis = path.join(ordner, "hinaus");
  try {
    fs.mkdirSync(ordner, { recursive: true });
    fs.rmSync(verweis, { force: true });
    fs.symlinkSync(path.parse(repoWurzel()).root, verweis);
    return echtDrin(".gate-selftest-doku/hinaus");
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
}

if (process.argv.includes("--selftest")) {
  const z3 = "```";
  const z4 = "````";
  const welle = "~~~";
  const alle = dateien();
  const wurzeln = wurzelnAus(alle);
  const wurzel = repoWurzel();
  const faelle = [
    // Prüfung 1 — der Verstoß wird in ALLEN Markdown-Codeformen gefangen.
    ["Anleitung im ```-Zaun", verboteneAnleitung(`## Setup\n\n${z3}\nsudo certbot --nginx\n${z3}\n`).length === 1],
    ["Anleitung im ~~~-Zaun (Loch b)", verboteneAnleitung(`## Setup\n\n${welle}\nsudo certbot --nginx\n${welle}\n`).length === 1],
    ["Anleitung eingerückt (Loch c)", verboteneAnleitung("## Setup\n\n    sudo certbot --nginx\n").length === 1],
    // Die Infozeichenkette der Zaunzeile ist kein Inhalt (Loch x).
    [
      "Infozeichenkette löst keinen Fehlalarm aus (Loch x)",
      verboteneAnleitung(`## X\n\n${z3}conf titel=sites-available/roses\nlisten 80;\n${z3}\n`).length === 0,
    ],
    [
      "Anweisung im Block mit Infozeichenkette wird gefangen",
      verboteneAnleitung(`## X\n\n${z3}bash\nsudo certbot --nginx\n${z3}\n`).length === 1,
    ],
    ["Vierer-Zaun bleibt offen (Loch f)", verboteneAnleitung(`## Setup\n\n${z4}\n${z3}\nsudo certbot --nginx\n${z4}\n`).length === 1],
    ["Raute im Zaun schaltet nichts ab (Loch a)", verboteneAnleitung(`## Setup\n\n${z3}\n# historisch: alter Weg\nsudo certbot --nginx\n${z3}\n`).length === 1],
    ["Codeblock in einer Liste wird gesehen", verboteneAnleitung(`## Setup\n\n- Schritt:\n\n  ${z3}\n  sudo certbot --nginx\n  ${z3}\n`).length === 1],
    // … und feuert NICHT, wo er nicht feuern darf.
    ["historischer Block bleibt frei", verboteneAnleitung(`## Historisch: alter Weg\n\n${z3}\nsudo certbot --nginx\n${z3}\n`).length === 0],
    // … aber eine Überschrift IM Zitat oder Listenpunkt macht keinen Abschnitt auf (Loch j).
    ["Zitat-Überschrift leakt nicht (Loch j)", verboteneAnleitung(`## Setup\n\n> ## Historisch: alter Weg\n\n${z3}\nsudo certbot --nginx\n${z3}\n`).length === 1],
    ["Listen-Überschrift leakt nicht (Loch j)", verboteneAnleitung(`## Setup\n\n- ### Historisch\n\n${z3}\nsudo certbot --nginx\n${z3}\n`).length === 1],
    // Inline-Spannen: die ANWEISUNG zählt, das WORT nicht (Loch n).
    ["Anweisung als Inline-Spanne (Loch n)", verboteneAnleitung("Ruf `sudo certbot --nginx` auf.\n").length === 1],
    ["einzelnes Wort als Inline-Spanne bleibt frei", verboteneAnleitung("`certbot` gibt es hier nicht.\n").length === 0],
    ["Inline-Anweisung im historischen Abschnitt bleibt frei", verboteneAnleitung("## Historisch\n\nRuf `sudo certbot --nginx` auf.\n").length === 0],
    ["Fließtext bleibt frei", verboteneAnleitung("certbot gibt es hier nicht.\n").length === 0],
    ["Zitatblock bleibt frei", verboteneAnleitung("> `certbot` steht hier bewusst nicht mehr.\n").length === 0],
    ["Listenfortsetzung bleibt frei", verboteneAnleitung("- Punkt\n- certbot ist Geschichte\n").length === 0],
    ["Zeilennummer stimmt", verboteneAnleitung(`## Setup\n\n${z3}\nsudo certbot --nginx\n${z3}\n`)[0] === 4],
    // Prüfung 2 — tote Nummer im Fließtext, aber keine Prüfkennung.
    ["tote Nummer", toteNummern("gilt laut A7 weiterhin").length === 1],
    ["Prüfkennung bleibt frei", toteNummern("A-16 verbietet Stubs, A-33 fordert SLI").length === 0],
    ["Pfadbestandteil bleibt frei", toteNummern("siehe https://x/A7/y").length === 0],
    // Bindestrich DAVOR verdeckt die tote Nummer nicht mehr (Loch l).
    ["Bindestrich davor verdeckt nichts (Loch l)", toteNummern("gilt laut Annahme-A7").length === 1],
    ["Kennung mit Ziffernpaar bleibt frei", toteNummern("Residual R-A33 und R-A07").length === 0],
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
    ["Pfad erkannt", pfadverweis("src/lib/media.ts", wurzeln)?.pfad === "src/lib/media.ts"],
    ["Zeilennummer erkannt", pfadverweis("src/lib/media.ts:42", wurzeln)?.bis === 42],
    ["Bereich erkannt", pfadverweis("src/lib/media.ts:10-20", wurzeln)?.von === 10],
    ["Muster ignoriert", pfadverweis("scripts/regime/*.mjs", wurzeln) === null],
    ["Fremdpfad ignoriert", pfadverweis("/etc/nginx/conf.d/x.conf", wurzeln) === null],
    // Hergeleitete statt verdrahtete Wurzelliste (Loch k).
    ["verstecktes Verzeichnis wird erkannt (Loch k)", pfadverweis(".zap/rules.tsv", wurzeln)?.pfad === ".zap/rules.tsv"],
    ["`./` gilt als repo-relativ", pfadverweis("./deploy.sh", wurzeln)?.pfad === "deploy.sh"],
    ["kein Pfad: try/catch", pfadverweis("try/catch", wurzeln) === null],
    ["kein Pfad: text/html", pfadverweis("text/html", wurzeln) === null],
    ["kein Pfad: Prüfkennungen", pfadverweis("A-20/B-05", wurzeln) === null],
    ["kein Pfad: Modulkürzel", pfadverweis("@/db", wurzeln) === null],
    ["kein Pfad: nackter Dateiname", pfadverweis("boundary-check.mjs", wurzeln) === null],
    // Tippfehler im ERSTEN Wegstück fällt über die Dateiendung auf (Loch u).
    ["Tippfehler im ersten Wegstück (Loch u)", pfadverweis("srcc/lib/x.ts", wurzeln)?.pfad === "srcc/lib/x.ts"],
    ["kein Pfad: Branch-Name", pfadverweis("claude/roses-food-blog-vxs3vm", wurzeln) === null],
    ["kein Pfad: Aktionsversion", pfadverweis("zaproxy/action-baseline@v0.12.0", wurzeln) === null],
    ["kein Pfad: fremdes Dateisystem", pfadverweis("/etc/nginx/nginx.conf", wurzeln) === null],
    // Ausdrücklich repo-relativ, aber nach draußen zeigend: MELDEN (Loch w).
    ["`./` plus Ausbruch wird gemeldet (Loch w)", pfadverweis(".//etc/passwd", wurzeln)?.pfad === "/etc/passwd"],
    ["… und löst dann nicht auf", aufloesen(pfadverweis(".//etc/passwd", wurzeln).pfad, alle) === null],
    ["kein Pfad: Muster mit Auslassung", pfadverweis(".../ai/ping/route.ts", wurzeln) === null],
    // Klammern gehören zu echten Next.js-Dateinamen (Loch y).
    [
      "Routengruppe wird erkannt (Loch y)",
      pfadverweis("src/app/(public)/page.tsx", wurzeln)?.pfad === "src/app/(public)/page.tsx",
    ],
    [
      "dynamisches Segment wird erkannt (Loch y)",
      aufloesen("src/app/uploads/[...pfad]/route.ts", alle) === "src/app/uploads/[...pfad]/route.ts",
    ],
    ["Auslassung als Wegstück bleibt Muster", pfadverweis(".../ai/ping/route.ts", wurzeln) === null],
    ["Auslassungszeichen bleibt Muster", pfadverweis("…/04bv4jz9i8omc.css", wurzeln) === null],
    // Nachgestellter Bindestrich verdeckt keine Nummernspanne mehr (Loch z).
    ["tote Nummer mit angehängtem Wort (Loch z)", toteNummern("laut A7-neu weiterhin").length === 1],
    ["Nummernspanne wird gefangen", toteNummern("die Annahmen A1-A11 gelten").length === 1],
    ["Prüfkennung bleibt weiterhin frei", toteNummern("A-16 und A-33").length === 0],
    ["Residual-Kennung bleibt frei", toteNummern("Residual R-A33").length === 0],
    // Die benannte Grenze aus Loch t — sie steht hier, damit sie nicht still ist.
    ["blosser Name bleibt durch (benannte Grenze, Loch t)", verboteneAnleitung("Führe `certbot` aus.\n").length === 0],
    ["Anweisung mit Leerraum wird gefangen", verboteneAnleitung("Führe `certbot --nginx` aus.\n").length === 1],
    // Kommandolisten OHNE Leerraum (Loch v).
    ["Kommandoliste mit Semikolon (Loch v)", verboteneAnleitung("Ruf `certbot;ls` auf.\n").length === 1],
    ["Kommandoliste mit && (Loch v)", verboteneAnleitung("Ruf `certbot&&nginx` auf.\n").length === 1],
    ["Kommandoliste mit Pipe (Loch v)", verboteneAnleitung("Ruf `certbot|tee` auf.\n").length === 1],
    ["Umleitung (Loch v)", verboteneAnleitung("Ruf `certbot>log` auf.\n").length === 1],
    ["Kommandoersetzung (Loch v)", verboteneAnleitung("Ruf `$(certbot)` auf.\n").length === 1],
    ["Pfadnennung bleibt Nennung", verboteneAnleitung("Es gibt kein `/etc/letsencrypt/live`.\n").length === 0],
    // Abkürzung löst auf — und die Zeilenprüfung greift trotzdem (Loch d).
    ["Abkürzung löst auf", aufloesen("audit/06", alle) === "audit/06-residual-risk-register.md"],
    ["Erfundener Pfad löst nicht auf", aufloesen("src/gibt-es-nicht.ts", alle) === null],
    // … aber NUR die Dokumentnummer, kein beliebiger Präfix (Loch i).
    ["vertippter Pfad löst nicht auf (Loch i)", aufloesen("src/lib/media.t", alle) === null],
    ["Verkürzung löst nicht auf (Loch i)", aufloesen("src/lib/bildreihe", alle) === null],
    ["einstellige Nummer ist keine Abkürzung", aufloesen("audit/0", alle) === null],
    // Kein Ausbruch aus dem Repository (Loch m).
    ["`.//etc/passwd` bricht nicht aus (Loch m)", aufloesen("/etc/passwd", alle) === null],
    ["Aufstieg über `..` bricht nicht aus (Loch m)", aufloesen("src/../../../../etc/passwd", alle) === null],
    ["einwaerts weist absolute Pfade ab", einwaerts("/etc/passwd") === null],
    ["einwaerts weist den Aufstieg ab", einwaerts("../nachbar") === null],
    ["einwaerts lässt Repo-Pfade durch", einwaerts("src/lib/media.ts") === "src/lib/media.ts"],
    ["einwaerts normalisiert innen", einwaerts("src/lib/../lib/media.ts") === "src/lib/media.ts"],
    // Vorhandensein allein genügt nicht — es muss zum Repository gehören.
    ["Fremde Datei ist kein Mitglied", istMitglied("etc/passwd", alle) === false],
    ["Datei ist Mitglied", istMitglied("src/lib/media.ts", alle) === true],
    ["Verzeichnis ist Mitglied", istMitglied("src/lib", alle) === true],
    // Rand-Leerraum in der Spanne wird abgeschält (Loch o).
    ["Spanne mit Rand-Leerraum (Loch o)", spannenText("` src/gibt-es-nicht.ts `") === "src/gibt-es-nicht.ts"],
    ["Spanne ohne Leerraum unverändert", spannenText("`src/lib/media.ts`") === "src/lib/media.ts"],
    // Symlink aus dem Repository heraus (Loch p) — echt angelegt, nicht gedacht.
    ["Symlink nach draußen ist nicht drin (Loch p)", symlinkProbe() === false],
    ["echte Repo-Datei ist drin", echtDrin("src/lib/media.ts") === true],
    // Ein Lauf ohne eine einzige geprüfte Datei ist ein Fehlschlag (Loch q) —
    // im echten Leerlauf nachgewiesen, nicht behauptet.
    ["Leerlauf ist rot, nicht grün (Loch q)", leerlaufProbe() === true],
    // Tabellenkopf steht VOR den Datenzeilen — sonst falsche Fundstelle (Loch r).
    ["Fundstelle im Tabellenkopf (Loch r)", tabellenProbe() === 5],
    // Entrückter Inline-Rohtext wird trotzdem gefunden (Loch r, zweiter Teil).
    [
      "entrückte Fortsetzungszeile wird gefunden",
      codestuecke("- Punkt: `eins zwei\n  drei vier` Ende\n").find((x) => x.art === "inline")?.zeile === 1,
    ],
    ["nicht auffindbares Stück meldet keine Zeile", codestuecke("`x`").every((x) => x.zeile !== null)],
    ["Pfad mit Punkt am Ende wird nicht gewaschen", pfadverweis("src/lib/media.ts.", wurzeln)?.pfad === "src/lib/media.ts."],
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
