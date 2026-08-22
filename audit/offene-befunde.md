# Offene Befunde — später zu adressieren

Gesammelt während des Bildgruppen-Umbaus. Hier steht, was AUFGEFALLEN ist,
ohne im laufenden Umbau behoben zu werden — damit es nicht verloren geht und
nicht heimlich mitgeschleppt wird.

Regel für diese Liste: Jeder Eintrag nennt den Befund, wie er belegt wurde, und
warum er hier statt sofort steht. Kein Eintrag ohne Beleg.

---

## B1 — `/rezepte/kategorie/<slug>` ist im Frontend unverlinkt — ERLEDIGT 08/2026

**Der Befund war zu scharf formuliert.** Verlinkt WAR die Route — in
`src/lib/nav-data.ts`, für das Aufklappmenü der Kopfzeile. Nur steht dieses
Menü erst nach einem Hover im DOM (`hasChildren && expanded &&`,
`site-header.tsx:201`). Für einen Menschen erreichbar, für einen Crawler nicht.

**Das eigentliche Problem war ein anderes:** Startseite und Rezept-Detailseite
zeigten auf `/suche?kategorie=…` — zwei Wege zu demselben Inhalt, und verlinkt
war der NICHT-kanonische. Die Kategorieseite trägt `alternates.canonical` auf
sich selbst, eine eigene Brotkrume und einen eigenen Tracking-Pfad; sie ist
offensichtlich als die kanonische Adresse gedacht.

**Entschieden: behalten und verlinken.** Kategorien zeigen jetzt auf
`/rezepte/kategorie/<slug>`. Die übrigen drei Taxonomien (Küche,
Ernährungsform, Schlagwort) haben keine eigene Seite und bleiben bei der Suche
— dort wäre eine eigene Route eine 404.

**Anker ist die REZEPTSEITE, nicht die Startseite.** Deren Filtergruppen sind
admin-konfigurierbar (`homepage_filter_group`), und „kategorie" ist in der Saat
nicht freigeschaltet. Ein Test, der von der Startseite ausginge, prüfte die
Konfiguration statt der Verlinkung — der erste Anlauf tat genau das und war
zu Recht rot.

Die Referenzaufnahme holt die Adresse jetzt über eine echte Verknüpfung statt
aus der Sitemap. Dadurch erreicht sie `/rezepte/kategorie/salat` statt
`/rezepte/kategorie/fruehstueck` — eine ANDERE Seite, kein Layoutbruch;
gemessen und benannt, die drei Aufnahmen gezielt neu genommen.

---

## B2 — Flatterhafte Kontrolle: Bild-Auslieferungsbudget — ERLEDIGT 08/2026

**Befund war.** `tests/e2e/bild-auslieferung.spec.ts` schlug in neun Läufen
einmal fehl. Verdacht: Die Startseite sortiert „beliebt" nach Likes, und
E2E-Tests vergeben Likes — welche Bilder gemessen werden, hinge damit an der
Reihenfolge der Testdateien.

**Der Verdacht war halb richtig, die Ursache größer.** Nachgemessen sind es
zwei unabhängige Quellen:

**1. Sortierungen ohne eindeutigen Zweitschlüssel.** Nicht nur „beliebt": Eine
Durchmusterung aller 50 `orderBy`-Stellen (mit Gegenprüfung jeder Behauptung)
fand **20** Stellen, an denen SQLite bei Gleichstand keine definierte
Reihenfolge liefert — 30 waren nachweislich eindeutig, keine Behauptung wurde
widerlegt. Der Saatzustand macht Gleichstand zum Normalfall: `like_count`
steht überall auf 0, und `scripts/seed.ts` gibt allen Rezepten EINEN
gemeinsamen `publishedAt`. Bei `limit` entschied das sogar, WELCHE Rezepte
erscheinen. Überall steht jetzt die `id` als Zweitschlüssel.

