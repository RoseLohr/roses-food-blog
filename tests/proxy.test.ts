/**
 * src/proxy.ts — die Stelle, an der das Sitzungs-Cookie bei JEDER
 * Admin-Anfrage erneuert wird.
 *
 * Warum ein Proxy und nicht der Guard: In Next dürfen Cookies nur in Server
 * Actions, Route Handlern und im Proxy gesetzt werden. `requireAdmin()` läuft
 * im Layout und in den Seiten — dort wirft `cookies().set` einen Fehler. Die
 * Verlängerung der Datenbankzeile gab es seit jeher; das Cookie bekam sein
 * Ablaufdatum nur einmal, beim Login.
 *
 * Geprüft auf Request-Ebene, ohne Server: Der Proxy ist eine Funktion von
 * NextRequest nach NextResponse. Ob er im laufenden Server auf `/admin`
 * greift (matcher) und der Guard den Pfad bekommt, misst
 * tests/e2e/sitzung-verlaengerung.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import proxy, { config } from "@/proxy";

function anfrage(pfad: string, kopf: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3333${pfad}`, { headers: kopf });
}

function sitzungsCookie(antwort: Response): string | undefined {
  return antwort.headers
    .getSetCookie()
    .find((wert) => wert.startsWith("session="));
}

describe("proxy", () => {
  it("greift nur im Admin", () => {
    expect(config.matcher).toEqual(["/admin/:path*"]);
  });

  it("erneuert ein vorhandenes Sitzungs-Cookie mit vollen 14 Tagen", () => {
    const antwort = proxy(anfrage("/admin/rezepte/3", { cookie: "session=abc123" }));
    const cookie = sitzungsCookie(antwort);
    expect(cookie).toBeDefined();
    expect(cookie).toContain("session=abc123");
    expect(cookie).toMatch(/max-age=1209600/i);
    expect(cookie).toMatch(/httponly/i);
    expect(cookie).toMatch(/samesite=lax/i);
    expect(cookie).toMatch(/path=\//i);
  });

  it("setzt ohne Sitzung kein Cookie — ein leeres Cookie wäre ein Logout", () => {
    expect(sitzungsCookie(proxy(anfrage("/admin/rezepte/3")))).toBeUndefined();
    expect(sitzungsCookie(proxy(anfrage("/admin/login", { cookie: "andere=1" })))).toBeUndefined();
  });

  it("erneuert nicht auf der Login-Seite", () => {
    // Wer dort landet, hat (noch) keine gültige Sitzung; ein altes Cookie zu
    // verlängern wäre sinnlos — und verwischt den Zeitpunkt des Ablaufs.
    expect(sitzungsCookie(proxy(anfrage("/admin/login", { cookie: "session=abc123" })))).toBeUndefined();
  });

  it("reicht die Anfrage weiter (kein Rewrite, keine Umleitung)", () => {
    const antwort = proxy(anfrage("/admin/rezepte/3", { cookie: "session=abc123" }));
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("location")).toBeNull();
  });

  it("gibt dem Guard den angefragten Pfad mit — und überschreibt, was der Client schickt", () => {
    // Next trägt Kopfzeilen für die weitergereichte Anfrage als
    // `x-middleware-request-<name>` in der Antwort des Proxys. Der Guard
    // verlässt sich auf diesen Wert; ein vom Client gesetzter `x-pfad`
    // darf ihn nie erreichen (sonst zeigte der Rückweg, wohin ein Fremder
    // will).
    const antwort = proxy(
      anfrage("/admin/rezepte/3?meldung=x", { "x-pfad": "/admin/benutzer" }),
    );
    expect(antwort.headers.get("x-middleware-request-x-pfad")).toBe("/admin/rezepte/3?meldung=x");
  });
});
