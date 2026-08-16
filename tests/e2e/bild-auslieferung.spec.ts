import { test, expect, type Browser } from "@playwright/test";

/**
 * Dynamische Bild-Auslieferungs-Guardrail (PageSpeed-Regression 07/2026,
 * „Bilder größer als nötig" / fixe w320-Thumbnails für ~85-px-Anzeigen).
 *
 * Design-robust, KEINE Markup-String-Anker: Für jede Kernseite und mehrere
 * Geräteklassen (Mobil DPR 2, Desktop DPR 1, Retina DPR 2) wird für JEDES
 * sichtbare Upload-Bild die vom Browser tatsächlich gewählte Variante
 * (currentSrc) gegen die GEMESSENE Renderbreite × DPR geprüft:
 *
 *  - Obergrenze: gewählt ≤ kleinste verfügbare Variante, die den Bedarf
 *    (+12 % Toleranz für Rundung/Randabzüge) deckt. Lügt ein sizes-Attribut
 *    nach einer Design-Änderung wieder nach oben (50vw für eine 548-px-Karte,
 *    100vw für ein 300-px-Foto), schlägt der Test von selbst an — egal wie
 *    die Änderung im Quelltext aussieht.
 *  - Untergrenze: gewählt ≥ 75 % des Bedarfs, außer es GIBT nichts Größeres
 *    (dann ist die größte verfügbare Variante korrekt). Fängt unter-
 *    deklarierte sizes (weiche Bilder) wie den alten 768px-Hero-Deckel.
 *
 * Chrome-Eigenheit eingerechnet: Für DIESELBE Bilddatei nutzt Chrome eine
 * bereits geladene GRÖSSERE Variante wieder (Slider-Hero und Rezept-Kachel
 * teilen sich das Seed-Bild). Der Übergrößen-Deckel eines Bildes ist darum
 * das Maximum der Deckel aller Vorkommen derselben Datei auf der Seite —
 * die Stelle mit dem größten legitimen Bedarf bleibt voll überwacht.
 *
 * Läuft komplett offline: der Seed erzeugt ECHTE Varianten über storeImage,
 * der Playwright-Server ist der Produktions-Build.
 */

const SEITEN = [
  "/",
  "/rezepte",
  "/reisen",
  "/reisen/streetfood-und-trattorien-in-sizilien",
  "/rezepte/linsen-bolognese-mit-vollkornnudeln",
  "/suche?q=pasta",
];

const KONTEXTE = [
  {
    // Schmales Telefon (iPhone SE, Galaxy S8). Bewusst DRIN, seit ein
    // `auto-fit`-Raster im Reisebericht unterhalb ~372 px auf eine Spalte
    // zurückfiel: Die Kachel wurde doppelt so breit wie das `sizes` behauptete,
    // der Browser lud die zu kleine Variante — sichtbar unscharf. Bei 390 px
    // war davon nichts zu sehen. Ein Layout, das erst unter einer bestimmten
    // Breite umschaltet, muss auch unter dieser Breite gemessen werden.
    name: "Schmales Telefon 360px @ DPR 3",
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
  },
  {
    name: "Mobil 390px @ DPR 2",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  },
  {
    name: "Desktop 1280px @ DPR 1",
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
  },
  {
    name: "Retina 1440px @ DPR 2",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: false,
  },
];

/** Toleranz auf den Pixel-Bedarf: Rundung, Scrollbar, kleine Randabzüge —
 *  bewusst UNTER dem kleinsten Leiter-Sprung (160→320), damit ein echter
 *  Stufen-Fehlgriff nie durchrutscht. */
const BEDARFS_TOLERANZ = 1.12;
/** Untergrenze gegen weiche Bilder (unterdeklariertes sizes). */
const SCHAERFE_MINIMUM = 0.75;

interface Messung {
  current: string;
  srcset: string;
  breite: number;
  /** 0 = Ladefehler (z. B. 404 einer srcset-Breite) — wird hart gemeldet. */
  naturalWidth: number;
}

function verfuegbareBreiten(m: Messung): number[] {
  const ws = [...m.srcset.matchAll(/\s(\d+)w\s*(?:,|$)/g)].map((x) =>
    Number(x[1]),
  );
  if (ws.length > 0) return ws.sort((a, b) => a - b);
  const einzel = /\/w(\d+)\.webp/.exec(m.current);
  return einzel ? [Number(einzel[1])] : [];
}

