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

## B5 — Referenzaufnahmen decken den Admin nicht ab — ERLEDIGT 08/2026

**Befund war.** `seiten-referenz.spec.ts` hielt elf ÖFFENTLICHE Seitentypen an
drei Breiten fest. Für `/admin` gab es keine einzige Aufnahme; fünf der zwölf
Reduktions-Kandidaten lagen dort und waren damit nicht abnehmbar.

**Erledigt** mit `tests/e2e/admin-referenz.spec.ts`: 27 Admin-Seiten × drei
Breiten = 81 Aufnahmen, 8,1 MB. Die Mechanik (Breiten, Warten, Masken,
Toleranz) liegt gemeinsam in `tests/e2e/referenz.ts`; die Specs tragen nur noch
ihre Seitenlisten.

**Der ursprüngliche Vorschlag (Markup byte-vergleichen) wurde verworfen**, und
das mit Grund: Ein byte-gleiches Markup ist weder notwendig noch hinreichend.
`<Statuschip>` erzeugt dieselben Klassen in anderer Reihenfolge — Markup
verschieden, Bild gleich. Umgekehrt kann gleiches Markup unter geändertem CSS
anders aussehen. Gemessen werden sollte, was der Redakteur sieht.

**Drei Seiten bleiben bewusst draußen** (durchgemustert, nicht übersehen):
`/admin/saisonkalender` (Kalenderwoche aus der Systemuhr, die Chip-Liste wird
je nach Woche 28 bis 75 Einträge lang — kein Maskenfall, die halbe Seite wird
anders hoch), `/admin/statistik` (die Kennzahlen zählen die Aufrufe DIESES
Laufs mit) und `/admin/kontakte/[id]` (die Saat legt keinen Kontakt an).

**Nebenbefund, beim Bauen gefunden und behoben:** Die Maske
`[data-referenz-maske="true"]` traf NICHTS — die Marke stand in keiner Datei
unter `src/`, obwohl der Kommentar einen Schutz behauptete. Die Mechanik prüft
jetzt sich selbst: Eine Seite mit `maskiert: true` muss mindestens eine Marke
tragen, jede andere keine.

**Restarbeit (klein):** Die Wurzel unter den drei Datumsmasken ist, dass der
Seed `new Date()` benutzt. Ein fester Saat-Zeitpunkt machte die Daten
reproduzierbar UND gäbe den Listen mit gleichen Zeitstempeln eine definierte
Reihenfolge. Das berührt auch die öffentlichen Aufnahmen und ist deshalb ein
eigener Schritt.

---

## B6 — Arbeitsliste Code-Reduktion — ERLEDIGT 08/2026

Ergebnis von 58 Agenten über sechs Bereiche, jeder Vorschlag anschließend
angegriffen. Die meisten Kandidaten sind GEFALLEN — das ist selbst ein Befund:
Der Code ist weniger doppelt, als er aussieht. Alle zwölf, die standhielten,
sind umgesetzt.

| # | Was | Geschätzt | Tatsächlich |
|---|---|---:|---:|
| 1 | Zwölf ausgeschriebene Quellen → Tupel-Tabelle | −72 | **−48** |
| 2 | Vier Formularaufbauten → ein Bauer | −65 | **−39** |
| 3 | 17× Statusmeldung → `<Meldung>` | −40…−52 | *siehe unten* |
| 4 | Testaufbau „frische Datenbank" → `frischeDb()` | −95…−105 | **−271 (mit 2+5)** |
| 5 | „Admin anlegen" → `adminAnlegen()` | −42 | *in 4 enthalten* |
| 6 | Löschen-Formular → `<LoeschForm>` | −25 | *siehe unten* |
| 7 | Vier Inline-Setter → `updateDish` | −18 | **−10 (sechs Stellen)** |
| 8 | `MASSE.inhalt` = `vollbildSizes()` | −3…−14 | **−13** |
| 9 | Statuschip → eine Komponente | −8…−13 | *siehe unten* |
| 10 | Wurzelkrume in `breadcrumbJsonLd` | −8 | **−12** |
| 11 | `GalleryImage extends MediaImageLike` | −8 | **−6** |
| 12 | Zwei Sofortfunktionen auflösen | −3 | *siehe unten* |

**Gesamt `src/`: −65 Zeilen** gegenüber geschätzt ≈ −395. Der Unterschied ist
kein Rechenfehler, sondern eine Lehre:

1. **Die Testeinträge (2, 4, 5) tragen fast alles.** −271 Zeilen in 23
   Testdateien. Dort war die Wiederholung echt und ohne Gegenwert.
2. **Die Komponenteneinträge (3, 6, 9, 12) tragen zusammen −17.** Eine
   Komponente kostet ihre Schnittstelle: Typangaben, Vorgabewerte, den
   Kopfkommentar, den der Hausstil verlangt. Der erste Wurf machte `src/` sogar
   um 51 Zeilen LÄNGER; erst kürzere Kommentare und Vorgabewerte für den
   häufigsten Fall (`<LoeschForm action={…} id={…} />`) drehten das.
3. **Die Zeilenzahl war die falsche Größe.** Was tatsächlich sank:

       Duplikation   4,12 % → 3,67 %
       Klonpaare     124 → 107
       dupl. Zeilen  1624 → 1449

   17 Kopien einer Rückmeldung sind 17 Gelegenheiten, `role="status"` zu
   vergessen. Zwölf Löschen-Formulare sind zwölf Stellen, an denen eine
   Rückfrage einzubauen wäre — in einem Projekt, in dem Löschen ohne Rückfrage
   schon einmal eine Bildzeile zerrissen hat.

**Was dabei zusätzlich herauskam** (nicht auf der Liste, im Vorbeigehen
gefunden): Eintrag 7 war nicht nur Wiederholung, sondern ein latenter Defekt
(sechs Stellen rechneten auf dem gerenderten statt dem aktuellen Zustand);
`breadcrumbJsonLd` hatte gar keinen Test; der Selbsttest zu Eintrag 1 verglich
Anzahlen statt Paare und hätte zwei sich aufhebende Fehler durchgelassen; und
die Maske der Referenzaufnahmen traf nichts (siehe B5).

**Nicht umgestellt:** `tests/migrationen-reihenfolge.test.ts` — sie PRÜFT den
Migrator, statt ihn als Aufbau zu benutzen, und braucht je Testfall ein eigenes
Verzeichnis. Das ist die Grenze des Musters, kein Versehen.

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
