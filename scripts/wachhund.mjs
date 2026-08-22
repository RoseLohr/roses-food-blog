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
 * Die ganze Entscheidung, als reine Funktion.
 *
 * @param jetzt    { gesund: boolean, neustarts: number }  — aktuelle Messung
 * @param vorher   { neustarts: number, rotSeit: number } | null — letzter Stand
 * @returns { alarm, stoppen, grund, neuerStand }
 */
export function beurteile(jetzt, vorher) {
  // Grün: alles zurücksetzen. Ein einmal überstandener Holperstart darf sich
  // nicht auf die nächste Störung anrechnen lassen.
  if (jetzt.gesund) {
    return { alarm: false, stoppen: false, grund: "gesund", neuerStand: null };
  }

  const gestiegen = vorher !== null && jetzt.neustarts > vorher.neustarts;
  // `rotSeit` zählt die Beobachtungen, seit es rot ist — nicht die Zeit. Der
  // Wachhund weiß nichts über seinen eigenen Takt, und das soll so bleiben:
  // Wer ihn seltener laufen lässt, verschiebt damit die Frist, nicht die Logik.
  const rotSeit = (vorher?.rotSeit ?? 0) + 1;
  const neuerStand = { neustarts: jetzt.neustarts, rotSeit };

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
      if (
        typeof roh?.neustarts === "number" &&
        Number.isFinite(roh.neustarts) &&
        typeof roh?.rotSeit === "number" &&
        Number.isFinite(roh.rotSeit)
      ) {
        vorher = { neustarts: roh.neustarts, rotSeit: roh.rotSeit };
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
