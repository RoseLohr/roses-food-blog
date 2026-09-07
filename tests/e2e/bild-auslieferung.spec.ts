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
  /** Für die Flächengewichtung im Budget: echtes Seitenverhältnis der Datei. */
  naturalHeight: number;
  /** Das `sizes`-Attribut, roh (null = keins). Die deklarierte Breite unten
   *  ist daraus abgeleitet; im Bericht steht es zur Diagnose. */
  sizes: string | null;
  /**
   * Die Breite, die `sizes` dem Browser FÜR DIESES Vorkommen erklärt — in
   * CSS-Pixeln, aufgelöst wie der Browser es tut (erste zutreffende
   * Medienbedingung, Längen inkl. vw/calc über ein Messelement). Ohne
   * `sizes` gilt 100vw. Gegen `breite` gehalten ist das die direkte Prüfung
   * auf eine sizes-Lüge — je Vorkommen, unabhängig davon, ob die Datei auf
   * der Seite noch woanders steht (Veto des Fremd-Vendor-Panels auf PR #143).
   */
  deklariert: number;
  /** dito: die Klassen des Bildes und seines Elternelements. */
  klassen: string;
}

function verfuegbareBreiten(m: Messung): number[] {
  const ws = [...m.srcset.matchAll(/\s(\d+)w\s*(?:,|$)/g)].map((x) =>
    Number(x[1]),
  );
  if (ws.length > 0) return ws.sort((a, b) => a - b);
  const einzel = /\/w(\d+)\.webp/.exec(m.current);
  return einzel ? [Number(einzel[1])] : [];
}

/**
 * Die kleinste Leiterstufe, die einen Bedarf deckt — oder `undefined`, wenn
 * die Leiter dafür nichts hat. Das ist die Stufe, die der Browser für dieses
 * Vorkommen wählt, solange er nichts aus dem Cache wiederverwendet.
 *
 * EINE Funktion für beide Prüfungen unten. Die Einzelbild-Prüfung leitet
 * daraus ihren Deckel ab (mit Toleranz), das Budget seinen Leitersprung
 * (ohne). Vorher verbuchte das Budget die tatsächlich GEZEIGTE Variante und
 * damit Chromes Wiederverwendung — daran ist B28 entstanden.
 */
function leiterstufe(leiter: number[], bedarf: number): number | undefined {
  const deckende = leiter.filter((w) => w >= bedarf);
  return deckende.length > 0 ? Math.min(...deckende) : undefined;
}

/** Was eine Datei `/uploads/<key>/w<Breite>.webp` eindeutig macht. */
function dateiSchluessel(current: string): string {
  return /\/uploads\/([^/]+)\//.exec(current)?.[1] ?? "";
}

/**
 * Liest ein `sizes`-Attribut so, wie der Browser es liest, und gibt die
 * Breite in CSS-Pixeln zurück, die es DIESEM Viewport erklärt: Einträge an
 * Kommas getrennt, je Eintrag „Medienbedingung Länge", die erste zutreffende
 * Bedingung gewinnt, ein Eintrag ohne Bedingung ist der Rückfall, ohne
 * `sizes` gilt 100vw. Die Länge (px, vw, calc, …) löst ein Messelement auf —
 * kein eigener Parser für CSS-Längen.
 *
 * Bedingung und Länge trennt die letzte Lücke auf Klammertiefe 0. Ein Regex
 * wie /^(\(.*\))\s+(.*)$/ scheitert an
 * `(max-width: 767px) calc((100vw - 5rem) * 1)`: Das gierige `.*` frisst bis
 * in die verschachtelte Klammer, die Bedingung wird ungültig, `matchMedia`
 * sagt nein, und der Rückfall greift — die erste Messung hat genau das als
 * „sizes-Lüge" gemeldet. Deshalb steht diese Funktion für sich und hat unten
 * einen eigenen Test mit Fixtures.
 *
 * LÄUFT IM BROWSER (page.evaluate). Keine Bezüge nach außen — Playwright
 * serialisiert nur die Funktion selbst.
 */
