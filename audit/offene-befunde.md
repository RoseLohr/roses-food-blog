# Offene Befunde — später zu adressieren

Gesammelt während des Bildgruppen-Umbaus. Hier steht, was AUFGEFALLEN ist,
ohne im laufenden Umbau behoben zu werden — damit es nicht verloren geht und
nicht heimlich mitgeschleppt wird.

Regel für diese Liste: Jeder Eintrag nennt den Befund, wie er belegt wurde, und
warum er hier statt sofort steht. Kein Eintrag ohne Beleg.

---

## B1 — `/rezepte/kategorie/<slug>` ist im Frontend unverlinkt

**Befund.** Die Route existiert und steht in der Sitemap, aber im ganzen
Frontend zeigt kein einziger Link darauf. Die Rezept-Detailseite verweist
stattdessen auf `/suche?kategorie=…` (`src/components/recipe-view.tsx:97`,
`filterRow`), die Rezeptliste verlinkt Kategorien gar nicht.

**Beleg.** `grep -rn 'rezepte/kategorie/' src/` findet nur die Seite selbst und
ihre Metadaten. Die Referenzaufnahme in `tests/e2e/seiten-referenz.spec.ts`
muss die Adresse deshalb aus der Sitemap holen statt einer Verknüpfung zu
folgen.

**Warum hier.** Ob die Route bleiben, verlinkt oder entfallen soll, ist eine
inhaltliche Entscheidung — zwei Wege zum selben Ergebnis (`/suche?kategorie=`
und `/rezepte/kategorie/`) sind außerdem ein SEO-Thema (Duplikat), kein
Layout-Thema.

---

## B2 — Flatterhafte Kontrolle: Bild-Auslieferungsbudget

**Befund.** `tests/e2e/bild-auslieferung.spec.ts` schlug in neun Läufen einmal
fehl. Die gemessene Überschreitung an der echten Seite lag beim Schlimmsten bei
Faktor 2,5 und damit klar im Budget; die Streuung kommt aus der gemessenen
Grundgesamtheit.

**Ursache (Verdacht, nicht bewiesen).** Die Startseite sortiert „beliebt" nach
Likes, und E2E-Tests vergeben Likes. Welche Bilder gemessen werden, hängt damit
von der Reihenfolge der Testdateien ab.

**Warum hier.** Die Schwelle wird NICHT angehoben. Zu tun ist zweierlei:
Diagnose verbessern (bei einem Ausreißer `sizes`, Klasse und Seite ausgeben)
und die Grundgesamtheit stabilisieren. Beides ist eigenständige Arbeit.

---

## B3 — Deploy und Rollback: sechs Befunde

Aus der adversarischen Gegenprüfung des Deploy-Pfads. Der schwerste zuerst.

1. **`deploy/rollback.sh` kopiert eine laufende WAL-Datenbank mit `cp`.**
   Gemessen: von 3000 committeten Zeilen überleben 2985 — 15 gehen still
   verloren, weil der WAL nicht mitkopiert wird.
2. Kein Alarm, wenn der Container nach dem Deploy gar nicht startet.
3. Die Diagnose geht mit dem Container verloren: Beim Rollback wird der
   fehlgeschlagene Container entfernt, bevor seine Protokolle gesichert sind.
4. Ein zweiter Deploy überschreibt das Rollback-Ziel — nach zwei Fehlschlägen
   hintereinander gibt es keinen bekannt guten Stand mehr.
5. Endlose Neustartschleife: Ein Container, der beim Start stirbt, wird ohne
   Obergrenze neu gestartet.
6. Rollback meldet Erfolg, während das Schema voraus ist — die alte
   Anwendungsversion läuft gegen die bereits migrierte Datenbank.

**Warum hier.** Eigener Pfad, eigene Risiken, eigener PR. Befund 1 bedeutet
echten Datenverlust im Wiederherstellungsweg und sollte zuerst drankommen.

---

## B4 — Export/Import verlor Layout-Angaben des Bildblocks — ERLEDIGT

Der Bildblock trägt keine Layout-Felder mehr; es kann nichts mehr verloren
gehen. Der Archivvertrag ist additiv geblieben: Ein Archiv von vor dem Umbau
bringt `groesse` noch mit, das Feld wird nur nicht mehr gelesen und kippt den
Import nicht (festgehalten in `tests/data-transfer.integration.test.ts`).

---

## B5 — Referenzaufnahmen decken den Admin nicht ab

**Befund.** `tests/e2e/seiten-referenz.spec.ts` hält elf ÖFFENTLICHE Seitentypen
an drei Breiten fest. Für `/admin` gibt es keine einzige Aufnahme. Ein Umbau im
Admin lässt sich damit nicht als „sieht gleich aus" nachweisen.

