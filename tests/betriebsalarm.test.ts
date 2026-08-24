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
import { alarmplan, empfaenger, smtpZugang } from "../scripts/betriebsalarm.mjs";

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

describe("Die Anmeldung kommt notfalls auch aus der Umgebung", () => {
  it("nimmt Benutzer und Passwort aus der Umgebung, wenn die Datenbank schweigt", () => {
    // Genau der Fall der dokumentierten Installation: bootstrap.sh legt die
    // SMTP-Daten NUR in die .env. Vorher endete der Rückfall bei Host, Port
    // und Absender — verbunden wurde dann ohne Anmeldung, und der Versand
    // scheiterte an der Auth, ohne dass es jemand erfuhr.
    const z = smtpZugang(
      {},
      { SMTP_HOST: "mail", SMTP_USER: "u", SMTP_PASS: "p" },
    );
    expect(z.host).toBe("mail");
    expect(z.auth).toEqual({ user: "u", pass: "p" });
  });

  it("die Datenbank hat Vorrang vor der Umgebung", () => {
    const z = smtpZugang(
      { smtp_host: "db-host", smtp_user: "db-user", smtp_pass: "db-pass" },
      { SMTP_HOST: "env-host", SMTP_USER: "env-user", SMTP_PASS: "env-pass" },
    );
    expect(z.host).toBe("db-host");
    expect(z.auth).toEqual({ user: "db-user", pass: "db-pass" });
  });

  it("ohne Benutzer wird ohne Anmeldung verbunden — nicht mit leerer", () => {
    // `auth: { user: "", pass: "" }` würde nodemailer zu einem AUTH-Versuch
    // mit leeren Angaben bewegen; `undefined` heißt „gar keine Anmeldung".
    const z = smtpZugang({}, { SMTP_HOST: "mail" });
    expect(z.auth).toBeUndefined();
  });

  it("nimmt das Passwort aus der Umgebung, wenn nur der Benutzer in der DB steht", () => {
    // Der Fall, den das Admin-Formular erzeugt: Es schreibt smtp_pass nur bei
    // Neueingabe, den Benutzer aber immer.
    const z = smtpZugang({ smtp_user: "u" }, { SMTP_PASS: "aus-env" });
    expect(z.auth).toEqual({ user: "u", pass: "aus-env" });
  });

  it("der Standard-Port ist 587, wenn nirgends einer steht", () => {
    expect(smtpZugang({}, {}).port).toBe(587);
  });
});
