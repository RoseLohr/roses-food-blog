/**
 * Die reine Sitzungslogik — ohne Datenbank, ohne Next, mit injizierter Uhr.
 *
 * Bis 10/2026 war der Lebenszyklus der Admin-Sitzung von keinem Test gepinnt
 * (tests/auth.integration.test.ts prüfte nur erstellen/validieren/zerstören).
 * Die Folge blieb ein halbes Jahr unbemerkt: Die Datenbank verlängerte die
 * Sitzung, das Browser-Cookie nicht — der Admin flog 14 Tage nach dem Login
 * aus dem Editor, egal wie aktiv er war.
 *
 * Hier stehen die drei Entscheidungen, die alles Übrige nur noch anwendet:
 *  - sitzungsZustand: gültig, verlängern oder abgelaufen — mit HÖCHSTDAUER ab
 *    Login als Gegengewicht zum gleitenden Ablauf (Verfassung Art. XIV: eine
 *    Lockerung braucht eine Ersatzkontrolle).
 *  - neuesAblaufdatum: gleitend, aber nie über die Höchstdauer hinaus.
 *  - sichererRueckweg: wohin der Login nach dem Anmelden zurückspringen darf —
 *    nur in den Admin, nie nach draußen (offener Redirect), nie auf den Login.
 */
import { describe, expect, it } from "vitest";
import {
  SITZUNG_DAUER_MS,
  SITZUNG_HOECHSTDAUER_MS,
  SITZUNG_VERLAENGERN_UNTER_MS,
  neuesAblaufdatum,
  sichererRueckweg,
  sitzungsCookieOptionen,
  sitzungsZustand,
} from "@/lib/sitzung";

const TAG = 24 * 60 * 60 * 1000;
const JETZT = new Date("2026-10-22T16:30:00Z");
const vor = (tage: number) => new Date(JETZT.getTime() - tage * TAG);
const in_ = (tage: number) => new Date(JETZT.getTime() + tage * TAG);

describe("Konstanten", () => {
  it("14 Tage gleitend, Verlängerung unter 7 Tagen Rest, höchstens 90 Tage ab Login", () => {
    expect(SITZUNG_DAUER_MS).toBe(14 * TAG);
    expect(SITZUNG_VERLAENGERN_UNTER_MS).toBe(7 * TAG);
    expect(SITZUNG_HOECHSTDAUER_MS).toBe(90 * TAG);
  });
});

describe("sitzungsZustand", () => {
  it("gültig, solange mehr als 7 Tage übrig sind", () => {
    expect(sitzungsZustand({ createdAt: vor(1), expiresAt: in_(13) }, JETZT)).toBe("gueltig");
    expect(sitzungsZustand({ createdAt: vor(7), expiresAt: in_(7.001) }, JETZT)).toBe("gueltig");
  });

  it("verlängern, sobald weniger als 7 Tage übrig sind", () => {
    expect(sitzungsZustand({ createdAt: vor(8), expiresAt: in_(6) }, JETZT)).toBe("verlaengern");
    expect(sitzungsZustand({ createdAt: vor(8), expiresAt: in_(6.999) }, JETZT)).toBe("verlaengern");
    // Genau 7 Tage sind NICHT „weniger als 7 Tage".
    expect(sitzungsZustand({ createdAt: vor(7), expiresAt: in_(7) }, JETZT)).toBe("gueltig");
  });

  it("abgelaufen, wenn das Ablaufdatum erreicht ist — auch genau jetzt", () => {
    expect(sitzungsZustand({ createdAt: vor(14), expiresAt: vor(0.001) }, JETZT)).toBe("abgelaufen");
    expect(sitzungsZustand({ createdAt: vor(14), expiresAt: JETZT }, JETZT)).toBe("abgelaufen");
    expect(sitzungsZustand({ createdAt: vor(14), expiresAt: in_(0.001) }, JETZT)).toBe("verlaengern");
  });

  it("abgelaufen nach der Höchstdauer, auch wenn das Ablaufdatum noch in der Zukunft liegt", () => {
    // Genau das ist der Fall, den ein gleitendes Cookie sonst unendlich machte.
    expect(sitzungsZustand({ createdAt: vor(90), expiresAt: in_(13) }, JETZT)).toBe("abgelaufen");
    expect(sitzungsZustand({ createdAt: vor(91), expiresAt: in_(1) }, JETZT)).toBe("abgelaufen");
    expect(sitzungsZustand({ createdAt: vor(89.999), expiresAt: in_(13) }, JETZT)).toBe("gueltig");
  });
});

describe("neuesAblaufdatum", () => {
  it("gleitet um 14 Tage ab jetzt", () => {
    expect(neuesAblaufdatum(vor(10), JETZT).getTime()).toBe(in_(14).getTime());
  });

  it("endet spätestens an der Höchstdauer ab Login", () => {
    // 85 Tage alt: 14 Tage ab jetzt lägen bei Tag 99 — erlaubt sind 90.
    expect(neuesAblaufdatum(vor(85), JETZT).getTime()).toBe(vor(85).getTime() + 90 * TAG);
    // 76 Tage alt: Tag 90 ist genau jetzt + 14 — beides dasselbe.
    expect(neuesAblaufdatum(vor(76), JETZT).getTime()).toBe(in_(14).getTime());
  });
});

describe("sichererRueckweg", () => {
  it("lässt nur Pfade innerhalb des Admins durch — so, wie sie sind", () => {
    for (const pfad of [
      "/admin",
      "/admin/rezepte/3",
      "/admin/rezepte/3?meldung=Rezept%20gespeichert.",
      "/admin/reisen/7/vorschau",
    ]) {
      expect(sichererRueckweg(pfad), pfad).toBe(pfad);
    }
  });

  it("verwirft alles, was nach draußen oder auf den Login führte", () => {
    for (const wert of [
      null,
      undefined,
      "",
      "/",
      "/rezepte/linsen",
      "/adminx",
      "/admin/login",
      "/admin/login?zurueck=%2Fadmin",
      "https://example.org/admin",
      "//example.org/admin",
      "/\\example.org/admin",
      "/admin/\\example.org",
      "javascript:alert(1)",
      "/admin/rezepte\n/x",
      "/admin/rezepte\r",
      " /admin",
      42,
      ["/admin"],
    ]) {
      expect(sichererRueckweg(wert), JSON.stringify(wert)).toBeNull();
    }
  });
});

describe("sitzungsCookieOptionen", () => {
  it("HttpOnly, Lax, Pfad /, 14 Tage — und Secure nur im Produktionsbetrieb", () => {
    expect(sitzungsCookieOptionen(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 14 * 24 * 60 * 60,
    });
    expect(sitzungsCookieOptionen(false).secure).toBe(false);
  });
});
