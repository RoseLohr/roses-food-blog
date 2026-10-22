/**
 * Die Regeln der Admin-Sitzung — rein, ohne Datenbank und ohne Next, mit
 * injizierter Uhr. Angewendet werden sie an drei Stellen: in auth-core.ts
 * (Datenbankzeile), in auth.ts (Guard und Login) und in src/proxy.ts
 * (Browser-Cookie).
 *
 * ── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 *
 * Bis 10/2026 verlängerte nur die DATENBANK: Lag der Ablauf unter 7 Tagen,
 * wurde die Zeile auf 14 Tage gesetzt. Das COOKIE im Browser bekam sein
 * Ablaufdatum aber nur einmal, beim Login (`setSessionCookie` hatte genau
 * einen Aufrufer). Nach 14 Tagen warf der Browser es weg — egal wie aktiv der
 * Admin war, auch mitten im Rezept-Editor. docs/ASSUMPTIONS.md nannte das
 * „Sliding Expiration"; es galt nur für die Hälfte, die niemand sieht.
 *
 * Jetzt gleiten beide: Der Proxy gibt das Cookie bei jeder Admin-Anfrage mit
 * frischen 14 Tagen zurück, die Datenbank verlängert wie gehabt. Schluss ist
 * nach 14 Tagen OHNE Admin-Besuch — und spätestens 90 Tage nach dem Login.
 * Diese HÖCHSTDAUER ist kein Schmuck: Ein gleitendes Cookie verlängert auch
 * das Fenster eines gestohlenen Cookies. Verfassung Art. XIV verlangt für
 * jede Lockerung eine Ersatzkontrolle; das ist sie. Sie gilt im Code, nicht
 * im Cookie — der Proxy kennt das Login-Datum nicht und muss es nicht kennen,
 * denn ohne gültige Zeile ist ein Cookie wertlos.
 *
 * ── WARUM REIN ─────────────────────────────────────────────────────────────
 *
 * Diese Entscheidungen stehen im Mutations-Scope (stryker.config.json) und
 * werden mit fester Uhr geprüft (tests/sitzung.test.ts). Die Datei importiert
 * nichts — der Proxy lädt sie, und der soll weder die Datenbank noch
 * `next/headers` mitziehen.
 */

const TAG_MS = 24 * 60 * 60 * 1000;

/** Gleitende Dauer: so lange lebt die Sitzung ab der letzten Admin-Anfrage. */
export const SITZUNG_DAUER_MS = 14 * TAG_MS;
/** Unter diesem Rest verlängert die Datenbank ihre Zeile. */
export const SITZUNG_VERLAENGERN_UNTER_MS = 7 * TAG_MS;
/** Spätestens dann ist Schluss, gleiten hin oder her — gerechnet ab Login. */
export const SITZUNG_HOECHSTDAUER_MS = 90 * TAG_MS;

export const SITZUNGS_COOKIE = "session";

/**
 * Der Kopf, in dem der Proxy dem Guard sagt, welche Seite angefragt war —
 * damit der Login dorthin zurückführen kann. Der Proxy SETZT ihn bei jeder
 * Admin-Anfrage, er übernimmt nie einen vom Client mitgeschickten.
 */
export const PFAD_KOPF = "x-pfad";

export type SitzungsZustand = "gueltig" | "verlaengern" | "abgelaufen";

/**
 * Was mit einer Sitzungszeile zu tun ist. „Gültig bis" ist ausschließend:
 * Genau zum Ablaufzeitpunkt ist sie vorbei.
 */
export function sitzungsZustand(
  sitzung: { createdAt: Date; expiresAt: Date },
  jetzt: Date,
): SitzungsZustand {
  const t = jetzt.getTime();
  if (sitzung.expiresAt.getTime() <= t) return "abgelaufen";
  if (t - sitzung.createdAt.getTime() >= SITZUNG_HOECHSTDAUER_MS) return "abgelaufen";
  if (sitzung.expiresAt.getTime() - t < SITZUNG_VERLAENGERN_UNTER_MS) return "verlaengern";
  return "gueltig";
}

/** 14 Tage ab jetzt — aber nie über die Höchstdauer ab Login hinaus. */
export function neuesAblaufdatum(createdAt: Date, jetzt: Date): Date {
  return new Date(
    Math.min(
      jetzt.getTime() + SITZUNG_DAUER_MS,
      createdAt.getTime() + SITZUNG_HOECHSTDAUER_MS,
    ),
  );
}

/**
 * Wohin der Login nach dem Anmelden zurückspringen darf: nur auf einen Pfad
 * INNERHALB des Admins, und nie auf den Login selbst (sonst drehte sich der
 * Rückweg im Kreis). Alles andere — fremde Adressen, `//host`, Backslashes,
 * Steuerzeichen — ist ein offener Redirect und wird verworfen, nicht
 * repariert. Der Wert kommt aus einem Suchparameter oder Formularfeld; er ist
 * Nutzereingabe.
 */
export function sichererRueckweg(wert: unknown): string | null {
  if (typeof wert !== "string") return null;
  if (!/^\/admin(?:$|[/?#])/.test(wert)) return null;
  if (/[\\\s]/.test(wert)) return null;
  if (wert.startsWith("/admin/login")) return null;
  return wert;
}

/**
 * Die Attribute des Sitzungs-Cookies — EINE Quelle für Login und Proxy.
 * `secure` nur im Produktionsbetrieb: Die örtliche Entwicklung läuft über
 * http, dort würde der Browser das Cookie sonst verwerfen.
 */
export function sitzungsCookieOptionen(produktion: boolean) {
  return {
    httpOnly: true,
    secure: produktion,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SITZUNG_DAUER_MS / 1000,
  };
}