async function messeSeite(
  browser: Browser,
  kontext: (typeof KONTEXTE)[number],
  seite: string,
): Promise<Messung[]> {
  // Frischer Kontext je Seite: sonst bedient Chrome kleinere Slots aus dem
  // Cache einer VORHERIGEN Seite mit deren größerer Variante (falsch rot).
  // reducedMotion pausiert den Slider-Autowechsel (designgemäß): der tauscht
  // sonst alle ~6 s das Hero-<img> aus — auf langsamen CI-Runnern wird die
  // „alle Bilder fertig geladen"-Wartebedingung dann nie stabil wahr.
  // Gemessen wird die Variantenwahl, nicht die Bewegung.
  const context = await browser.newContext({
    viewport: kontext.viewport,
    deviceScaleFactor: kontext.deviceScaleFactor,
    isMobile: kontext.isMobile,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(seite, { waitUntil: "networkidle" });

  // Lazy-Timing raus aus der Messung: alle Bilder explizit eager laden.
  // Ob/wann ein Browser-Build Lazy-Loads anstößt, hängt von Build, Viewport
  // und Scroll-Margins ab (CI-Flake auf der Startseite) — die VARIANTENWAHL
  // (srcset/sizes/DPR) ist davon unabhängig, nur die messen wir.
  await page.evaluate(() => {
    for (const img of document.querySelectorAll("img")) img.loading = "eager";
  });
  // Alle Upload-Bilder müssen fertig geladen sein, bevor gemessen wird —
  // bei Timeout nennt die Assertion die hängenden Quellen (Diagnose).
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll("img"))
            .filter((i) => i.currentSrc.includes("/uploads/") && !i.complete)
            .map((i) => i.currentSrc),
        ),
      { timeout: 30_000 },
    )
    .toEqual([]);

  const daten = await page.evaluate(() =>
    Array.from(document.querySelectorAll("img"))
      .map((img) => ({
        current: img.currentSrc,
        srcset: img.getAttribute("srcset") ?? "",
        breite: img.getBoundingClientRect().width,
        naturalWidth: img.naturalWidth,
      }))
      .filter((d) => d.current.includes("/uploads/") && d.breite > 0),
  );
  await context.close();
  return daten;
}

test.describe("Bild-Auslieferung: gewählte Variante passt zur Rendergröße", () => {
  for (const kontext of KONTEXTE) {
    for (const seite of SEITEN) {
      test(`${seite} — ${kontext.name}`, async ({ browser }) => {
        const messungen = await messeSeite(browser, kontext, seite);
        // Jede Kernseite muss überhaupt Upload-Bilder zeigen — sonst prüft
        // der Test stillschweigend nichts mehr (fail-closed).
        expect(messungen.length, `${seite}: keine Upload-Bilder gefunden`)
          .toBeGreaterThan(0);

        const dpr = kontext.deviceScaleFactor;
        const eintraege = messungen.map((m) => {
          const gewaehlt = Number(/\/w(\d+)\.webp/.exec(m.current)?.[1] ?? 0);
          const leiter = verfuegbareBreiten(m);
          const bedarf = Math.ceil(m.breite * dpr);
          const deckende = leiter.filter(
            (w) => w >= bedarf * BEDARFS_TOLERANZ,
          );
          const deckel =
            deckende.length > 0 ? Math.min(...deckende) : Math.max(...leiter);
          const dateiKey = /\/uploads\/([^/]+)\//.exec(m.current)?.[1] ?? "";
          return { ...m, gewaehlt, leiter, bedarf, deckel, dateiKey };
        });

        // Chrome darf eine bereits geladene GRÖSSERE Variante derselben Datei
        // wiederverwenden → Deckel je Datei ist das Maximum ihrer Vorkommen.
        const deckelJeDatei = new Map<string, number>();
        for (const e of eintraege) {
          deckelJeDatei.set(
            e.dateiKey,
            Math.max(deckelJeDatei.get(e.dateiKey) ?? 0, e.deckel),
          );
        }

        for (const e of eintraege) {
          const erlaubt = deckelJeDatei.get(e.dateiKey)!;
          const info = `${seite} · ${e.current} · gerendert ${Math.round(
            e.breite,
          )}px × DPR ${dpr} = Bedarf ${e.bedarf}px · Leiter [${e.leiter.join(
            ", ",
          )}]`;
          // Ladefehler (z. B. eine srcset-Breite, die die Route 404t) dürfen
          // nie als „klein genug" durchrutschen — kaputt ist kaputt.
          expect(e.naturalWidth, `LÄDT NICHT (404/defekt?): ${info}`)
            .toBeGreaterThan(0);
          // Obergrenze: keine Variante größer als der größte legitime Bedarf
          // dieser Datei (+ Toleranz) — fängt jede künftige sizes-Lüge.
          expect(e.gewaehlt, `ZU GROSS: ${info}`).toBeLessThanOrEqual(erlaubt);
          // Untergrenze: nicht sichtbar weich — außer es gibt nichts Größeres.
          if (e.gewaehlt < e.bedarf * SCHAERFE_MINIMUM) {
            expect(e.gewaehlt, `ZU KLEIN (weich): ${info}`).toBe(
              Math.max(...e.leiter),
            );
          }
        }
      });
    }
  }
});

