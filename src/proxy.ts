/**
 * Proxy (Next 16; früher „Middleware"): läuft vor jeder Admin-Anfrage und tut
 * zwei Dinge, die sonst nirgends möglich sind.
 *
 * 1. Das Sitzungs-Cookie ERNEUERN. In Next dürfen Cookies nur in Server
 *    Actions, Route Handlern und hier gesetzt werden; `requireAdmin()` läuft
 *    im Layout und in den Seiten, wo `cookies().set` einen Fehler wirft.
 *    Deshalb bekam das Cookie sein Ablaufdatum bis 10/2026 nur beim Login und
 *    verschwand 14 Tage später — die Regel steht in src/lib/sitzung.ts.
 *    Erneuert wird nur, was da ist: Ein leeres Cookie zu setzen wäre ein
 *    Logout. Und nicht auf der Login-Seite: Wer dort landet, hat keine
 *    gültige Sitzung mehr; sie zu verlängern verwischte nur, wann sie endete.
 *    Ob die Zeile in der Datenbank noch gilt, prüft nicht der Proxy — ohne
 *    sie ist das erneuerte Cookie wertlos, und das ist in Ordnung.
 *
 * 2. Dem Guard den angefragten PFAD mitgeben (`x-pfad`), damit der Login
 *    nach dem Anmelden dorthin zurückführt statt nach /admin. Der Kopf wird
 *    immer GESETZT, nie übernommen: Ein Client könnte ihn selbst schicken, und
 *    der Guard verlässt sich darauf.
 *
 * Keine Datenbank, kein `next/headers`: Der Proxy lädt nur die reinen Regeln.
 * Gemessen ohne Server in tests/proxy.test.ts, mit Server in
 * tests/e2e/sitzung-verlaengerung.spec.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { PFAD_KOPF, SITZUNGS_COOKIE, sitzungsCookieOptionen } from "@/lib/sitzung";

// Beides sind Admin-Anfragen: Unter /api/admin lässt getCurrentAdmin die
// Zeile gleiten, also muss dort auch das Cookie gleiten — dieselben Auslöser
// für beide Hälften (src/lib/sitzung.ts, SitzungsAnlass).
export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };

export default function proxy(request: NextRequest): NextResponse {
  const kopf = new Headers(request.headers);
  kopf.set(PFAD_KOPF, request.nextUrl.pathname + request.nextUrl.search);
  const antwort = NextResponse.next({ request: { headers: kopf } });

  const token = request.cookies.get(SITZUNGS_COOKIE)?.value;
  if (token && !request.nextUrl.pathname.startsWith("/admin/login")) {
    antwort.cookies.set(
      SITZUNGS_COOKIE,
      token,
      sitzungsCookieOptionen(process.env.NODE_ENV === "production"),
    );
  }
  return antwort;
}
