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
    // Und danach beginnt die Zählung von vorn.
    expect(u[2].neuerStand).toBeNull();
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
    expect(u[1].neuerStand).toEqual({ neustarts: 100, rotSeit: 2 });
    expect(u[1].stoppen).toBe(false);
  });
});