**2. Gemessen wurde, bevor die Seite zur Ruhe war.** „Alle Bilder geladen"
heißt nicht „alle Bilder da": Nach der Hydration kommen welche dazu
(Galerie-Streifen, Slider-Folien), und ein Bild ohne fertiges Layout hat
Breite 0 und fällt aus der Messung. Gemessen: 141, 143, 150 Bilder in drei
Läufen. Jetzt wird gewartet, bis die Zahl messbarer Bilder über drei
Stichproben gleich bleibt — kein festes `waitForTimeout`, das wäre wieder eine
Wette auf die Maschine.

**Ergebnis, vier Läufe hintereinander identisch:**

```
[bild-budget] Übergröße 30,0 % · 150 gewertet · 18 unterliefert · Deckel 34 %
```

**Diagnose verbessert.** Ein Ausreißer nennt jetzt `sizes` und die Klassen von
Bild und Elternelement, nicht nur Seite und Faktor:

```
×6.25  /suche?q=pasta · Desktop 1280px @ DPR 1 · Bedarf 64px → w160
       sizes:   64px
       Klassen: h-16 w-16 shrink-0 object-cover | Eltern: flex items-start gap-3 …
```

Die Quote steht außerdem bei JEDEM Lauf im Protokoll, nicht nur im Fehlerfall —
ein Budget, dessen Ausnutzung man nur beim Reißen sieht, kann man nicht
beobachten.

**Der Deckel wurde NICHT angehoben** — und auch nicht nachgezogen, obwohl der
Wert jetzt reproduzierbar ist: Die vier Punkte Abstand decken die
Rundungsunterschiede zwischen den beiden Chromium-Builds ab (B9). Sobald beide
Umgebungen denselben Build fahren, ist das Nachziehen fällig — dann ist es
messbar statt geschätzt.

---

## B3 — Deploy und Rollback: sechs Befunde — ERLEDIGT 08/2026

Aus der adversarischen Gegenprüfung des Deploy-Pfads. Alle sechs behoben; die
Messungen stehen in `tests/rollback-wal.test.ts` und `tests/deploy-betrieb.test.ts`.

**1. `deploy/rollback.sh` kopierte eine laufende WAL-Datenbank mit `cp`.**
Notiert war „von 3000 Zeilen überleben 2985". **Nachgemessen ist es schlimmer:**
3000 Zeilen in einer Transaktion festgeschrieben, Verbindung offen — `app.db`
ist 4096 Byte groß (nur der Kopf), das `-wal` 70 KB. Die Kopie enthält nicht
2985 Zeilen, sie enthält **die Tabelle nicht**. Behoben über die
Online-Backup-API, dieselbe, die `deploy.sh` und `deploy/backup.sh` längst
benutzen.

**1b. Beim Nachstellen kam ein ZWEITER Defekt heraus, der schwerer wiegt.**
Das Einspielen ließ die alten `-wal`/`-shm`-Dateien liegen. Nach hartem
Abbruch — also `podman rm -f`, dem Regelfall beim Rollback — spielt SQLite
dieses WAL über das eingespielte Backup: Angefordert waren 7 gesicherte
Zeilen, zurück kamen die 3000 alten. **Der Restore tat nichts und meldete
Erfolg.** Ein stiller No-op im Wiederherstellungsweg ist schlimmer als ein
Fehlschlag. Behoben: `rm -f app.db-wal app.db-shm` nach dem Einspielen.

**1c. Und die Reihenfolge stimmte nicht.** Der Restore lief VOR dem Stoppen des
Containers — die Datei wurde unter einer laufenden SQLite-Verbindung
ausgetauscht. Jetzt: erst stoppen, dann anfassen.

**2. Kein Alarm, wenn der Container nach dem Deploy gar nicht startet.**
Der Selbst-Monitor alarmiert zuverlässig — aber er läuft IN der Anwendung.
Genau im schlimmsten Fall schweigt die Meldekette. Neu:
`scripts/betriebsalarm.mjs`, eigenständig, liest SMTP direkt aus `app.db`,
gefahren im bekannt guten `:previous`-Image. `fail()` in `deploy.sh` setzt ihn
ab — mit Zeitgrenze und Rückfallpfad, damit ein stummer SMTP-Server ein
Deployment nicht zusätzlich aufhängt.

