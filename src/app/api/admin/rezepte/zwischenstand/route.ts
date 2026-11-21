/**
 * Der Zwischenstand aus dem Rezept-Editor (11/2026) — die Sicherung.
 *
 * Noch ruft nichts diesen Endpunkt auf: Der Editor folgt in eigenen Schritten.
 * Was hier über ihn steht, ist die Vorgabe für ihn, noch kein Verhalten.
 *
 * Ein ROUTE-HANDLER, keine Server-Action — und das ist der Kern: Nach einer
 * Server-Action rendert Next die Seite neu, und das geschützte Layout ruft
 * `requireAdmin()`. Ist die Sitzung abgelaufen, leitet das zum Login um, und
 * Next trägt diesen Redirect als Antwort der Action aus: Der Browser verließe
 * den Editor samt Inhalt, ausgelöst von einem Timer — genau das, was der
 * Zwischenstand verhindern soll. Ein Route-Handler rendert nichts; eine
 * abgelaufene Sitzung ist hier eine Antwort (401, `fehler: "sitzung"`), die
 * der Editor anzeigen wird, und der Inhalt bleibt stehen. Gemessen in
 * tests/recipe-zwischenstand-route.integration.test.ts.
 *
 * Unter /api/admin läuft die Anfrage durch den Proxy: Das Cookie gleitet dort
 * mit — bei jeder Anfrage, die eines trägt; der Proxy kennt die Herkunft
 * nicht. `getCurrentAdmin("admin-anfrage")` lässt die Zeile gleiten
 * (src/lib/sitzung.ts). Same-Origin über `isSameOriginRequest`
 * (src/lib/csrf.ts, Annahme B8) — und zwar ZUERST: Eine fremde Herkunft soll
 * die ZEILE nicht gleiten lassen, die Sitzung wird dann gar nicht erst
 * gefragt. Dass das Cookie der Zeile in diesem Fall vorausläuft, ist die
 * harmlose Richtung: Ohne gültige Zeile ist es wertlos.
 *
 * Jede Antwort ist ein Urteil über die Anfrage und steht in
 * `ZwischenstandAntwort`. Eine Störung der Ablage (gesperrte Datenbank,
 * voller Datenträger) ist keines: Sie wird geworfen. Next antwortet dann mit
 * 500 und meldet den Fehler über `onRequestError` (src/instrumentation.ts);
 * navigiert wird auch dabei nicht.
 *
 * Was der Handler NICHT erkennt: eine ERSTE Sicherung ohne Stand, die erst
 * nach dem Speichern des Rezepts ankommt. Sie ist von frischem Tippen nicht zu
 * unterscheiden und legt an. Vorgabe für den Editor: Sicherung und Speichern
 * sind nie gleichzeitig unterwegs.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import {
  STAND_FELD,
  formularAlsDaten,
  schluesselAus,
  standAus,
  type ZwischenstandAntwort,
  type ZwischenstandDaten,
} from "@/lib/recipe-zwischenstand";
import { zwischenstandSichern } from "@/lib/recipe-zwischenstand-store";
import { alsUhrzeit } from "@/lib/zeitpunkt";

export const dynamic = "force-dynamic";

function antwort(body: ZwischenstandAntwort, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/** Der Formularkörper — oder nichts, wenn keiner geschickt wurde. */
async function formularAus(req: Request): Promise<ZwischenstandDaten | null> {
  try {
    return formularAlsDaten(await req.formData());
  } catch (err) {
    // Kein Formular im Körper — der Editor schickt immer eines.
    console.error("[zwischenstand] Körper ist kein Formular:", err);
    return null;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(req)) return antwort({ fehler: "herkunft" }, 403);
  if (!(await getCurrentAdmin("admin-anfrage"))) return antwort({ fehler: "sitzung" }, 401);

  const daten = await formularAus(req);
  if (!daten) return antwort({ fehler: "ungueltig" }, 400);
  const schluessel = schluesselAus(daten);
  if (!schluessel) return antwort({ fehler: "ungueltig" }, 400);

  // Der bekannte Stand hängt an der Anfrage und wird nicht mit abgelegt: Der
  // Zwischenstand ist das rohe Formular und sonst nichts. Er wäre dort auch
  // schon beim Schreiben veraltet — die Zeile bekommt mit dieser Sicherung
  // einen neuen.
  const { [STAND_FELD]: standRoh, ...formular } = daten;

  // Was die Ablage wirft, wird nicht gefangen (siehe Kopf).
  const ergebnis = await zwischenstandSichern({
    schluessel,
    daten: formular,
    jetzt: new Date(),
    bekannterStand: standAus(standRoh?.[0]),
  });
  if (ergebnis.ergebnis === "weg") return antwort({ fehler: "weg" }, 409);
  if (ergebnis.ergebnis === "fremd") {
    return antwort(
      { fehler: "fremd", zeit: alsUhrzeit(ergebnis.gesichertAm), stand: ergebnis.stand },
      409,
    );
  }
  return antwort({ gesichert: alsUhrzeit(ergebnis.gesichertAm), stand: ergebnis.stand }, 200);
}