function deklarierteBreiteImBrowser(sizes: string | null): number {
  const laengeInPx = (l: string): number => {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;visibility:hidden;height:0;width:${l}`;
    document.body.appendChild(d);
    const w = d.getBoundingClientRect().width;
    d.remove();
    return w;
  };
  const trenne = (eintrag: string): [string | null, string] => {
    let tiefe = 0;
    let schnitt = -1;
    for (let i = 0; i < eintrag.length; i++) {
      const c = eintrag[i];
      if (c === "(") tiefe++;
      else if (c === ")") tiefe--;
      else if (tiefe === 0 && /\s/.test(c)) schnitt = i;
    }
    if (schnitt < 0) return [null, eintrag];
    return [eintrag.slice(0, schnitt).trim(), eintrag.slice(schnitt + 1).trim()];
  };
  if (!sizes) return window.innerWidth;
  for (const eintrag of sizes.split(",").map((e) => e.trim()).filter(Boolean)) {
    const [bedingung, laenge] = trenne(eintrag);
    if (bedingung === null) return laengeInPx(laenge);
    if (window.matchMedia(bedingung).matches) return laengeInPx(laenge);
  }
  return window.innerWidth;
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

  // ── UND DIE SEITE MUSS ZUR RUHE GEKOMMEN SEIN (B2) ────────────────────────
  //
  // „Alle geladen" heißt nicht „alle da". Gemessen wurden je Lauf
  // unterschiedlich viele Bilder — 141, 143, 150 über drei Läufe. Bilder
  // kommen nach der Hydration noch dazu (Galerie-Streifen, Slider-Folien), und
  // ein Bild, dessen Layout noch nicht steht, hat Breite 0 und fällt aus der
  // Messung. Die Grundgesamtheit hing damit am Zeitpunkt.
  //
  // Deshalb: warten, bis die ANZAHL messbarer Upload-Bilder über mehrere
  // Stichproben gleich bleibt. Kein festes `waitForTimeout` — das wäre wieder
  // eine Wette auf die Maschine.
  const zaehle = () =>
    page.evaluate(
      () =>
        Array.from(document.querySelectorAll("img")).filter(
          (i) =>
            i.currentSrc.includes("/uploads/") &&
            i.getBoundingClientRect().width > 0,
        ).length,
    );
  let ruhig = 0;
  let letzte = -1;
  const bis = Date.now() + 15_000;
  while (ruhig < 3 && Date.now() < bis) {
    const jetzt = await zaehle();
    ruhig = jetzt === letzte ? ruhig + 1 : 0;
    letzte = jetzt;
    if (ruhig < 3) await page.waitForTimeout(150);
  }
  expect(
    ruhig,
    `${seite} (${kontext.name}): Zahl der messbaren Bilder kam nicht zur Ruhe ` +
      `(zuletzt ${letzte}). Ohne feste Grundgesamtheit ist das Budget nicht ` +
      `vergleichbar.`,
  ).toBeGreaterThanOrEqual(3);

  const roh = await page.evaluate(() =>
    Array.from(document.querySelectorAll("img"))
      .map((img) => ({
        current: img.currentSrc,
        srcset: img.getAttribute("srcset") ?? "",
        breite: img.getBoundingClientRect().width,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        // Diagnose: Ein Ausreißer ist fast immer ein `sizes`, das für DIESE
        // Stelle nicht stimmt. Ohne die Angabe muss man sie im Quelltext
        // suchen — und die Klassen sagen einem, WO man suchen muss.
        sizes: img.getAttribute("sizes"),
        klassen:
          `${img.className || "—"}` +
          (img.parentElement ? ` | Eltern: ${img.parentElement.className || "—"}` : ""),
      }))
      .filter((d) => d.current.includes("/uploads/") && d.breite > 0),
  );
  // Die deklarierte Breite je EINDEUTIGEM sizes-String — im Browser, mit
  // derselben Funktion, die unten gegen Fixtures geprüft wird.
  const deklariertJeSizes = new Map<string | null, number>();
  for (const sizes of new Set(roh.map((d) => d.sizes))) {
    deklariertJeSizes.set(
      sizes,
      await page.evaluate(deklarierteBreiteImBrowser, sizes),
    );
  }
  // Nichts wird abgestreift: jedes Feld der Messung bleibt, `deklariert`
  // kommt dazu.
  const daten: Messung[] = roh.map((d) => ({
    ...d,
    deklariert: deklariertJeSizes.get(d.sizes)!,
  }));
  await context.close();
  return daten;
}

test.describe("sizes-Auswertung: erklärt, was der Browser liest", () => {
  // Fixtures: [sizes, Breite bei 360 px, Breite bei 1440 px]. Der erste ist
  // das echte sizes des Reiseberichts — mit calc() IN der Medienbedingung,
  // woran der frühere Regex scheiterte. Der letzte ist eine Lüge: 2000 px
  // erklärt für ein Bild, das nie so breit ist — die Prüfung unten MUSS sie
  // als „zu groß" lesen, sonst prüft sie nichts (fail-closed).
  const FIXTURES: Array<[string | null, number, number]> = [
    ["(max-width: 767px) calc((100vw - 5rem - 0px) * 1), (max-width: 928px) calc((100vw - 7rem - 0px) * 1), 816px", 280, 816],
    ["(max-width: 640px) 22vw, 208px", 79.2, 208],
    ["(min-width: 1000px) and (max-width: 2000px) 500px, 100px", 100, 500],
    ["100vw", 360, 1440],
    [null, 360, 1440],
    ["2000px", 2000, 2000],
  ];
  for (const [breite, spalte] of [[360, 1], [1440, 2]] as const) {
    test(`bei ${breite} px Viewport`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: breite, height: 800 } });
      const page = await context.newPage();
      await page.goto("/");
      for (const fixture of FIXTURES) {
        const erwartet = fixture[spalte];
        const gelesen = await page.evaluate(deklarierteBreiteImBrowser, fixture[0]);
        expect(gelesen, `sizes=${JSON.stringify(fixture[0])} bei ${breite}px`).toBeCloseTo(erwartet, 0);
      }
      // Die Lüge muss über der Toleranz liegen, sonst wäre die Prüfung stumm.
      const luege = await page.evaluate(deklarierteBreiteImBrowser, "2000px");
      expect(luege).toBeGreaterThan(300 * BEDARFS_TOLERANZ);
      await context.close();
    });
  }
});

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
          const deckel =
            leiterstufe(leiter, bedarf * BEDARFS_TOLERANZ) ?? Math.max(...leiter);
          const dateiKey = dateiSchluessel(m.current);
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
          // dieser Datei (+ Toleranz). Die Zulage je Datei ist nötig, weil
          // Chrome wiederverwendet — sie ließe aber eine sizes-Lüge an einem
          // Nebenvorkommen einer GETEILTEN Datei durch. Deshalb prüft
          // „SIZES ZU GROSS" unten die Erklärung selbst, je Vorkommen.
          expect(e.gewaehlt, `ZU GROSS: ${info}`).toBeLessThanOrEqual(erlaubt);
          // sizes-Lüge, DIREKT und je Vorkommen: Was `sizes` dem Browser
          // erklärt, darf die gerenderte Breite nicht um mehr als die
          // Toleranz übersteigen. Das braucht keine Zulage je Datei — es
          // vergleicht nicht die gewählte Variante, sondern die Erklärung mit
          // der Wirklichkeit. Damit fängt es auch die Lüge an einem
          // Nebenvorkommen einer geteilten Datei, die sich hinter dem
          // Maximum-Deckel oben verstecken könnte (Veto SOTA-A, PR #143).
          expect(
            e.deklariert,
            `SIZES ZU GROSS: ${info} · sizes erklärt ${Math.round(e.deklariert)}px ` +
              `CSS für ${Math.round(e.breite)}px gerendert (sizes=${e.sizes === null ? "keins" : `"${e.sizes}"`})`,
          ).toBeLessThanOrEqual(e.breite * BEDARFS_TOLERANZ);
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
 * Auslieferungs-Budget: Wie viel Pixelfläche gibt die LEITER über den Bedarf
 * hinaus her — je Vorkommen die kleinste deckende Stufe, unabhängig davon,
 * was Chrome durch Wiederverwendung tatsächlich zeigt — über alle Seiten und
 * Geräteklassen zusammen?
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
 * NUR ÜBERGRÖSSE, UND NUR ÜBER DIE ÜBERGROSSEN BILDER. Zwei Anläufe waren
 * vorher nötig, beide mit demselben Fehler in unterschiedlicher Verkleidung
 * (der zweite gefunden von gpt-5.6-sol, Cross-Vendor-Veto auf PR #71):
 *
 *  1. Erst summierte der Test geliefert gegen gebraucht und bildete die
 *     Differenz. Zu große Thumbnails und gedeckelte Großbilder hoben sich auf:
 *     gemessen −4,3 %, obwohl 18,5 % Übergröße im Spiel waren.
 *  2. Dann zählte der ZÄHLER nur noch Übergröße, der NENNER aber weiterhin
 *     ALLE Bilder. Damit senkte jedes zusätzliche oder größere unterlieferte
 *     Bild die Quote — das Budget blieb also durch UNTERlieferung erfüllbar,
 *     obwohl genau hier das Gegenteil behauptet stand.
 *
 * Jetzt gehen Vorkommen, für die die Leiter KEINE deckende Stufe hat (Bedarf
 * über dem Leiterende, `stufe === undefined`), in KEINE der beiden Summen ein:
 * Ihr Fehlbetrag ist kein Leitersprung. Ob sie sichtbar weich sind, prüft
 * SCHAERFE_MINIMUM oben; wer sie hier mitzählte, könnte das eine Problem mit
 * dem anderen bezahlen. Seit je Vorkommen der Leitersprung verbucht wird
 * (09/2026, B28), ist jeder Summand ≥ 0 — das Budget ist durch Unterlieferung
 * nicht mehr erfüllbar.
 *
 * ECHTE FLÄCHE, NICHT BREITE ZUM QUADRAT. Ebenfalls Sol-Befund: w² gewichtet
 * ein quadratisches Thumbnail und ein 16:9-Bild gleicher Breite gleich, obwohl
 * ihre Flächen um den Faktor des Seitenverhältnisses auseinanderliegen. Beide
 * Summen tragen deshalb das gemessene Seitenverhältnis der Datei
 * (naturalHeight/naturalWidth). Am Verhältnis eines EINZELNEN Bildes ändert
 * das nichts — an seinem GEWICHT in der Summe sehr wohl.
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
/**
 * Gemessen mit der korrigierten Metrik (noch mit der Vorkommens-Rechnung, siehe
 * unten): alte Leiter 41,2 %, mit der Stufe 1152 noch 28,8 % (damals 101
 * gewertete Bilder). Die 1152-Gegenprobe ist mit der Leitersprung-Rechnung
 * nicht wiederholt; im ruhigen Lauf liefern beide Rechnungen dieselbe Zahl.
 *
 * STAND 08/2026, nach der Stabilisierung der Grundgesamtheit (B2):
 *
 *     Übergröße 30,0 % · 150 gewertet · 18 unterliefert
 *
 * und zwar in VIER Läufen hintereinander identisch — vorher schwankte allein
 * die Zahl der gemessenen Bilder zwischen 141 und 150, weil gemessen wurde,
 * bevor die Seite zur Ruhe gekommen war. Die Quote selbst war davon kaum
 * berührt (30,0–30,1 %); die Flatterhaftigkeit saß in der Grundgesamtheit.
 *
 * ── RICHTIGSTELLUNG 09/2026 (B28) ────────────────────────────────────────────
 *
 * Der Stand darüber ist überholt, und wer ihn liest, sucht an der falschen
 * Stelle. Gemessen wurde mit der Vorkommens-Rechnung (bis 09/2026):
 *
 *     Übergröße 28,9 % · 141 gewertet · 15 unterliefert
 *
 * Die 141 sind KEIN Rückfall hinter B2. Sie standen in ELF Läufen hintereinander
 * unverändert da — isoliert, im vollen Verbund und auf beiden Seiten eines
 * Vergleichs. Die Grundgesamtheit ist also stabil; sie ist nur kleiner
 * geworden, weil seither Bilder von den gemessenen Seiten verschwunden sind
 * (u. a. die entfernte Reise-Galerie). Wer 141 als Symptom von „zu früh
 * gemessen" liest — so stand es bis hierher —, sucht ein Problem, das an
 * dieser Stelle nicht mehr ist.
 *
 * DER AUSSCHLAG IST GEFANGEN — und zwar von der Aufschlüsselung, die dieser
 * Test seit 09/2026 JE SEITE UND GERÄTEKLASSE ausgibt. Sie war dafür gebaut,
 * und sie hat beim ERSTEN Ausschlag geliefert (CI-Lauf 33966135791, 05.09.):
 *
 *     Stelle                              örtlich    im Ausschlag
 *     / — Retina 1440px @ DPR 2  (n=12)     51,5 %       193,5 %
 *     /suche?q=pasta — Desktop   (n= 1)    525,0 %       525,0 %
 *     /rezepte — Desktop         (n= 4)     79,8 %        79,8 %
 *
 * Der gesamte Sprung (28,9 → 35,6 % gesamt) sitzt in EINER Zelle; alles
 * andere steht still. Das ist keine allgemeine Flatterhaftigkeit, sondern
 * ein Ort.
 *
 * DIE URSACHE, nachgemessen am laufenden Browser: Auf `/` erscheint EINE
 * Bilddatei VIERMAL — einmal als Slider-Bühne (Bedarf 2880 px, bekommt mit
 * w1280 das Leiterende) und dreimal klein (Bedarf 408 bzw. 512 px). Der Seed
 * setzt in den Slider die Hero-Bilder der ersten drei Rezepte, und dieselben
 * Rezepte stehen darunter als Kacheln — in einem Food-Blog die normale Lage,
 * keine Seed-Marotte.
 *
 *     Datei 9427dcb2  Vorkommen=4  maxBedarf=2880
 *         bedarf=2880  gewaehlt=w1280      (die Bühne)
 *         bedarf= 408  gewaehlt=w480
 *         bedarf= 512  gewaehlt=w640
 *         bedarf= 512  gewaehlt=w640
 *
 * Lädt unter Last die Bühne zuerst, verwendet Chrome deren w1280 für die drei
 * kleinen Vorkommen mit — genau die drei größten Abweichungen des Ausschlags
 * (×9,84 bei Bedarf 408, zweimal ×6,25 bei Bedarf 512).
 *
 * BIS 09/2026 MASS DIESE SUMME DAS FALSCHE. Die Einzelbild-Prüfung oben
 * rechnet die Wiederverwendung ausdrücklich heraus (`deckelJeDatei`: Deckel je
 * Datei = Maximum ihrer Vorkommen); die Summe tat es nicht — sie verbuchte
 * jedes Vorkommen mit der tatsächlich GEZEIGTEN Variante gegen seinen eigenen
 * Bedarf. Deshalb blieben im Ausschlag 260 Tests grün, darunter `/` bei Retina
 * 1440 selbst, und nur die Quote riss: zwei Rechnungen über dieselbe Tatsache,
 * in derselben Datei.
 *
 * Verbucht wird dabei ausgerechnet der GÜNSTIGERE Ausgang. Ohne
 * Wiederverwendung lädt die Datei drei Varianten (w1280, w480, w640), mit
 * Wiederverwendung eine einzige — weniger Bytes, schlechtere Quote.
 *
 * ENTSCHIEDEN 09/2026 (B28, Entscheidung des Eigentümers): Die Summe verbucht
 * je Vorkommen den LEITERSPRUNG — die kleinste Leiterstufe ≥ Bedarf, also das,
 * was der Browser ohne Wiederverwendung wählt (`leiterstufe`, dieselbe
 * Funktion, aus der die Einzelbild-Prüfung ihren Deckel ableitet). Die
 * Rechnung hängt damit allein an Leiter und Layout; welches Vorkommen ein
 * Laderennen gewinnt, kann sie nicht mehr bewegen.
 *
 * Preis: Eine sizes-Lüge fällt in der SUMME nicht mehr auf — die Summe sieht
 * `sizes` gar nicht. Sie ist Sache der Einzelbild-Prüfung oben. Deren Zulage
 * je Datei hätte eine Lüge an einem Nebenvorkommen einer geteilten Datei
 * durchgelassen — das Fremd-Vendor-Panel hat genau daran refutiert (PR #143),
 * zu Recht. Seitdem prüft „SIZES ZU GROSS" die Erklärung selbst, je
 * Vorkommen, mit `deklarierteBreiteImBrowser`. Verworfen: je DATEI statt je
 * Vorkommen rechnen — näher an den Bytes, aber es ändert die Grundgesamtheit
 * und macht jede bisherige Zahl unvergleichbar.
 *
 * MESSREIHE MIT DER LEITERSPRUNG-RECHNUNG (06./07.09.2026, Chromium 141):
 *
 *     isoliert (--no-deps):            28,9 % · 141 gewertet · 15 über Leiterende
 *     voller Verbund, alle Arbeiter:   28,9 % · 28,9 % · 28,9 % · 141 · 15
 *
 * Im ruhigen Lauf ist das dieselbe Zahl wie mit der alten Rechnung — ohne
 * Wiederverwendung IST die Leiterstufe die gezeigte Variante. Der Unterschied
 * liegt allein dort, wo die alte Rechnung sprang: Im vollen Verbund, wo sie
 * 34,2 und 35,6 % erreichte, steht die neue still.
 *
 * DER DECKEL: UEBERGROESSE_DECKEL = 0.34 stammt aus der Vorkommens-Rechnung
 * (28,9 % + vier Punkte Abstand für die Rasterungsunterschiede zum CI-Build,
 * B9). Auf der Leitersprung-Rechnung ist der ruhige Wert identisch, die
 * Herleitung trägt also weiter — aber sie ist nicht NEU hergeleitet. Der
 * Vorschlag dazu liegt dem Eigentümer vor (PR-Text); bis zur Entscheidung
 * bleibt die Zahl, wie sie ist. Die Kopplung an B9 bleibt: Sobald beide
 * Umgebungen denselben Build fahren, ist das Nachziehen messbar statt
 * geschätzt.
 */
const UEBERGROESSE_DECKEL = 0.34;

test.describe("Bild-Auslieferung: Budget über alle Seiten", () => {
  test("die Leiter liefert nicht systematisch zu groß aus", async ({
    browser,
  }) => {
    let zuviel = 0;
    let bedarfsflaeche = 0;
    let gewertet = 0;
    let ueberLeiterende = 0;
    const schlimmste: Array<{ faktor: number; info: string }> = [];
    // Bilanz JE SEITE UND GERÄTEKLASSE (B28). Die Gesamtquote allein sagt
    // nicht, wo sie herkommt — und genau das kostete beim letzten Ausschlag
    // eine Sitzung mit Nachstellen.
    const jeStelle: Array<{
      stelle: string;
      n: number;
      zuviel: number;
      bedarf: number;
    }> = [];

    for (const kontext of KONTEXTE) {
      for (const seite of SEITEN) {
        const stelle = { stelle: `${seite} — ${kontext.name}`, n: 0, zuviel: 0, bedarf: 0 };
        jeStelle.push(stelle);
        for (const m of await messeSeite(browser, kontext, seite)) {
          const gewaehlt = Number(/\/w(\d+)\.webp/.exec(m.current)?.[1] ?? 0);
          const bedarf = Math.ceil(m.breite * kontext.deviceScaleFactor);
          if (!gewaehlt || !bedarf || !m.naturalWidth || !m.naturalHeight) {
            continue;
          }
          // DER LEITERSPRUNG, NICHT DIE GELADENE VARIANTE (B28). Verbucht wird
          // die Stufe, die die Leiter für DIESEN Bedarf hergibt — nicht, was
          // Chrome am Ende gezeigt hat. Denn Chrome verwendet für dieselbe
          // Datei eine bereits geladene größere Variante wieder, und welches
          // Vorkommen zuerst lädt, entscheidet unter Last ein Rennen. Das
          // kostet keine Bytes (EIN Download statt drei), stand hier aber als
          // Verschwendung in der Summe. Die Rechnung hängt jetzt allein an
          // Leiter und Layout; `gewaehlt` bleibt zur Diagnose im Bericht.
          const stufe = leiterstufe(verfuegbareBreiten(m), bedarf);
          if (stufe === undefined) {
            ueberLeiterende++;
            continue; // Bedarf über dem Leiterende: kein Leitersprung, Sache der Schärfe-Prüfung
          }
          // Fläche statt Breite: Bytes hängen an der Fläche, und ein
          // Breitenvergleich unterschätzte den Aufwand quadratisch. Das
          // Seitenverhältnis kommt aus der geladenen Datei selbst.
          const verhaeltnis = m.naturalHeight / m.naturalWidth;
          const sprung = (stufe * stufe - bedarf * bedarf) * verhaeltnis;
          zuviel += sprung;
          bedarfsflaeche += bedarf * bedarf * verhaeltnis;
          gewertet++;
          stelle.zuviel += sprung;
          stelle.bedarf += bedarf * bedarf * verhaeltnis;
          stelle.n++;
          schlimmste.push({
            faktor: (stufe * stufe) / (bedarf * bedarf),
            info:
              `${seite} · ${kontext.name} · Bedarf ${bedarf}px → Leiter w${stufe}` +
              // Richtung, nicht Ursache: Größer als die Stufe ist meist Chromes
              // Wiederverwendung (oder ein zu großes sizes — das fängt die
              // Einzelbild-Prüfung); kleiner heißt, das Layout ist breiter als
              // der sizes-Wert, den Chrome zugrunde legt.
              (gewaehlt > stufe
                ? ` (gezeigt w${gewaehlt} — größer: Wiederverwendung oder sizes zu groß)`
                : gewaehlt < stufe
                  ? ` (gezeigt w${gewaehlt} — kleiner: Layoutbreite über dem sizes-Wert)`
                  : "") +
              `\n        sizes:   ${m.sizes ?? "(kein sizes)"}\n` +
              `        Klassen: ${m.klassen}`,
          });
        }
      }
    }

    // Fail-closed: ohne Messwerte prüft der Test nichts.
    expect(gewertet, "keine übergroß gelieferten Bilder gemessen")
      .toBeGreaterThan(50);

    const uebergroesse = zuviel / bedarfsflaeche;
    schlimmste.sort((a, b) => b.faktor - a.faktor);
    // Auch bei Erfolg ausgeben. Ein Budget, dessen Ausnutzung man nur im
    // Fehlerfall sieht, lässt sich nicht beobachten — man erfährt vom
    // Heranschleichen an den Deckel erst, wenn er gerissen ist. Und die
    // Grundgesamtheit gehört dazu: Ändert SIE sich, ändert sich die Quote,
    // ohne dass ein einziges Bild anders ausgeliefert würde (B2).
    console.log(
      `[bild-budget] Übergröße ${(uebergroesse * 100).toFixed(1)} % · ` +
        `${gewertet} gewertet · ${ueberLeiterende} über Leiterende · ` +
        `Deckel ${(UEBERGROESSE_DECKEL * 100).toFixed(0)} %`,
    );
    // Auch bei Erfolg: Wer den Deckel heranschleichen sehen will, braucht die
    // Verteilung, nicht nur die Summe.
    const aufschluesselung = jeStelle
      .filter((s) => s.n > 0)
      .map((s) => ({ ...s, quote: s.zuviel / s.bedarf }))
      .sort((a, b) => b.zuviel - a.zuviel)
      .map(
        (s) =>
          `  ${(s.quote * 100).toFixed(1).padStart(5)} %  n=${String(s.n).padStart(2)}  ${s.stelle}`,
      )
      .join("\n");
    console.log(`[bild-budget] je Seite und Geräteklasse:\n${aufschluesselung}`);

    const bericht = schlimmste
      .slice(0, 8)
      .map((s) => `  ×${s.faktor.toFixed(2)}  ${s.info}`)
      .join("\n");

    expect(
      uebergroesse,
      `Übergröße ${(uebergroesse * 100).toFixed(1)} % über ${gewertet} gewertete ` +
        `Bilder (${ueberLeiterende} über dem Leiterende bleiben außen vor, Deckel ` +
        `${(UEBERGROESSE_DECKEL * 100).toFixed(0)} %).\n` +
        `Bilanz je Seite und Geräteklasse:\n${aufschluesselung}\n\n` +
        `Größte Einzelabweichungen:\n${bericht}`,
    ).toBeLessThanOrEqual(UEBERGROESSE_DECKEL);
  });
});