**Warum das zählt.** Die Durchmusterung (58 Agenten) hat zwölf
Generalisierungen vorgeschlagen, die der Gegenprüfung standhielten oder in
deren Korrektur überlebten. **Fünf davon liegen im Admin** — sie sind ohne
Beweismittel nicht abnehmbar.

**Vorschlag.** Kein Screenshot, sondern ein HTML-Vergleich: vor dem Umbau das
gerenderte Markup der betroffenen Admin-Routen wegschreiben, danach
byte-vergleichen. Die Kandidaten behaupten byte-gleiches Markup — genau das
prüft man so direkt statt über Pixel. Wegwerf-Skript, kein Dauertest.

---

## B6 — Arbeitsliste Code-Reduktion (aus der Durchmusterung)

Ergebnis von 58 Agenten über sechs Bereiche, jeder Vorschlag anschließend
angegriffen. Die meisten Kandidaten sind GEFALLEN — das ist selbst ein Befund:
Der Code ist weniger doppelt, als er aussieht. Was standhielt, geordnet nach
Ertrag pro Risiko:

| # | Was | Datei(en) | Zeilen |
|---|---|---|---|
| 1 | Zwölf ausgeschriebene Quellen → Tupel-Tabelle + `.map` | `src/lib/media-verwendung.ts:35-132` | −72 · **erledigt (−48)** |
| 2 | Vier identische Formularaufbauten → ein Bauer | `tests/travel-dish-images.integration.test.ts` | −65 |
| 3 | 17× dieselbe Statusmeldung → `<Meldung>` | 17 Admin-Seiten | −40 bis −52 |
| 4 | Testaufbau „frische Datenbank" → `frischeDb()` | 23 Testdateien | −95 bis −105 |
| 5 | Testdaten „Admin anlegen" → `adminAnlegen()` | 7 Testdateien | −42 |
| 6 | Löschen-Formular → `<LoeschForm>` | 9 Admin-Seiten | −25 |
| 7 | Vier Inline-Setter → vorhandenes `updateDish` | `travel-editor.tsx` | −18 |
| 8 | `MASSE.inhalt` ist ein Doppelgänger von `vollbildSizes()` | `travel-view.tsx:59-68` | −3 bis −14 · **erledigt (−13)** |
| 9 | Publikationsstatus-Chip → eine Komponente | 3 Admin-Seiten | −8 bis −13 |
| 10 | Wurzelkrume in `breadcrumbJsonLd` ziehen | `src/lib/jsonld.tsx` + 6 Seiten | −8 · **erledigt (−12)** |
| 11 | `GalleryImage extends MediaImageLike` | `gallery-lightbox.tsx:34-65` | −8 · **erledigt (−6)** |
| 12 | Zwei sofort ausgeführte Funktionen auflösen | `image-picker.tsx` | −3 |

**Gesamt realistisch ≈ −395** (untere Kante; der Hausstil verlangt an jeder
neuen Datei einen deutschen Doc-Kommentar, das kostet je Eintrag 5–15 Zeilen
gegenüber der Rohrechnung). Einträge 1, 2 und 4 tragen davon ≈ 235 — kippt
einer, kippt die Bilanz.

**Reihenfolge.** Erst B5 (Admin-Beweismittel), sonst sind 3, 6, 9 und 12 nicht
abnehmbar. Dann 1, 8, 10, 11 (unabhängig, durch vorhandene Kontrollen gedeckt).
Dann 2+4+5 in EINEM Durchgang je Testdatei — sie fassen dieselben
`beforeAll`-Blöcke an.

**Voraussetzung für Eintrag 4:** Der Helfer darf `@/db` nicht statisch
importieren (`src/db/index.ts:92` legt die Verbindung eager an). Heute schützt
davor die handgeschriebene Reihenfolge; danach schützt nichts mehr. **Erst die
Kontrolle bauen, dann den Helfer.**

---

## B7 — Kaskadenfalle: `globals.css` hat kein `@layer`

**Befund.** In 1136 Zeilen steht kein einziges `@layer`. Tailwind v4 legt seine
Utilities per `@import "tailwindcss"` in `@layer utilities`. Eine ungelayerte
Projektklasse schlägt damit **jede** Utility, unabhängig von Spezifität:
`class="karte p-4"` oder `class="bildgruppe mb-8"` wären still wirkungslos.

**Warum hier.** Es ist genau der Fehlermodus, dessen Abschaffung diesen Auftrag
ausgelöst hat — eine Regel, die stillschweigend etwas anderes tut, als
dasteht. Wer künftig eine Projektklasse einführt, muss `@utility` benutzen. Im
Bildgruppen-Block steht die Warnung jetzt im Kommentar; sie gehört aber an den
Anfang der Datei und in die Mandate.

---

## B8 — E2E-Specs schreiben in eine gemeinsame Datenbank

**Befund.** `tests/e2e/cms-paket.spec.ts` ändert über den Admin den
Einleitungstext der Reisen-Seite. Alles, was danach läuft, sieht den geänderten
Stand. Die Referenzaufnahmen liefen dadurch allein grün und im Verbund rot.

