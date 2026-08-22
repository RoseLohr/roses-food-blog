/**
 * Der Wachhund entscheidet, wann eine Neustartschleife keine
 * Anlaufschwierigkeit mehr ist.
 *
 * DER BEFUND (Gegenprüfung des Deploy-Pfads, Nr. 5): `restart: always` startet
 * einen sterbenden Container ohne Obergrenze neu — keine Grenze, kein Alarm,
 * kein Ende. `restart: on-failure:N` wäre der naheliegende Griff und WÄRE
 * FALSCH: `podman-restart.service` startet nach einem Rechnerneustart nur
 * Container mit der Regel `always`. Der Tausch würde eine Störung gegen den
 * Ausfall vom 2026-08-10 eintauschen.
 *
 * Die Grenze zieht deshalb der Wachhund, und die Entscheidung dafür ist eine
 * reine Funktion — sonst wäre sie nur auf einer echten Anlage prüfbar, also
 * nie.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEOBACHTUNGEN,
  NEUSTART_GRENZE,
  beurteile,
} from "../scripts/wachhund.mjs";

/** Mehrere Beobachtungen hintereinander, den Stand jeweils weiterreichen. */
function laufen(messungen: Array<{ gesund: boolean; neustarts: number }>) {
  let stand: { neustarts: number; rotSeit: number } | null = null;
  return messungen.map((m) => {
    const u = beurteile(m, stand);
    stand = u.neuerStand;
    return u;
  });
}

