#!/usr/bin/env node
/**
 * Wachhund: erkennt eine Neustartschleife und beendet sie — laut.
 *
 * DER BEFUND (Gegenprüfung des Deploy-Pfads, Nr. 5): `restart: always` startet
 * einen Container, der beim Start stirbt, ohne Obergrenze neu. Es gibt keine
 * Grenze, keinen Alarm, kein Ende. Der Server dreht sich, die Seite ist tot,
 * und im Protokoll steht dieselbe Zeile tausendmal.
 *
 * ── WARUM NICHT EINFACH `restart: on-failure:N` ────────────────────────────
 *
 * Weil das den Wiederanlauf nach einem NEUSTART DES RECHNERS kostet:
 * `podman-restart.service` startet ausschließlich Container mit der Regel
 * `always` (`podman start --all --filter restart-policy=always`). Ein Tausch
 * auf `on-failure` würde eine Störung gegen eine schlimmere eintauschen — der
 * 11-Stunden-Ausfall vom 2026-08-10 hing genau an dieser Kette. Die Regel
 * bleibt deshalb `always`, und die Grenze zieht dieser Wachhund.
 *
 * ── WAS EINE SCHLEIFE VON EINER ANLAUFSCHWIERIGKEIT UNTERSCHEIDET ──────────
 *
 * Beides sieht kurz gleich aus. Der Unterschied ist die Dauer: Ein Container,
 * der einmal neu startet und dann grün wird, hatte einen holprigen Start. Ein
 * Container, der über MEHRERE Beobachtungen hinweg weiter neu startet UND
 * dabei durchgehend rot bleibt, kommt nicht mehr hoch. Erst dann wird
 * gestoppt — sonst hielte der Wachhund einen Container an, der sich gerade
 * selbst gefangen hätte.
 *
 * ── WER WAS TUT ────────────────────────────────────────────────────────────
 *
 * Messen und Handeln gehen nur auf dem HOST (curl, `podman inspect`,
 * `podman stop`) — und der Host hat außer podman nichts, deploy.sh setzt
 * bewusst kein node voraus. URTEILEN gehört dorthin, wo die geprüfte Logik
 * liegt. Also: `deploy/wachhund.sh` misst und handelt, dieses Modul urteilt,
 * und aufgerufen wird es im Image, das immer da ist — auch wenn die Anwendung
 * es nicht ist.
 *
 *   node scripts/wachhund.mjs --urteil <gesund:0|1> <neustarts> [stand-json]
 *
 * Gibt das Urteil als JSON auf die Ausgabe. Kein Dateizugriff, kein Netz —
 * damit ist es dieselbe reine Funktion, die tests/wachhund.test.ts prüft.
 */

/** Ab so vielen Neustarts innerhalb der Beobachtung gilt es als Schleife. */
export const NEUSTART_GRENZE = 5;
/** So viele Beobachtungen hintereinander muss es rot UND steigend sein. */
export const BEOBACHTUNGEN = 3;
/**
 * So viele Beobachtungen umfasst das Fenster, in dem Neustarts gezählt werden.
 *
 * Bei fünf Minuten Takt sind das eine halbe Stunde. Der Wachhund kennt seinen
 * Takt weiterhin nicht — auch das hier sind Beobachtungen, keine Zeit.
 */
export const FLATTER_FENSTER = 6;

/**
 * Die ganze Entscheidung, als reine Funktion.
 *
 * @param jetzt    { gesund: boolean, neustarts: number }  — aktuelle Messung
 * @param vorher   { neustarts: number, rotSeit: number } | null — letzter Stand
 * @returns { alarm, stoppen, grund, neuerStand }
 */
