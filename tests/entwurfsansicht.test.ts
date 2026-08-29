/**
 * Die Sichtbarkeitsregel (src/lib/entwurfsansicht.ts).
 *
 * Vier Zeilen Logik — und trotzdem die Stelle, an der ein Fehler am teuersten
 * ist: Ein verdrehtes Vergleichszeichen macht aus „nur der angemeldete Admin
 * sieht Entwürfe" ein „jeder sieht Entwürfe", und das fällt beim Ansehen der
 * eigenen, angemeldeten Sitzung NIE auf.
 *
 * Deshalb wird hier die vollständige Wahrheitstafel geprüft, nicht der
 * Regelfall.
 */
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { SQLiteSyncDialect, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  VEROEFFENTLICHT,
  darfGezeigtWerden,
  sichtbarkeitFuerBesucher,
  statusBedingung,
  type Sichtbarkeit,
} from "@/lib/entwurfsansicht";
import { getCurrentAdmin } from "@/lib/auth";

/**
 * `getCurrentAdmin` liest ein Cookie über `next/headers` — außerhalb einer
 * Anfrage gibt es das nicht. Ersetzt wird deshalb genau diese eine Funktion;
 * geprüft wird, was `sichtbarkeitFuerBesucher` aus ihrer Antwort MACHT.
 *
 * Das ist die wichtigste Zeile des Moduls und zugleich die, die man beim
 * Ausprobieren nie falsch sieht: Wer entwickelt, ist angemeldet.
 */
vi.mock("@/lib/auth", () => ({ getCurrentAdmin: vi.fn() }));
const alsAdminAngemeldet = (ja: boolean) =>
  vi.mocked(getCurrentAdmin).mockResolvedValue(
    ja ? ({ id: 1 } as Awaited<ReturnType<typeof getCurrentAdmin>>) : null,
  );

const BEIDE: Sichtbarkeit[] = ["nur-veroeffentlicht", "auch-entwuerfe"];

/**
 * Drei Wegwerf-Tabellen statt `@/db`.
 *
 * Der Import von `@/db` öffnet eine echte SQLite-Datei; für eine Bedingung,
 * die nie ausgeführt wird, wäre das eine Nebenwirkung ohne Gegenwert. Geprüft
 * wird die Bedingung deshalb an ihrem ÜBERSETZTEN SQL — genau das, was die
 * Datenbank später zu sehen bekäme.
 */
const rezept = sqliteTable("recipe", { status: text("status").notNull() });
const reise = sqliteTable("travel_post", { status: text("status").notNull() });
const seite = sqliteTable("page", { status: text("status").notNull() });

const dialekt = new SQLiteSyncDialect();
const alsSql = (bedingung: ReturnType<typeof statusBedingung>) =>
  bedingung === undefined ? null : dialekt.sqlToQuery(bedingung);

describe("darfGezeigtWerden — die vollständige Wahrheitstafel", () => {
  it("zeigt Veröffentlichtes JEDEM", () => {
    for (const s of BEIDE) expect(darfGezeigtWerden(VEROEFFENTLICHT, s)).toBe(true);
  });

  it("zeigt einen Entwurf NUR bei „auch-entwuerfe“", () => {
    expect(darfGezeigtWerden("entwurf", "nur-veroeffentlicht")).toBe(false);
    expect(darfGezeigtWerden("entwurf", "auch-entwuerfe")).toBe(true);
  });

  it("behandelt jeden unbekannten Status wie einen Entwurf", () => {
    // Fail-closed: Käme je ein dritter Status dazu (z. B. „archiviert"), wäre
    // er verborgen, bis jemand ausdrücklich etwas anderes entscheidet — nicht
    // versehentlich öffentlich.
    for (const status of ["", "archiviert", "VEROEFFENTLICHT", "geplant"]) {
      expect(darfGezeigtWerden(status, "nur-veroeffentlicht")).toBe(false);
    }
  });

  it("hängt nicht an der Groß-/Kleinschreibung des gespeicherten Werts", () => {
    // Der Wert kommt aus einer CHECK-beschränkten Spalte; eine Abweichung wäre
    // ein Datenfehler und darf nicht als „veröffentlicht" durchgehen.
    expect(darfGezeigtWerden("Veroeffentlicht", "nur-veroeffentlicht")).toBe(false);
  });
});

describe("statusBedingung — was in die Abfrage geht", () => {
  it("schränkt für Dritte auf veröffentlicht ein — Wort für Wort dieselbe Bedingung wie zuvor von Hand", () => {
    const gebaut = alsSql(statusBedingung(rezept.status, "nur-veroeffentlicht"));
    const handgeschrieben = dialekt.sqlToQuery(eq(rezept.status, VEROEFFENTLICHT));
    expect(gebaut).not.toBeNull();
    expect(gebaut!.sql).toBe(handgeschrieben.sql);
    expect(gebaut!.params).toEqual(handgeschrieben.params);
    // Und der Wert, auf den verglichen wird, ist wirklich der gespeicherte.
    expect(gebaut!.params).toContain("veroeffentlicht");
  });

  it("lässt für den angemeldeten Admin gar keine Bedingung entstehen", () => {
    expect(statusBedingung(rezept.status, "auch-entwuerfe")).toBeUndefined();
  });

  it("gilt für jede Statusspalte, nicht nur für Rezepte", () => {
    for (const spalte of [rezept.status, reise.status, seite.status]) {
      expect(statusBedingung(spalte, "nur-veroeffentlicht")).toBeDefined();
      expect(statusBedingung(spalte, "auch-entwuerfe")).toBeUndefined();
    }
  });
});

describe("sichtbarkeitFuerBesucher — die eine Stelle, die die Sitzung liest", () => {
  it("gibt einem ANONYMEN Besucher nur Veröffentlichtes", async () => {
    alsAdminAngemeldet(false);
    expect(await sichtbarkeitFuerBesucher()).toBe("nur-veroeffentlicht");
  });

  it("gibt dem angemeldeten Admin auch die Entwürfe", async () => {
    alsAdminAngemeldet(true);
    expect(await sichtbarkeitFuerBesucher()).toBe("auch-entwuerfe");
  });

  it("liefert immer einen der beiden bekannten Werte", async () => {
    // Ein dritter Wert (etwa "" oder undefined) würde in `darfGezeigtWerden`
    // stillschweigend wie „nur veröffentlicht" wirken — und in
    // `statusBedingung` ebenso. Still richtig zu sein ist kein Ersatz dafür,
    // richtig zu sein.
    for (const angemeldet of [true, false]) {
      alsAdminAngemeldet(angemeldet);
      expect(BEIDE).toContain(await sichtbarkeitFuerBesucher());
    }
  });

  it("reicht den angemeldeten Benutzer NICHT weiter", async () => {
    // `getCurrentAdmin()` liefert die vollständige admin_user-Zeile samt
    // Passwort-Hash. Hier kommt ein Wort zurück, kein Benutzer.
    alsAdminAngemeldet(true);
    expect(typeof (await sichtbarkeitFuerBesucher())).toBe("string");
  });
});

describe("Der Vertrag der Aufrufstelle", () => {
  it("kennt genau zwei Werte — und keiner davon ist eine Vorgabe", () => {
    // Der Test steht hier als Erinnerung an die eigentliche Absicherung: Der
    // Parameter ist an jeder Aufrufstelle Pflicht. Ein optionaler Parameter
    // mit sicher aussehender Vorgabe würde genau die Stellen unsichtbar
    // machen, an denen später jemand etwas ändert.
    expect(BEIDE).toEqual(["nur-veroeffentlicht", "auch-entwuerfe"]);
  });
});