**3. Die Diagnose ging mit dem Container verloren.** `podman rm` nimmt die
Protokolle mit. Jetzt werden sie VOR dem Entfernen vollständig weggeschrieben
(`deploy-fehlschlag-*.log`, `rollback-*.log`), nicht nur 40 Zeilen auf den
Schirm.

**4. Ein zweiter Deploy überschrieb das Rollback-Ziel.** `:previous` wurde bei
JEDEM Lauf fortgeschrieben; nach zwei Fehlschlägen zeigte es auf den kaputten
Stand. Jetzt schreibt der Erfolgspfad die Image-ID nach `deploy-image-ok`, und
umgetaggt wird nur, wenn das laufende `:latest` genau dieser Zeuge ist. Ein
alter bekannt guter Stand ist mehr wert als ein frischer unbekannter.

**5. Endlose Neustartschleife.** `restart: on-failure:N` wäre der naheliegende
Griff und **wäre falsch**: `podman-restart.service` startet nach einem
Rechnerneustart nur Container mit der Regel `always` — der Tausch hätte eine
Störung gegen den Ausfall vom 2026-08-10 eingetauscht. Die Regel bleibt
`always`; die Grenze zieht ein Wachhund (`deploy/wachhund.sh` + systemd-Timer,
alle 5 min). Er stoppt erst, wenn es über mehrere Beobachtungen hinweg rot
bleibt UND die Neustarts weiter steigen — ein holpriger Start, der sich selbst
fängt, wird nicht abgewürgt. Die Entscheidung ist eine reine Funktion
(`scripts/wachhund.mjs`), damit sie ohne Anlage prüfbar ist.

**6. Rollback meldete Erfolg, während das Schema voraus war.** Jetzt vergleicht
`rollback.sh` `PRAGMA user_version` der Datenbank mit der Zahl der Migrationen
im `:previous`-Image und bricht ab, statt eine alte Anwendung gegen ein zu
neues Schema zu starten.

**Was NICHT geprüft werden konnte:** systemd und podman gibt es in der
Testumgebung nicht. Geprüft sind die reinen Entscheidungen (Wachhund, Alarmweg)
und die Textinvarianten der Betriebsdateien; der Timer selbst und der
podman-Aufruf sind erst auf der Anlage belegbar. Das ist benannt, nicht
kaschiert.

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

## B7 — Kaskadenfalle: `globals.css` hat kein `@layer` — ERLEDIGT 08/2026

**Befund war.** In 1094 Zeilen stand kein einziges `@layer`. Tailwind v4 legt
seine Utilities in `@layer utilities`; ungelayertes CSS schlägt JEDE Schicht,
unabhängig von Spezifität. `class="bildgruppe mb-8"` war damit still wirkungslos.

**Erledigt — und zwar durch Beseitigen statt Bewachen.** Alles Projekt-CSS
liegt jetzt in `@layer components`; `@import`, `@font-face` und `@theme` bleiben
außerhalb (die gehören nicht in eine Schicht). Die Reihenfolge ist damit
theme → base → components → utilities: Eine Utility gewinnt gegen eine
Projektklasse, wie man es erwartet.

Ein Kommentar hätte es nicht gerichtet — es stand bereits einer da (seit dem
Bildgruppen-Umbau), und übersehen wurde es trotzdem.

**Die Umstellung hat einen echten Fehler aufgedeckt.** 108 der 114
Referenzaufnahmen blieben pixelgleich; sechs nicht — `reise-detail` und
`admin-reise-vorschau`, je drei Breiten. Ursache:

```css
.bildgruppe {
  /* Kein eigener Aussenabstand: Den Abstand setzt der Behaelter
     (`[&>*+*]:mt-7` in travel-view.tsx) an EINER Stelle. */
  margin: 0;          ← tat GENAU DAS GEGENTEIL
}
```

Ungelayert schlug `margin: 0` die Utility des Behälters. Bildgruppen standen
also ohne Abstand — entgegen der Absicht, die im Kommentar daneben stand. Der
Code sagte das eine, der Kommentar das andere, und der Code gewann still.