export function beurteile(jetzt, vorher) {
  // ── ZWEI SCHLEIFEN, ZWEI KRITERIEN ────────────────────────────────────────
  //
  // Bis 08/2026 stand hier zuerst: „grün → alles zurücksetzen, neuerStand
  // null". Das war für den Holperstart gedacht und für die durchgehend tote
  // Anwendung richtig. Für die FLATTERNDE Schleife war es fatal: Ein Container,
  // der nach dem Warmlaufen stirbt (OOM ist der Klassiker), sieht bei jeder
  // zweiten Messung gesund aus. `rotSeit` fiel dann jedes Mal zurück, die
  // Schwelle von drei ununterbrochen roten Beobachtungen wurde NIE erreicht —
  // und mit dem Zustand flog auch der Neustartzähler weg, das einzige
  // monotone Zeugnis, das es gibt. `restart: always` blieb unbegrenzt
  // (Befund gpt-5.6-sol, PR #110, Runde 6).
  //
  // Deshalb jetzt zwei Kriterien nebeneinander:
  //
  //   (a) Der Zähler WÄCHST — über ein Fenster von Beobachtungen hinweg, egal
  //       wie die einzelne Messung ausfällt. `RestartCount` ist monoton, solange
  //       der Container derselbe ist; ein Wachstum von NEUSTART_GRENZE
  //       innerhalb von FLATTER_FENSTER Beobachtungen IST eine Schleife.
  //   (b) Durchgehend rot und steigend — der alte, unveränderte Fall.
  //
  // Was NICHT passiert: Etwas stoppen, das gerade antwortet. Kriterium (a)
  // meldet dann nur. Ein laufender Dienst wird nicht abgeschaltet, weil er
  // eine halbe Stunde zuvor geflattert hat.

  // Zähler kleiner als zuletzt? Dann ist der Container neu angelegt worden
  // (jeder Deploy tut das) — das Fenster fängt von vorn an, sonst zählte man
  // Neustarts zweier verschiedener Container zusammen.
  const neuAngelegt = vorher !== null && jetzt.neustarts < vorher.neustarts;
  const frisch = vorher === null || neuAngelegt;

  let fensterNeustarts = frisch
    ? jetzt.neustarts
    : (vorher.fensterNeustarts ?? vorher.neustarts);
  let fensterBeobachtungen = (frisch ? 0 : (vorher.fensterBeobachtungen ?? 0)) + 1;
  let wachstum = jetzt.neustarts - fensterNeustarts;

  // Fenster voll, ohne dass die Schwelle erreicht wurde: neu ansetzen. Sonst
  // summierte sich über Wochen jeder einzelne Neustart zu einer „Schleife".
  if (fensterBeobachtungen > FLATTER_FENSTER && wachstum < NEUSTART_GRENZE) {
    fensterNeustarts = jetzt.neustarts;
    fensterBeobachtungen = 1;
    wachstum = 0;
  }

  const gestiegen = vorher !== null && jetzt.neustarts > vorher.neustarts;
  // `rotSeit` zählt die Beobachtungen, seit es rot ist — nicht die Zeit. Der
  // Wachhund weiß nichts über seinen eigenen Takt, und das soll so bleiben:
  // Wer ihn seltener laufen lässt, verschiebt damit die Frist, nicht die Logik.
  // Eine gesunde Messung setzt ihn zurück (der Holperstart von oben), löscht
  // aber nicht mehr das Fenster.
  const rotSeit = jetzt.gesund ? 0 : (vorher?.rotSeit ?? 0) + 1;
  const neuerStand = {
    neustarts: jetzt.neustarts,
    rotSeit,
    fensterNeustarts,
    fensterBeobachtungen,
  };

  // (a) Die flatternde Schleife.
  if (wachstum >= NEUSTART_GRENZE) {
    return {
      alarm: true,
      stoppen: !jetzt.gesund,
      grund:
        `Neustartschleife: ${wachstum} Neustarts in ${fensterBeobachtungen} ` +
        `Beobachtungen (Zähler ${fensterNeustarts} → ${jetzt.neustarts}). ` +
        (jetzt.gesund
          ? `Der Container antwortet gerade — er wird deshalb NICHT gestoppt, ` +
            `aber das ist keine Erholung, das ist der Takt der Schleife.`
          : `Container wird gestoppt, damit die Schleife endet und der Zustand ` +
            `untersuchbar bleibt.`),
      neuerStand,
    };
  }

  // (b) Durchgehend rot und steigend — unverändert.
  const schleife =
    rotSeit >= BEOBACHTUNGEN &&
    jetzt.neustarts >= NEUSTART_GRENZE &&
    (gestiegen || vorher === null);

  if (schleife) {
    return {
      alarm: true,
      stoppen: true,
      grund:
        `Neustartschleife: ${jetzt.neustarts} Neustarts, seit ${rotSeit} ` +
        `Beobachtungen ununterbrochen rot. Container wird gestoppt, damit die ` +
        `Schleife endet und der Zustand untersuchbar bleibt.`,
      neuerStand,
    };
  }

  // Rot, aber (noch) keine Schleife: einmal melden, sobald die Beobachtungs-
  // schwelle erreicht ist — nicht bei jedem Tick, sonst ist der Alarm Rauschen.
  if (rotSeit === BEOBACHTUNGEN) {
    return {
      alarm: true,
      stoppen: false,
      grund: `Seit ${rotSeit} Beobachtungen nicht erreichbar (${jetzt.neustarts} Neustarts).`,
      neuerStand,
    };
  }

  if (jetzt.gesund) {
    // Ganz ruhig — kein Wachstum im Fenster: Dann darf wirklich alles vergessen
    // werden. Das ist der Holperstart, der sich gefangen hat.
    if (wachstum === 0) {
      return { alarm: false, stoppen: false, grund: "gesund", neuerStand: null };
    }
    // Gesund, aber der Zähler ist im Fenster gestiegen: still weiterschauen.
    // Genau dieses Weiterschauen fehlte, und daran ist die flatternde Schleife
    // durchgerutscht.
    return {
      alarm: false,
      stoppen: false,
      grund: `gesund, aber ${wachstum} Neustarts im laufenden Fenster`,
      neuerStand,
    };
  }

  return { alarm: false, stoppen: false, grund: "rot, noch in Frist", neuerStand };
}