**Was getan wurde.** Die Reihenfolge ist jetzt ZUGESAGT statt gehofft:
`playwright.config.ts` fährt die Referenz als eigenes Projekt vor allem
anderen (`dependencies`). Das behebt das Symptom für diese eine Kontrolle.

**Was offen bleibt.** Die Ursache ist, dass Specs gemeinsamen Zustand
verändern und nicht aufräumen. Jede künftige Kontrolle, die einen unberührten
Stand braucht, hat dasselbe Problem. Sauber wäre ein eigenes `DATA_DIR` je
Spec-Gruppe.

---

## B9 — Die Rasterungsumgebung ist nicht festgelegt

**Befund.** Die 33 Referenzaufnahmen reproduzieren auf dem CI-Läufer NICHT. Es
ist keine Kantenglättung, sondern eine andere Schriftmetrik: Der Text bricht
anders um, und die Seiten werden unterschiedlich hoch.

```
datenschutz @ handy-390:  erwartet 390x6102, erhalten 390x6000   (102 px kürzer)
datenschutz @ ipad-834:   erwartet 834x3822, erhalten 834x3849   ( 27 px höher)
datenschutz @ desktop:    erwartet 1280x3785, erhalten 1280x3812 ( 27 px höher)
ueber-mich  @ desktop:    gleiche Höhe, 8883 Pixel (Verhältnis 0,01)
```

**Was getan wurde.** Die Referenz ist ein ÖRTLICHES Werkzeug: Sie läuft vor dem
Push auf einer Maschine und beweist dort, dass ein Umbau nur ändert, was er
ändern soll (beim Bildgruppen-Umbau: 30 von 33 pixelgleich). In CI läuft sie
nicht, und die Begründung samt Zahlen steht in `playwright.config.ts`.

**Ausdrücklich NICHT getan.** Die Toleranz wurde nicht angehoben. Bei einer
Abweichung von 0,20 müsste sie so weit hoch, dass eine verrutschte Bildzeile
darunter verschwindet — die Kontrolle wäre dann nur noch Dekoration.

**Die Wurzel** ist, dass die Rasterungsumgebung nirgends festgelegt ist. Wer
die Referenz zum CI-Gate machen will, muss e2e in einem festen Abbild fahren —
naheliegend dasselbe Container-Abbild, in dem die Anwendung ausgeliefert wird
(`podman`, siehe README §Betrieb). Dann stimmen Schriften und Rasterung, und
die Basis ist zwischen Maschinen portabel. Das ist eigene Arbeit und braucht
eine eigene Abnahme.

**Zwischenstand bis dahin:** Die Struktur der Bildanordnung ist in CI trotzdem
gedeckt — `tests/e2e/bildreihen.spec.ts` und `tests/e2e/bildgruppe-mock.spec.ts`
messen Geometrie (gleiche Höhe, Breitensumme, kein Überlauf) statt Pixel und
sind damit maschinenunabhängig.

---

## B10 — Unbenutzte Importe röten das Gate nicht

**Gefunden 08/2026 beim Umbau der Brotkrume (B6, Eintrag 10).** Nachdem
`getSiteName()` aus sechs Aufrufstellen verschwand, blieb der Import in VIER
Dateien stehen und wurde von niemandem mehr gebraucht:

```
src/components/travel-filter-list.tsx:14
src/app/(public)/[slug]/page.tsx:14
src/app/(public)/rezepte/kategorie/[slug]/page.tsx:18
src/app/(public)/datenschutz/page.tsx:24
```

`tsc --noEmit` sieht das nicht (`noUnusedLocals` ist aus, und für Importe
greift es ohnehin nur eingeschränkt). ESLint sieht es, meldet es aber als
**Warnung** — `npm run lint` bleibt grün, und das Gate liest nur die Fehler.

Das ist kein kosmetischer Befund: Ein unbenutzter Import ist eine Kante, die
das Abhängigkeitsbild verfälscht (`boundary-check.mjs` und `deps-existence.mjs`
lesen Importe) und die beim Bündeln Gewicht kosten kann, wenn das Modul
Nebenwirkungen hat.

**Wurzelbehebung:** `@typescript-eslint/no-unused-vars` für `src/**` auf
`error`. Voraussetzung sind die **9 verbliebenen Fundstellen** in `src/`
(Stand 08/2026, `npx eslint src | grep no-unused-vars`) — erst aufräumen, dann
die Regel schärfen, sonst ist der erste Lauf rot und die Regel wird wieder
gelockert. Kein Anheben einer Schwelle, keine Ausnahmeliste.

In `tests/` stehen daneben 22 weitere Warnungen, überwiegend
`no-explicit-any`. Sie gehören in denselben Durchgang, aber nicht in dieselbe
Regel: Tests dürfen aus guten Gründen unscharf typisieren, `src/` nicht.