Die Deklaration ist weg; Bildgruppen bekommen jetzt denselben Blockabstand wie
Text und Restaurants. Das ist eine SICHTBARE Änderung am Reisebericht, sie ist
hier benannt, und die sechs Aufnahmen sind gezielt neu genommen — nicht
pauschal.

---

## B8 — E2E-Specs schreiben in eine gemeinsame Datenbank — ERLEDIGT 08/2026

**Befund war.** `cms-paket.spec.ts` änderte über den Admin den Einleitungstext
der Reisen-Seite. Alles, was danach lief, sah den geänderten Stand — die
Referenzaufnahmen waren allein grün und im Verbund rot. Behoben war damals nur
das SYMPTOM (Referenz läuft als eigenes Projekt zuerst).

**Erledigt: die Ursache ist jetzt bewacht.** `server-mit-frischer-db.sh`
schreibt unmittelbar nach dem Seeden einen Fingerabdruck der
`setting`-Tabelle; `tests/e2e/zustand-ende.spec.ts` läuft als LETZTES
Playwright-Projekt und vergleicht. Bleibt etwas zurück, nennt die Meldung den
Schlüssel und beide Werte — statt „irgendeine Kontrolle drei Dateien später
ist rot".

**Dabei kam heraus, dass die Fläche größer ist als der Befund sagte.** Nach dem
Seeden ist die `setting`-Tabelle **leer**; alle zwölf Schlüssel, die am Ende
darin stehen, stammen aus Testläufen. Zwei Verursacher:

* `cms-paket.spec.ts` → `reisen_text_unten`. Das ist der Fall, der eine
  Kontrolle gebrochen hat. **Räumt jetzt auf** — und zwar durch ENTFERNEN des
  Schlüssels, nicht durch Leeren: Die Saat setzt ihn gar nicht, ein leerer Wert
  wäre ein anderer Zustand als keiner.
* Das Einstellungsformular (über `ki-schalter.spec.ts`) schreibt beim Absenden
  alle seine Felder mit, auch die leeren. Das IST der Test; diese elf Schlüssel
  stehen als **angemeldeter** Rückstand in `ERLAUBTER_RUECKSTAND` — jeder mit
  Begründung.

**Warum eine Liste und keine erzwungene Rücksetzung überall:** Ein Test, der
das Einstellungsformular prüft, muss es absenden. Die Rückstände wegzuräumen
wäre Aufwand ohne Gegenwert. Der Wert liegt darin, dass die geteilte Fläche an
EINER Stelle sichtbar ist und alles Unangemeldete sofort auffällt. Ein zweiter
Test hält die Liste aktuell: Ein Eintrag, den kein Spec mehr hinterlässt, muss
weg — sonst wiegt die Liste in falscher Sicherheit.

**Gegenprobe gefahren:** Aufräumen in `cms-paket` entfernt →

```
Unangemeldeter Rückstand:
  reisen_text_unten: NEU ("**E2E-Text NACH der Weltkarte.**")
```

**Was bewusst NICHT geprüft wird:** Inhalte, die ein Spec anlegt (ein Rezept,
ein Kontakt). Die sind additiv und stören keine andere Kontrolle; sie
mitzuprüfen hieße, jedem Spec das Aufräumen seiner Fixtures aufzuzwingen, ohne
dass ein Schaden dem gegenüberstünde.

---

## B9 — Die Rasterungsumgebung ist nicht festgelegt — WURZEL BENANNT UND VERDRAHTET 08/2026, Restschritt offen

**Was der Befund sagte.** Die Referenzaufnahmen reproduzieren auf dem CI-Läufer
nicht; „der Läufer rastert Schrift anders". Das war richtig beobachtet und zu
vage, um daran etwas zu reparieren.

**Nachgemessen ist es schärfer — es sind ZWEI CHROMIUM-BUILDS:**

```
Playwright 1.62.1 verlangt     Revision 1234  (Chrome for Testing 151.0.7922.34)
diese Umgebung hat             Revision 1194  (Chromium 141.0.7390.37)
CI installiert                 Revision 1234
```