/**
 * Aufruf aus `deploy/wachhund.sh`. Liest ausschließlich aus argv und schreibt
 * ausschließlich nach stdout — alles andere macht die Shell.
 */
function hauptlauf() {
  const args = process.argv.slice(2);
  if (args[0] !== "--urteil") {
    console.error(
      "Aufruf: node scripts/wachhund.mjs --urteil <gesund:0|1> <neustarts> [stand-json]",
    );
    process.exit(2);
  }
  const gesund = args[1] === "1";
  const neustarts = Number.isFinite(Number(args[2])) ? Number(args[2]) : 0;
  let vorher = null;
  if (args[3]) {
    try {
      const roh = JSON.parse(args[3]);
      const zahl = (v) => typeof v === "number" && Number.isFinite(v);
      if (zahl(roh?.neustarts) && zahl(roh?.rotSeit)) {
        // ALLE Felder durchreichen, die beurteile() kennt.
        //
        // Hier standen nur `neustarts` und `rotSeit`. Die Fensterfelder fielen
        // damit bei JEDEM Lauf weg — das Fenster konnte über Aufrufe hinweg gar
        // nicht wachsen, und die Erkennung der flatternden Schleife wäre im
        // Betrieb wirkungslos geblieben, während die Tests von beurteile()
        // grün sind. Also wieder ein Wächter über einem Pfad, den niemand
        // erreicht. Aufgefallen erst beim echten Durchlauf durch die CLI.
        vorher = {
          neustarts: roh.neustarts,
          rotSeit: roh.rotSeit,
          ...(zahl(roh?.fensterNeustarts)
            ? { fensterNeustarts: roh.fensterNeustarts }
            : {}),
          ...(zahl(roh?.fensterBeobachtungen)
            ? { fensterBeobachtungen: roh.fensterBeobachtungen }
            : {}),
        };
      }
    } catch {
      // Unlesbarer Stand = kein Stand. Die Frist beginnt von vorn; das ist die
      // vorsichtige Richtung (es wird eher zu spät gestoppt als zu früh).
      vorher = null;
    }
  }
  process.stdout.write(JSON.stringify(beurteile({ gesund, neustarts }, vorher)));
}

if (process.argv[1] && process.argv[1].endsWith("wachhund.mjs")) hauptlauf();
