import { test, expect } from "@playwright/test";

/**
 * Cross-Origin-Embedder-Policy: gesetzt UND folgenlos für die eigene Seite.
 *
 * ANLASS: Der wöchentliche DAST-Lauf meldete `Cross-Origin-Embedder-Policy
 * Header Missing or Invalid` (ZAP-Regel 90004, Issue #75). Von den neun
 * Warnungen jenes Laufs war das die einzige mit einer sachlichen Lücke — die
 * übrigen waren informativ oder ratifizierte Entscheidungen (unsafe-inline in
 * der CSP: B20; Origin-Prüfung statt CSRF-Token: B8).
 *
 * WARUM DIESE PRÜFUNG MEHR TUT ALS DEN HEADER ZU LESEN: `require-corp` ist
 * kein Etikett, sondern eine Sperre. Der Browser weigert sich damit, fremde
 * Ressourcen zu laden, die sich nicht per Cross-Origin-Resource-Policy dazu
 * bekennen — und er tut das STILL, in der Konsole. Ein Test, der nur den
 * Header abfragt, wäre auch dann grün, wenn die Seite dahinter halb leer bleibt.
 *
 * Geprüft wird deshalb beides: der Header ist da, und keine Ressource der Seite
 * scheitert an ihm. Die Reiseseite ist bewusst dabei, weil dort die
 * Leaflet-Karte, die Galerie und die Schriften zusammenkommen — die Stellen,
 * an denen eine Fremdressource am ehesten auftauchen würde.
 *
 * NICHT gezählt werden `ERR_ABORTED`. Das sind die Vorabrufe des Next-Routers
 * (`?_rsc=…`), die beim Weiternavigieren abgebrochen werden — sie haben mit
 * COEP nichts zu tun. Gemessen, statt vermutet, je drei Läufe über die drei
 * Seiten:
 *
 *   mit COEP    22 / 26 / 31 Abbrüche, sonstige Fehlschläge 0
 *   ohne COEP   20 / 23 / 25 Abbrüche, sonstige Fehlschläge 0
 *
 * Die Streuung überlappt, und entscheidend ist die zweite Spalte: In keinem
 * Lauf beider Varianten gab es einen Fehlschlag, der KEIN Abbruch war. Genau so
 * einer wäre eine COEP-Blockade — Chrome quittiert sie mit
 * ERR_BLOCKED_BY_RESPONSE.
 *
 * EHRLICH DAZUGESAGT, was dieser Header hier leistet: wenig. Die CSP oben
 * erlaubt ausschließlich 'self' und data:, verbietet also fremde
 * Unterressourcen bereits vollständig. COEP ist dieselbe Absicht auf einer
 * zweiten Ebene — Tiefenverteidigung, kein neu geschlossenes Loch. Deshalb
 * lässt sich seine Wirkung hier auch nicht positiv nachweisen: Ein Versuch,
 * eine fremde Ressource zu laden, scheitert schon an der CSP, bevor COEP
 * gefragt wird.
 */
const SEITEN = ["/", "/rezepte", "/reisen"];

test.describe("Sicherheits-Header", () => {
  for (const seite of SEITEN) {
    test(`${seite} trägt COEP und lädt dabei vollständig`, async ({ page }) => {
      const gescheitert: string[] = [];
      const konsolenfehler: string[] = [];

      page.on("requestfailed", (anfrage) => {
        const grund = anfrage.failure()?.errorText ?? "unbekannt";
        // Abgebrochene Vorabrufe des Routers sind normal (siehe Kopf).
        if (grund.includes("ERR_ABORTED")) return;
        gescheitert.push(`${anfrage.url()} — ${grund}`);
      });
      page.on("console", (nachricht) => {
        if (nachricht.type() === "error") konsolenfehler.push(nachricht.text());
      });

      const antwort = await page.goto(seite, { waitUntil: "networkidle" });
      expect(antwort, `keine Antwort für ${seite}`).not.toBeNull();

      expect(
        antwort!.headers()["cross-origin-embedder-policy"],
        `COEP fehlt auf ${seite}`,
      ).toBe("require-corp");

      // Der eigentliche Punkt: Die Sperre darf nichts Eigenes treffen. Ein
      // Fehlschlag, der kein Abbruch ist, wäre genau das.
      expect(
        gescheitert,
        `Ressourcen scheiterten (kein Abbruch):\n${gescheitert.join("\n")}`,
      ).toEqual([]);

      // ERR_BLOCKED_BY_RESPONSE ist die Meldung, mit der Chrome eine an COEP
      // gescheiterte Einbettung quittiert. Sie darf nirgends auftauchen.
      const coepFehler = konsolenfehler.filter((z) =>
        /blocked|CORP|Cross-Origin-Embedder|ERR_BLOCKED_BY_RESPONSE/i.test(z),
      );
      expect(
        coepFehler,
        `COEP-Meldungen in der Konsole:\n${coepFehler.join("\n")}`,
      ).toEqual([]);
    });
  }

  test("auch Assets tragen den Header", async ({ request, baseURL }) => {
    // Die Sperre wirkt über das Dokument; die Assets müssen sie nicht tragen,
    // um zu laden. Dass sie es hier trotzdem tun, ist Folge der `/:path*`-Regel
    // in next.config.ts — und genau das soll so bleiben: Eine Regel, die nur
    // HTML-Seiten trifft, wäre beim nächsten Umbau leicht zu übersehen.
    const seite = await request.get(`${baseURL}/`);
    const treffer = /\/_next\/static\/[^"']+\.(?:js|css)/.exec(await seite.text());
    expect(treffer, "kein statisches Asset in der Seite gefunden").not.toBeNull();

    const asset = await request.get(`${baseURL}${treffer![0]}`);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
  });
});
