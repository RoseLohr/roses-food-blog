/**
 * Der Alarmweg muss AUSSERHALB der Anwendung funktionieren.
 *
 * DER BEFUND (Gegenprüfung des Deploy-Pfads, Nr. 2): Startet der Container gar
 * nicht, schweigt die Meldekette — der Selbst-Monitor läuft ja IN der
 * Anwendung. Genau im schlimmsten Fall erfährt es niemand.
 *
 * Geprüft wird hier die Entscheidung, nicht der Versand: Wohin geht der Alarm,
 * und wann darf er ausbleiben? Ein fehlender Alarmweg darf einen Rollback
 * nicht zusätzlich blockieren — aber er darf auch nicht unbemerkt bleiben.
 */
import { describe, expect, it } from "vitest";
import { alarmplan, empfaenger } from "../scripts/betriebsalarm.mjs";

describe("Betriebsalarm", () => {
  it("nimmt dieselbe Empfänger-Rangfolge wie der Selbst-Monitor", () => {
    // Identisch zu alertRecipient() in src/lib/observability.ts. Zwei Wege,
    // dieselbe Antwort — sonst alarmiert der Notweg jemand anderen als der
    // Regelweg.
    expect(empfaenger({ smtp_from: "s@x.de" }, { ALERT_EMAIL: "a@x.de", ADMIN_EMAIL: "b@x.de" })).toBe("a@x.de");
    expect(empfaenger({ smtp_from: "s@x.de" }, { ADMIN_EMAIL: "b@x.de" })).toBe("b@x.de");
    expect(empfaenger({ smtp_from: "s@x.de" }, {})).toBe("s@x.de");
    expect(empfaenger({}, { SMTP_FROM: "e@x.de" })).toBe("e@x.de");
    expect(empfaenger({}, {})).toBe("");
  });

  it("verschickt, sobald Host UND Empfänger stehen", () => {
    expect(alarmplan({ smtp_host: "mail", smtp_from: "s@x.de" }, {})).toEqual({
      verschicken: true,
      grund: "",
      an: "s@x.de",
    });
  });

  it("benennt, WARUM nicht verschickt wird, statt still zu scheitern", () => {
    expect(alarmplan({}, {}).verschicken).toBe(false);
    expect(alarmplan({}, {}).grund).toMatch(/SMTP-Host/);
    expect(alarmplan({ smtp_host: "mail" }, {}).verschicken).toBe(false);
    expect(alarmplan({ smtp_host: "mail" }, {}).grund).toMatch(/Empfänger/);
  });

  it("nimmt die Umgebung, wenn die Datenbank nichts hergibt", () => {
    // Der Fall, in dem alarmiert werden soll: Die Datenbank ist womöglich
    // gerade das Problem. Dann muss die Umgebung reichen.
    expect(alarmplan({}, { SMTP_HOST: "mail", ALERT_EMAIL: "a@x.de" })).toEqual({
      verschicken: true,
      grund: "",
      an: "a@x.de",
    });
  });
});