`playwright.config.ts` nahm das vorinstallierte Chromium **still**, sobald es
da war. Aufgenommen wurde also mit dem einen Build, verglichen mit dem anderen.
Dass Text dann anders umbricht und Seiten unterschiedlich hoch werden, ist
keine Überraschung mehr, sondern die Folge.

**Was jetzt gilt.** Neben jeder Basis liegt `AUFNAHME-UMGEBUNG.txt` mit der
Browser-Kennung. Die Referenz prüft sie beim Start:

* Stempel passt → es wird verglichen, **auch in CI**. Die Bedingung
  `!process.env.CI` ist weg; über die Gültigkeit entscheidet der Browser, nicht
  die Umgebungsvariable.
* Stempel passt nicht → **übersprungen mit Begründung**. Eine Messung, die auf
  diesem Build nicht gültig ist, darf weder grün noch rot behauptet werden. Die
  Toleranz bleibt bei 0,002.

`playwright.config.ts` bevorzugt außerdem Playwrights eigenen (gepinnten)
Build; das vorinstallierte Chromium ist nur noch Rückfallweg.

**Ein Fehler dabei, gefunden durch Nachstellen:** Der erste Anlauf schrieb den
Stempel bei JEDEM Lauf neu — `updateSnapshots` steht standardmäßig auf
`"missing"`, nicht auf `"none"`, die Bedingung war immer wahr. Der Wächter hat
also nichts bewacht. Gegenprobe: Stempel von Hand auf `chromium 999.0.0.0`
gesetzt, normaler Lauf — 33 grün, Stempel danach wieder auf dem laufenden
Browser. Jetzt wird nur bei `--update-snapshots` gestempelt; dieselbe
Gegenprobe ergibt **33 übersprungen, Stempel unverändert**.

**RESTSCHRITT (offen).** Die eingecheckte Basis trägt `chromium 141.0.7390.37`
(Revision 1194) — den Build dieser Sandbox. Damit CI wirklich vergleicht, muss
die Basis einmal auf dem gepinnten Build (1234) aufgenommen werden:

```
npx playwright install chromium
npx playwright test seiten-referenz admin-referenz --update-snapshots
```

Hier ist das nicht möglich: Der Download scheitert an der Netzpolitik
(`Failed to download Chrome for Testing 151.0.7922.34`). Es braucht eine
Umgebung, die den Browser laden darf. Danach ist ohne weitere Code-Änderung ein
echtes CI-Gate daraus geworden — bis dahin meldet CI ehrlich „übersprungen,
weil anderer Browser" statt 114 rätselhafter Pixelabweichungen.

---

## B10 — Unbenutzte Importe röten das Gate nicht — ERLEDIGT 08/2026

**Befund war.** Nach dem Umbau der Brotkrume blieben VIER Importe stehen, die
niemand mehr brauchte. `tsc --noEmit` sieht das nicht, ESLint meldete es als
**Warnung** — `npm run lint` blieb grün, und das Gate liest nur Fehler.

**Erledigt.** Erst die acht Bestandsfälle aufgeräumt, dann
`@typescript-eslint/no-unused-vars` für `src/**` auf `error`. In `tests/` bleibt
es eine Warnung: Dort darf aus guten Gründen mal eine Hilfsvariable stehen.

Aufgeräumt wurde nicht nur weggestrichen — eine Fundstelle war ein echter
Defekt: `recipe-editor.tsx` hielt `taxonomyOptions` in `useState`, ohne den
Setzer je zu rufen. Das ist kein Zustand, das ist eine **eingefrorene Prop**:
Eine spätere Änderung von `taxonomies` wäre nie angekommen. Jetzt ein
abgeleiteter Wert.

**Zwei Anläufe, und der erste wirkte nicht.** Die Verschärfung stand zuerst vor
einem späteren, globalen Block, der dieselbe Regel wieder auf `warn` setzt — in
der Flat-Config gewinnt der letzte Eintrag. Der Lauf war grün, die Regel hatte
keine Wirkung. Gegenprobe gefahren: toter Import in `hero-slider.tsx`,
`npx eslint src` — erst `warning`, nach dem Verschieben `error`, und in `tests/`
weiterhin `warning`.
