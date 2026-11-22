/**
 * Der Zwischenstand aus dem Rezept-Editor (11/2026) — sichern und verwerfen.
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
 * `ZwischenstandAntwort` bzw. `VerwerfenAntwort`. Eine Störung der Ablage
 * (gesperrte Datenbank, voller Datenträger) ist keines: Sie wird geworfen.
 * Next antwortet dann mit 500 und meldet den Fehler über `onRequestError`
 * (src/instrumentation.ts); navigiert wird auch dabei nicht.
 *
 * Was der Handler NICHT erkennt: eine ERSTE Sicherung ohne Stand, die erst
 * nach dem Speichern des Rezepts ankommt. Sie ist von frischem Tippen nicht zu
 * unterscheiden und legt an. Vorgabe für den Editor: Sicherung und Speichern
 * sind nie gleichzeitig unterwegs.
 *
 * „Verwerfen" (DELETE) aus demselben Grund hier und nicht als Action: Der
 * Redakteur, der im Editor einen angebotenen Zwischenstand verwirft, hat oft
 * schon weitergetippt — eine Action rendert die Seite neu, und mit einer
 * abgelaufenen Sitzung wäre das Getippte weg. Der Editor wird selbst
 * entscheiden, ob er danach bleibt oder (nach dem Verwerfen eines
 * WIEDERHERGESTELLTEN Stands) auf den gespeicherten Stand wechselt.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import {
  STAND_FELD,
  formularAlsDaten,
  istLadbar,
  istZwischenstandSchluessel,
  schluesselAus,
  standAus,
  type VerwerfenAntwort,
  type ZwischenstandAntwort,
  type ZwischenstandDaten,
} from "@/lib/recipe-zwischenstand";
import { zwischenstandSichern, zwischenstandVerwerfen } from "@/lib/recipe-zwischenstand-store";
import { alsUhrzeit, alsZeitpunkt } from "@/lib/zeitpunkt";

export const dynamic = "force-dynamic";

function antwort(body: ZwischenstandAntwort | VerwerfenAntwort, status: number): NextResponse {
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
  // Was sich nicht laden ließe, ist ein Urteil über die Eingabe — hier gefällt,
  // nach derselben Regel wie in der Ablage. Die würfe sonst, und ihr Wurf
  // gälte als Störung.
  if (!istLadbar(formular)) return antwort({ fehler: "ungueltig" }, 400);

  let ergebnis: Awaited<ReturnType<typeof zwischenstandSichern>>;
  try {
    ergebnis = await zwischenstandSichern({
      schluessel,
      daten: formular,
      jetzt: new Date(),
      bekannterStand: standAus(standRoh?.[0]),
    });
  } catch (err) {
    // Genau EIN Fehler der Ablage ist ein Urteil über die Eingabe: das Rezept,
    // das es nicht (mehr) gibt — der Fremdschlüssel sagt nein. Jeder andere
    // ist eine Störung und wird geworfen (siehe Kopf). Nennt die Anfrage einen
    // Stand, kommt es nicht so weit: Ohne Zeile ist das Urteil schon „weg",
    // und erst die Folgesicherung ohne Stand trifft den Fremdschlüssel.
    if ((err as { code?: unknown }).code !== "SQLITE_CONSTRAINT_FOREIGNKEY") throw err;
    return antwort({ fehler: "ungueltig" }, 400);
  }
  if (ergebnis.ergebnis === "weg") return antwort({ fehler: "weg" }, 409);
  if (ergebnis.ergebnis === "fremd") {
    return antwort(
      { fehler: "fremd", zeit: alsZeitpunkt(ergebnis.gesichertAm), stand: ergebnis.stand },
      409,
    );
  }
  return antwort({ gesichert: alsUhrzeit(ergebnis.gesichertAm), stand: ergebnis.stand }, 200);
}

export async function DELETE(req: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(req)) return antwort({ fehler: "herkunft" }, 403);
  if (!(await getCurrentAdmin("admin-anfrage"))) return antwort({ fehler: "sitzung" }, 401);

  const daten = await formularAus(req);
  // Wer verwirft, schickt kein Formular des Editors, sondern nennt die Zeile
  // beim Namen. Nutzereingabe aus dem Browser: Nur eine der beiden Formen
  // löscht etwas.
  const schluessel = daten?.schluessel?.[0];
  if (!istZwischenstandSchluessel(schluessel)) return antwort({ fehler: "ungueltig" }, 400);

  // Verworfen wird nur, was der Redakteur gesehen hat: Der Editor schickt den
  // Stand mit. Trägt die Zeile einen anderen, hat ein anderer Tab inzwischen
  // gesichert — sie bleibt. Eine Störung der Ablage wird geworfen (siehe Kopf).
  // `standAus` ändert hier kein Urteil: Ein Text, der keine Kennung ist,
  // gleicht keinem Stand einer Zeile (die Tabelle prüft dessen Form). Es
  // bleibt trotzdem bei EINER Lesart des Feldes, hier wie beim Sichern.
  const ergebnis = await zwischenstandVerwerfen({
    schluessel,
    bekannterStand: standAus(daten?.[STAND_FELD]?.[0]),
  });
  if (ergebnis.ergebnis === "fremd") {
    return antwort(
      { fehler: "fremd", zeit: alsZeitpunkt(ergebnis.gesichertAm), stand: ergebnis.stand },
      409,
    );
  }
  return antwort({ verworfen: true }, 200);
}