describe("Wachhund", () => {
  it("hält bei einem gesunden Container still und vergisst die Vorgeschichte", () => {
    const [u] = laufen([{ gesund: true, neustarts: 42 }]);
    expect(u).toEqual({
      alarm: false,
      stoppen: false,
      grund: "gesund",
      neuerStand: null,
    });
  });

  it("lässt einen holprigen Start durchgehen, der sich selbst fängt", () => {
    // Genau das ist der Grund für die Frist: Ein Container, der einmal
    // stolpert und dann grün wird, darf NICHT gestoppt werden.
    const u = laufen([
      { gesund: false, neustarts: 6 },
      { gesund: false, neustarts: 7 },
      { gesund: true, neustarts: 7 },
    ]);
    expect(u.map((x) => x.stoppen)).toEqual([false, false, false]);
    expect(u.map((x) => x.alarm)).toEqual([false, false, false]);
    // Die Frist beginnt von vorn: rotSeit ist zurück auf 0.
    expect(u[2].neuerStand?.rotSeit).toBe(0);
    // ABER der Neustartzähler bleibt im Blick. Hier stand vorher
    // `toBeNull()` — der Zustand wurde bei jeder gesunden Messung vollständig
    // weggeworfen, samt Zähler. Genau daran ist die flatternde Schleife
    // weiter unten durchgerutscht. Ein Neustart in diesem Fenster ist
    // harmlos (die Schwelle liegt bei fünf), aber er wird nicht vergessen.
    expect(u[2].neuerStand?.fensterNeustarts).toBe(6);
    expect(u[2].neuerStand?.neustarts).toBe(7);
  });

  it("stoppt erst, wenn es lange genug rot UND die Zahl hoch genug ist", () => {
    const u = laufen([
      { gesund: false, neustarts: NEUSTART_GRENZE + 1 },
      { gesund: false, neustarts: NEUSTART_GRENZE + 2 },
      { gesund: false, neustarts: NEUSTART_GRENZE + 3 },
    ]);
    expect(u.slice(0, BEOBACHTUNGEN - 1).every((x) => !x.stoppen)).toBe(true);
    expect(u[BEOBACHTUNGEN - 1].stoppen).toBe(true);
    expect(u[BEOBACHTUNGEN - 1].alarm).toBe(true);
    expect(u[BEOBACHTUNGEN - 1].grund).toMatch(/Neustartschleife/);
  });

  it("stoppt NICHT, wenn die Seite rot ist, der Container aber gar nicht neu startet", () => {
    // Wichtige Unterscheidung: Eine tote Seite ohne Neustarts ist etwas
    // anderes als eine Schleife — da hilft Stoppen nicht, da hilft Melden.
    const u = laufen([
      { gesund: false, neustarts: 0 },
      { gesund: false, neustarts: 0 },
      { gesund: false, neustarts: 0 },
      { gesund: false, neustarts: 0 },
    ]);
    expect(u.every((x) => !x.stoppen)).toBe(true);
    // Gemeldet wird es trotzdem, und zwar GENAU EINMAL.
    expect(u.map((x) => x.alarm)).toEqual([false, false, true, false]);
  });

  it("meldet nicht bei jedem Takt — sonst ist der Alarm Rauschen", () => {
    const u = laufen(
      Array.from({ length: 8 }, () => ({ gesund: false, neustarts: 0 })),
    );
    expect(u.filter((x) => x.alarm)).toHaveLength(1);
  });

  it("zählt Beobachtungen, nicht Zeit — der Takt ist Sache des Aufrufers", () => {
    // Der Wachhund kennt seinen eigenen Takt nicht. Wer ihn seltener laufen
    // lässt, verschiebt damit die Frist, nicht die Logik. Das ist Absicht und
    // wird hier festgehalten, damit niemand später eine Uhr einbaut.
    const u = laufen([
      { gesund: false, neustarts: 99 },
      { gesund: false, neustarts: 100 },
    ]);
    expect(u[1].neuerStand).toEqual({
      neustarts: 100,
      rotSeit: 2,
      // Auch das Fenster zählt Beobachtungen, keine Zeit.
      fensterNeustarts: 99,
      fensterBeobachtungen: 2,
    });
    expect(u[1].stoppen).toBe(false);
  });

  /**
   * Die flatternde Schleife — der Fall, den der Wachhund bis 08/2026 NIE
   * erkannt hat.
   *
   * Ein Container, der nach dem Warmlaufen stirbt (OOM ist der Klassiker),
   * sieht bei jeder zweiten Messung gesund aus. Die alte Fassung setzte dann
   * den ganzen Zustand zurück: `rotSeit` erreichte die Schwelle von drei
   * ununterbrochen roten Beobachtungen nie, und der Neustartzähler — das
   * einzige monotone Zeugnis — flog gleich mit weg. `restart: always` blieb
   * damit unbegrenzt, also genau die Lage, gegen die es den Wachhund gibt.
   */
  it("erkennt eine Schleife, die zwischendurch gesund aussieht", () => {
    const u = laufen([
      { gesund: false, neustarts: 1 },
      { gesund: true, neustarts: 2 },
      { gesund: false, neustarts: 3 },
      { gesund: true, neustarts: 4 },
      { gesund: false, neustarts: 5 },
      { gesund: false, neustarts: 6 },
    ]);
    // Kein einziges Mal drei rote Beobachtungen hintereinander …
    expect(Math.max(...u.map((x) => x.neuerStand?.rotSeit ?? 0))).toBeLessThan(
      BEOBACHTUNGEN,
    );
    // … und trotzdem erkannt, weil der Zähler um NEUSTART_GRENZE gewachsen ist.
    expect(u.slice(0, 5).every((x) => !x.alarm)).toBe(true);
    expect(u[5].alarm).toBe(true);
    expect(u[5].stoppen).toBe(true);
    expect(u[5].grund).toMatch(/Neustartschleife: 5 Neustarts/);
  });

  it("stoppt NICHT, was gerade antwortet — meldet aber", () => {
    const u = laufen([
      { gesund: false, neustarts: 1 },
      { gesund: true, neustarts: 2 },
      { gesund: false, neustarts: 3 },
      { gesund: true, neustarts: 4 },
      { gesund: false, neustarts: 5 },
      { gesund: true, neustarts: 6 },
    ]);
    // Dieselbe Schleife, nur ist die letzte Messung grün. Einen Dienst
    // abzuschalten, der gerade Antworten liefert, wäre der Ausfall, den der
    // Wachhund verhindern soll — gemeldet wird trotzdem.
    expect(u[5].alarm).toBe(true);
    expect(u[5].stoppen).toBe(false);
    expect(u[5].grund).toMatch(/antwortet gerade/);
  });

  it("zählt Neustarts zweier verschiedener Container nicht zusammen", () => {
    // Jeder Deploy legt den Container neu an, RestartCount fängt bei 0 an.
    // Ohne diese Unterscheidung addierte sich der alte Zählerstand zum neuen.
    const u = laufen([
      { gesund: false, neustarts: 4 },
      { gesund: false, neustarts: 5 },
      { gesund: false, neustarts: 0 }, // neuer Container
      { gesund: false, neustarts: 1 },
    ]);
    expect(u[3].neuerStand?.fensterNeustarts).toBe(0);
    expect(u[3].grund).not.toMatch(/Neustartschleife: /);
  });

  it("ein einzelner Neustart pro Fenster summiert sich nicht zur Schleife", () => {
    // Über Wochen hinweg darf sich nicht jeder vereinzelte Neustart zu einer
    // „Schleife" aufaddieren — deshalb setzt das Fenster neu an, wenn es voll
    // ist, ohne die Schwelle erreicht zu haben.
    const messungen = [];
    for (let i = 1; i <= 24; i++) {
      messungen.push({ gesund: i % 4 !== 0, neustarts: Math.floor(i / 4) });
    }
    const u = laufen(messungen);
    expect(u.some((x) => x.stoppen)).toBe(false);
    expect(u.some((x) => /Neustartschleife: /.test(x.grund))).toBe(false);
  });

  /**
   * DURCH DIE CLI, nicht nur durch beurteile().
   *
   * `deploy/wachhund.sh` reicht den Stand als JSON-Argument hinein und schreibt
   * das zurückgegebene `neuerStand` in eine Datei — der nächste Lauf gibt es
   * wieder herein. Die Tests oben rufen `beurteile()` direkt und sehen diesen
   * Weg nie.
   *
   * Genau dort saß der Fehler: Die CLI baute `vorher` aus einer WEISSEN LISTE
   * mit `neustarts` und `rotSeit` zusammen; die Fensterfelder fielen bei jedem
   * Aufruf weg. Das Fenster hätte über Läufe hinweg nie wachsen können — die
   * Erkennung der flatternden Schleife wäre im Betrieb wirkungslos geblieben,
   * während alle Tests oben grün sind. Aufgefallen ist es nur beim echten
   * Durchlauf, nicht im Test. Deshalb steht dieser Test jetzt hier.
   */
  describe("der Zustand überlebt den Weg durch die CLI", () => {
    const SKRIPT = path.resolve(process.cwd(), "scripts/wachhund.mjs");

    /** Ein Urteil holen, so wie deploy/wachhund.sh es holt. */
    function urteil(gesund: boolean, neustarts: number, stand: unknown) {
      const args = ["--urteil", gesund ? "1" : "0", String(neustarts)];
      if (stand !== null) args.push(JSON.stringify(stand));
      return JSON.parse(
        execFileSync("node", [SKRIPT, ...args], { encoding: "utf8" }),
      );
    }

    it("reicht die Fensterfelder unverändert durch", () => {
      const u = urteil(false, 7, {
        neustarts: 6,
        rotSeit: 1,
        fensterNeustarts: 2,
        fensterBeobachtungen: 3,
      });
      // Der Zähler ist um 5 gewachsen — das MUSS die Schleife auslösen.
      expect(u.grund).toMatch(/Neustartschleife: 5 Neustarts/);
      expect(u.stoppen).toBe(true);
      // Und das Fenster ist nicht heimlich zurückgesetzt worden.
      expect(u.neuerStand.fensterNeustarts).toBe(2);
      expect(u.neuerStand.fensterBeobachtungen).toBe(4);
    });

    it("erkennt die flatternde Schleife über echte, aufeinanderfolgende Aufrufe", () => {
      const messungen = [
        { gesund: false, neustarts: 1 },
        { gesund: true, neustarts: 2 },
        { gesund: false, neustarts: 3 },
        { gesund: true, neustarts: 4 },
        { gesund: false, neustarts: 5 },
        { gesund: false, neustarts: 6 },
      ];
      let stand: unknown = null;
      const urteile = messungen.map((m) => {
        const u = urteil(m.gesund, m.neustarts, stand);
        stand = u.neuerStand;
        return u;
      });
      expect(urteile.slice(0, 5).every((u) => !u.alarm)).toBe(true);
      expect(urteile[5].alarm).toBe(true);
      expect(urteile[5].stoppen).toBe(true);
    });

    it("verträgt einen Stand aus der alten Fassung (ohne Fensterfelder)", () => {
      // Beim ersten Lauf nach dem Update liegt noch der alte Stand auf der
      // Platte. Er darf nichts umwerfen.
      const u = urteil(false, 9, { neustarts: 8, rotSeit: 2 });
      expect(u.neuerStand.fensterNeustarts).toBe(8);
      expect(u.neuerStand.fensterBeobachtungen).toBe(1);
    });

    it("verträgt unlesbaren Müll als Stand", () => {
      const args = ["--urteil", "0", "3", "{kein json"];
      const u = JSON.parse(
        execFileSync("node", [SKRIPT, ...args], { encoding: "utf8" }),
      );
      expect(u.neuerStand.rotSeit).toBe(1);
      expect(u.stoppen).toBe(false);
    });
  });
});