/**
 * Auslieferungs-Budget: Wie viel Pixelfläche wird ÜBER den Bedarf hinaus
 * geliefert — über alle Seiten und Geräteklassen zusammen?
 *
 * Die Prüfungen oben arbeiten je Bild und fragen: „passt die gewählte Stufe
 * zur Rendergröße?" Sie sind gegen Fehlgriffe robust, sagen aber nichts über
 * die LEITER selbst. Eine Leiter mit nur zwei Stufen (160, 1920) bestünde
 * jede einzelne Prüfung — 1920 ist dann schlicht „die kleinste deckende
 * Stufe" — und lieferte trotzdem systematisch das Vielfache.
 *
 * Genau diese Lücke schließt dieser Test. Er misst, was die Leiter im
 * Zusammenspiel mit den echten Layouts kostet, und macht eine Leiter-Änderung
 * belegpflichtig statt begründungspflichtig.
 *
 * NUR ÜBERGRÖSSE, KEINE NETTOBILANZ. Die erste Fassung summierte geliefert
 * gegen gebraucht und bildete die Differenz — dabei hoben sich zu große
 * Thumbnails und gedeckelte Großbilder gegenseitig auf: Gemessen kam −4,3 %
 * heraus, obwohl 18,5 % Übergröße im Spiel waren. Ein Budget, das sich durch
 * UNTERlieferung erfüllen lässt, misst das Falsche. Unterlieferung ist Sache
 * der SCHAERFE_MINIMUM-Prüfung oben; hier zählt ausschließlich, was zu viel
 * war.
 *
 * Warum Pixelfläche und nicht Bytes: Ein Byte-Budget bräuchte ein festes
 * Referenzbild. Auf einem synthetisch erzeugten Bild steigen die Bytes pro
 * Pixel mit der Breite (gemessen 0,083 bei w160 auf 0,149 bei w1920), weil
 * eingestreutes Rauschen beim Verkleinern verschwindet, beim Vergrößern aber
 * nicht — eine daran kalibrierte Grenze sagt über echte Fotos nichts. An
 * echten Fotos kalibriert bräche sie bei jedem libwebp-Sprung und lüde zum
 * Lockern ein. Pixelfläche ist encoder-unabhängig und misst genau das, was
 * die Leiter beeinflusst. Die Kompression selbst bewacht das relative Budget
 * in tests/media-regeneration.integration.test.ts.
 */
/** Gemessen: alte Leiter 26,6 %, mit der Stufe 1152 noch 18,5 %. Der Deckel
 *  liegt dazwischen — wer 1152 wieder entfernt, wird rot. */
const UEBERGROESSE_DECKEL = 0.22;

test.describe("Bild-Auslieferung: Budget über alle Seiten", () => {
  test("die Leiter liefert nicht systematisch zu groß aus", async ({
    browser,
  }) => {
    let zuviel = 0;
    let gebraucht = 0;
    let bilder = 0;
    const schlimmste: Array<{ faktor: number; info: string }> = [];

    for (const kontext of KONTEXTE) {
      for (const seite of SEITEN) {
        for (const m of await messeSeite(browser, kontext, seite)) {
          const gewaehlt = Number(/\/w(\d+)\.webp/.exec(m.current)?.[1] ?? 0);
          const bedarf = Math.ceil(m.breite * kontext.deviceScaleFactor);
          if (!gewaehlt || !bedarf) continue;
          // Fläche statt Breite: Bytes hängen an der Fläche, ein
          // Breitenvergleich unterschätzte den Aufwand quadratisch.
          zuviel += Math.max(0, gewaehlt * gewaehlt - bedarf * bedarf);
          gebraucht += bedarf * bedarf;
          bilder++;
          schlimmste.push({
            faktor: (gewaehlt * gewaehlt) / (bedarf * bedarf),
            info: `${seite} · ${kontext.name} · Bedarf ${bedarf}px → w${gewaehlt}`,
          });
        }
      }
    }

    // Fail-closed: ohne Messwerte prüft der Test nichts.
    expect(bilder, "keine Upload-Bilder gemessen").toBeGreaterThan(50);

    const uebergroesse = zuviel / gebraucht;
    schlimmste.sort((a, b) => b.faktor - a.faktor);
    const bericht = schlimmste
      .slice(0, 8)
      .map((s) => `  ×${s.faktor.toFixed(2)}  ${s.info}`)
      .join("\n");

    expect(
      uebergroesse,
      `Übergröße ${(uebergroesse * 100).toFixed(1)} % über ${bilder} Bilder ` +
        `(Deckel ${(UEBERGROESSE_DECKEL * 100).toFixed(0)} %).\n` +
        `Größte Einzelabweichungen:\n${bericht}`,
    ).toBeLessThanOrEqual(UEBERGROESSE_DECKEL);
  });
});
