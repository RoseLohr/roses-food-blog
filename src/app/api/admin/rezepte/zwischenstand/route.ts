/**
 * Der Zwischenstand aus dem Rezept-Editor, alle drei Minuten (10/2026).
 *
 * Ein ROUTE-HANDLER, keine Server-Action — und das ist der Kern: Nach einer
 * Server-Action rendert Next die Seite neu, und das geschützte Layout ruft
 * `requireAdmin()`. Ist die Sitzung abgelaufen, leitet das zum Login um, und
 * Next trägt diesen Redirect als Antwort der Action aus: Der Browser verließ
 * den Editor samt Inhalt, ausgelöst von einem Timer — genau das, was der
 * Zwischenstand verhindern soll. Der erste Anlauf als Action endete deshalb
 * auf der Anmeldemaske (tests/e2e/rezept-zwischenstand.spec.ts, „läuft die
 * Sitzung ab"). Ein Route-Handler rendert nichts; eine abgelaufene Sitzung
 * ist hier eine Antwort (401, `fehler: "sitzung"`), die der Editor anzeigt,
 * und der Inhalt bleibt stehen.
 *
 * Unter /api/admin läuft die Anfrage durch den Proxy: Das Cookie gleitet mit,
 * und `getCurrentAdmin("admin-anfrage")` lässt die Zeile gleiten — dieselben
 * Auslöser für beide Hälften (src/lib/sitzung.ts). Same-Origin wie jeder
 * eigene POST-Handler (src/lib/csrf.ts, Annahme B8).
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/csrf";
import {
  STAND_FELD,
  formularAlsDaten,
  schluesselAus,
  type ZwischenstandAntwort,
  type ZwischenstandDaten,
} from "@/lib/recipe-zwischenstand";
import { zwischenstandSichern } from "@/lib/recipe-zwischenstand-store";
import { alsUhrzeit } from "@/lib/zeitpunkt";

export const dynamic = "force-dynamic";

function antwort(body: ZwischenstandAntwort, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!(await getCurrentAdmin("admin-anfrage"))) return antwort({ fehler: "sitzung" }, 401);

  let daten: ZwischenstandDaten;
  try {
    daten = formularAlsDaten(await req.formData());
  } catch (err) {
    // Kein Formular im Körper — der Editor schickt immer eines.
    console.error("[zwischenstand] Körper ist kein Formular:", err);
    return antwort({ fehler: "ungueltig" }, 400);
  }
  const schluessel = schluesselAus(daten);
  if (!schluessel) return antwort({ fehler: "ungueltig" }, 400);

  // Der bekannte Stand ist Steuerinformation des Editors, kein Formularfeld —
  // er gehört nicht in den Zwischenstand (sonst änderte jede Sicherung den
  // Fingerabdruck und die nächste käme ohne Änderung).
  const { [STAND_FELD]: standRoh, ...formular } = daten;
  const bekannterStand = Number(standRoh?.[0] ?? 0) || 0;
  const recipeId = schluessel.startsWith("rezept:") ? Number(schluessel.slice("rezept:".length)) : null;

  let ergebnis: Awaited<ReturnType<typeof zwischenstandSichern>>;
  try {
    ergebnis = await zwischenstandSichern({
      schluessel,
      recipeId,
      daten: formular,
      jetzt: new Date(),
      bekannterStand,
    });
  } catch (err) {
    // Z. B. ein Rezept, das es nicht (mehr) gibt — der Fremdschlüssel sagt
    // nein. Sichtbar melden, nicht werfen: Der Editor soll stehen bleiben.
    console.error("[zwischenstand] Sichern fehlgeschlagen:", err);
    return antwort({ fehler: "ungueltig" }, 400);
  }
  if (ergebnis.ergebnis === "fremd") {
    return antwort(
      { fehler: "fremd", zeit: alsUhrzeit(ergebnis.gespeichertAm), stand: ergebnis.gespeichertAm.getTime() },
      409,
    );
  }
  return antwort({ gesichert: alsUhrzeit(ergebnis.gespeichertAm), stand: ergebnis.gespeichertAm.getTime() }, 200);
}
