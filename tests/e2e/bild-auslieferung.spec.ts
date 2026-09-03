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
  /** Nur für die Diagnose eines Ausreißers — nicht für die Bewertung. */
  sizes: string;
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

  const daten = await page.evaluate(() =>
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
        sizes: img.getAttribute("sizes") ?? "(kein sizes)",
        klassen:
          `${img.className || "—"}` +
          (img.parentElement ? ` | Eltern: ${img.parentElement.className || "—"}` : ""),
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
 * Jetzt gehen unterlieferte Bilder (gewählt < Bedarf) in KEINE der beiden
 * Summen ein. Sie sind Sache der SCHAERFE_MINIMUM-Prüfung oben; wer sie hier
 * mitzählte, könnte das eine Problem mit dem anderen bezahlen.
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
 * Gemessen mit der korrigierten Metrik: alte Leiter 41,2 %, mit der Stufe 1152
 * noch 28,8 % (damals 101 gewertete Bilder). Wer 1152 wieder entfernt, wird rot.
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
 * Stelle. Gemessen wird heute:
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
 * WAS OFFEN BLEIBT: Die Quote springt selten und bisher nicht auf Kommando.
 * Zweimal belegt, beide Male ohne Änderung am Quelltext:
 *
 *     main, isoliert:   28,9 · 28,9 · 28,9 · 34,2   ← reißt den Deckel von 34 %
 *     ein Zweig davon:  31,5 · 35,2 · 35,6 · 45,6
 *
 * Sieben gezielte Wiederholungen danach ergaben siebenmal exakt 28,9 % — die
 * Abweichung ließ sich nicht einfangen. Verdacht, nicht Befund: Sie trat nur
 * in Läufen mit vielen parallelen Arbeitern auf. Passt dazu, dass Chrome für
 * DIESELBE Datei eine bereits geladene größere Variante wiederverwendet
 * (siehe Kopf dieser Datei) — welches Vorkommen zuerst lädt, entscheidet dann
 * ein Rennen, und unter Last fällt es anders aus.
 *
 * Deshalb gibt dieser Test seine Bilanz jetzt JE SEITE UND GERÄTEKLASSE aus.
 * Bisher stand da eine einzige Zahl; wird sie rot, weiß niemand, wo sie
 * herkommt. Mit der Aufschlüsselung nennt der nächste Ausschlag seinen Ort,
 * statt wieder eine Sitzung mit Nachstellen zu kosten.
 *
 * Der Deckel bleibt bei 34 % und wird NICHT nachgezogen, obwohl der Wert jetzt
 * reproduzierbar ist: Die vier Punkte Abstand decken die Rundungsunterschiede
 * zwischen dem hier laufenden Chromium 141 und dem in CI installierten Build
 * ab (siehe B9). Sobald beide Umgebungen denselben Build fahren, ist das
 * Nachziehen fällig — dann ist es messbar statt geschätzt.
 */
const UEBERGROESSE_DECKEL = 0.34;

test.describe("Bild-Auslieferung: Budget über alle Seiten", () => {
  test("die Leiter liefert nicht systematisch zu groß aus", async ({
    browser,
  }) => {
    let zuviel = 0;
    let bedarfsflaeche = 0;
    let gewertet = 0;
    let unterliefert = 0;
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
          if (gewaehlt < bedarf) {
            unterliefert++;
            continue; // gehört zur Schärfe-Prüfung, nicht ins Übergrößen-Budget
          }
          // Fläche statt Breite: Bytes hängen an der Fläche, und ein
          // Breitenvergleich unterschätzte den Aufwand quadratisch. Das
          // Seitenverhältnis kommt aus der geladenen Datei selbst.
          const verhaeltnis = m.naturalHeight / m.naturalWidth;
          zuviel += (gewaehlt * gewaehlt - bedarf * bedarf) * verhaeltnis;
          bedarfsflaeche += bedarf * bedarf * verhaeltnis;
          gewertet++;
          stelle.zuviel += (gewaehlt * gewaehlt - bedarf * bedarf) * verhaeltnis;
          stelle.bedarf += bedarf * bedarf * verhaeltnis;
          stelle.n++;
          schlimmste.push({
            faktor: (gewaehlt * gewaehlt) / (bedarf * bedarf),
            info:
              `${seite} · ${kontext.name} · Bedarf ${bedarf}px → w${gewaehlt}\n` +
              `        sizes:   ${m.sizes}\n` +
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
        `${gewertet} gewertet · ${unterliefert} unterliefert · ` +
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
        `Bilder (${unterliefert} unterlieferte bleiben außen vor, Deckel ` +
        `${(UEBERGROESSE_DECKEL * 100).toFixed(0)} %).\n` +
        `Bilanz je Seite und Geräteklasse:\n${aufschluesselung}\n\n` +
        `Größte Einzelabweichungen:\n${bericht}`,
    ).toBeLessThanOrEqual(UEBERGROESSE_DECKEL);
  });
});
