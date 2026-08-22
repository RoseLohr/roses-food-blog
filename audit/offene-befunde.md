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

---

## B12 — Zwei Sicherungen, die es nur auf dem Papier gab — ERLEDIGT 08/2026

Dritte Runde der Gegenprüfung zu PR #110 (gpt-5.6-sol). Beide Befunde haben
dieselbe Form wie die beiden davor, und die Form ist das Eigentliche: **eine
Sicherung, die still nicht da ist.**

**1. Der Alarm lief gegen ein Image ohne Alarmskript.** `alarm_absetzen` nahm
das erstbeste VORHANDENE Image (`:previous`, sonst `:latest`). Beim ERSTEN
Ausrollen dieser Änderung ist `:previous` aber der Stand von vorher — und der
kennt `scripts/betriebsalarm.mjs` gar nicht. podman brach ab, übrig blieb eine
Zeile im Protokoll, und niemand bekam eine Nachricht. Eine Meldekette, die
ausgerechnet beim ersten Ernstfall schweigt, ist keine. Gewählt wird jetzt das
erste Image, das das Skript WIRKLICH enthält; nach dem Build wird die Wahl neu
getroffen, damit die Alarme des Health-Gates das frische `:latest` nutzen.

**2. Ein nicht aktivierbarer Wachhund-Timer kostete nur einen Hinweis.** Der
Deploy lief grün weiter, und `restart: always` hatte damit keine Obergrenze
mehr — genau die Lage vom 2026-08-10, elf Stunden Ausfall. Dazu war der
angebotene Cron-Ersatz ein VORGESCHLAGENER Workaround, was CLAUDE.md
ausdrücklich verbietet. Jetzt wird der Zustand nachgesehen statt dem
Rückgabewert von `enable --now` geglaubt (`is-active`), ein Zeuge
`wachhund-ok` hinterlegt — dieselbe Mechanik wie `deploy-unit-ok` bei der
Panel-Freigabe — und der Lauf endet mit Fehlschlag samt eigenem Alarm.

Zwei Feinheiten, die dabei zu entscheiden waren:

* Der Image-Zeuge `deploy-image-ok` wird TROTZDEM geschrieben. Das Image ist
  nicht schlechter, weil ein Timer fehlt; ließe man den Zeugen weg, verlöre die
  Rollback-Kette ihren einzigen bekannt guten Stand — ein zweiter Schaden aus
  einem ersten.
* Der Schnellpfad-State `deploy-state` wird BEWUSST NICHT geschrieben. Stünde
  er da, meldete der nächste Lauf „Bereits aktuell" und übersprünge alles —
  auch den zweiten Versuch, den Wachhund zu installieren. Der Fehler
  reparierte sich dann nie.
* Der Alarm von `fail()` nennt den Rollback als nächsten Schritt. Hier wäre das
  falsch: Die Anwendung läuft. Deshalb setzt der Wachhund-Pfad seinen eigenen
  Alarm ab, und `fail()` schickt keinen zweiten hinterher.

**Und die Prüfung ist diesmal eine Prüfung.** In diesem Zweig sind schon drei
Wächter aufgefallen, die grün waren und nichts bewachten; ein
`expect(skript).toMatch(/is-active/)` wäre der vierte gewesen.
`tests/deploy-betriebsabsicherung.test.ts` schneidet die Funktionen deshalb
AUS `deploy.sh` heraus — samt ihrer Startwerte, denn abgeschriebene Startwerte
wären dieselbe Falle wie die abgeschriebene CSS-Datei in B11 — und fährt sie
gegen ein vorgetäuschtes podman/systemctl. Gegenprobe: Wird die Bildwahl auf
die alte, naive Fassung zurückgedreht, fallen genau die zwei
Verhaltensfälle um.

---

## B13 — Selbstprüfung des Betriebspfades: vier bestätigte Befunde — ERLEDIGT 08/2026

Nachdem der Pflicht-Approver in PR #110 **dreimal** echte Defekte im selben
Pfad gefunden hatte, ist der Betriebs-/Rollback-Pfad einmal geschlossen
gegengeprüft worden: fünf unabhängige Linsen über `deploy.sh`,
`deploy/rollback.sh`, `deploy/wachhund.sh`, `scripts/wachhund.mjs`,
`scripts/betriebsalarm.mjs` und die zugehörigen Tests, jeder Befund danach von
zwei Skeptikern mit dem Auftrag, ihn zu WIDERLEGEN (im Zweifel gilt er als
widerlegt). Vier haben das überstanden, einer ist gefallen.

**1. `deploy/rollback.sh:52` — ein `case` ohne `*)`.** Jedes unbekannte
Argument wurde stillschweigend verworfen. Nachgestellt: `--dryrun` (Tippfehler)
ließ `DRY=0` und fuhr den ECHTEN Rollback; `--with_db` rollte das Image zurück,
ohne die Datenbank mitzunehmen. Wer sich unter Zeitdruck vertippt, bekommt
jetzt einen Abbruch.

**2. `deploy/rollback.sh:205` — der Stopp wurde nur versucht, nie
festgestellt.** Beide Zeilen werfen ihren Rückgabewert weg (`|| true`), und
danach prüfte NICHTS, ob der Container weg ist — obwohl die Überschrift des
Abschnitts das Stoppen zur Voraussetzung für jeden Eingriff an der Datenbank
erklärt. Nachgestellt mit einem podman, dessen `rm` fehlschlägt: Das Skript
legte das Backup unter der noch offenen SQLite-Verbindung ab, löschte deren
`-wal` und meldete „Rollback erfolgreich (Health grün)" — den Health-Ping hatte
der ALTE Container beantwortet. Exit 0. Das passende Idiom
(`podman container exists`) stand sechs Zeilen höher und wurde nur zum Sichern
des Protokolls benutzt.

**3. `deploy/wachhund.sh:32` — „Image vorhanden" heißt nicht „Image kann
urteilen".** `scripts/wachhund.mjs` kam erst mit diesem Zweig in die
Containerfile; jedes ältere Image kennt es nicht. Der Lauf fiel dann in
`|| { … exit 0; }` und meldete Erfolg — ein Wachhund, der bei jedem Weckruf
zufrieden wieder einschläft, und ein Timer, der grün aussieht. Jetzt wird der
Inhalt geprüft, und ein nicht ermittelbares Urteil beendet den Lauf mit 1
statt mit 0 (eingegriffen wird weiterhin nicht — ohne Urteil weiß niemand, ob
eingegriffen gehört).

**4. `deploy/wachhund.sh:64` — der Alarm-Container bekam die SMTP-Umgebung
nicht.** Die Zugangsdaten stehen laut README in der `.env`, nicht in der
`setting`-Tabelle; `bootstrap.sh` legt sie ausschließlich dort ab. Das Skript
lädt sie in die HOST-Shell, startete den Alarm aber mit nur `-e DATA_DIR`.
`betriebsalarm.mjs` fand keinen Host, meldete „NICHT verschickt" und endete mit
0 — das einzige Netz (`|| log "WARNUNG…"`) konnte prinzipiell nie greifen.
Derselbe Fehler stand in `deploy.sh`. Besonders bitter: Der Env-Weg ist in
`betriebsalarm.mjs` vorgesehen UND getestet
(`tests/betriebsalarm.test.ts`, „nimmt die Umgebung, wenn die Datenbank nichts
hergibt") — nur konnte ihn kein Aufrufer erreichen. Ein grüner Test über einem
unerreichbaren Pfad. Dabei fiel auf, dass der Rückfall ohnehin unvollständig
war: Host, Port und Absender kannten ihn, die ANMELDUNG nicht.

**Gefallen (nicht behoben):** „Ein LEERES Backup besteht alle drei
Vorprüfungen." Die technische Aussage stimmt — eine 0-Byte-Datei ist für SQLite
eine gültige leere Datenbank, `integrity_check` liefert `ok`. Widerlegt sind
aber Entstehung und Folge: better-sqlite3 räumt eine abgebrochene Sicherung
selbst weg (`backup.cpp:29`), es bleibt nur ein `-journal`, das der Glob
`pre-deploy-*.db` nicht trifft. Übrig bleibt ein Rennen von rund 28 ms, und
selbst dann liegt der vorherige Stand vollständig als `pre-rollback-*.db` da.
Eine Inhaltsprüfung würde zudem ein ehrliches leeres Backup fälschlich
abweisen.

**Und zweimal hat die Attrappe über den Prüfling gelogen** — dieselbe Klasse
wie B11. Einmal meldete das falsche `podman` für `app.db` immer den alten
Schema-Stand, auch nachdem das Backup daraufkopiert war; einmal las es die
SMTP-Werte aus seiner EIGENEN Umgebung statt aus den `-e`-Argumenten und war
damit auch gegen den defekten Stand grün. Beide Attrappen sagen jetzt die
Wahrheit, und gegen den jeweils vorigen Stand fallen die Fälle korrekt um.

---

## B14 — Elf weitere Befunde aus derselben Prüfung — SECHS DAVON ERLEDIGT 08/2026

Die Gegenprüfung war auf sechs Befunde gedeckelt; die folgenden sind gefunden,
aber zunächst weder von Skeptikern geprüft noch behoben worden. Sie standen
hier als Verdachtsmomente mit Fundstelle, ausdrücklich unbestätigt.

**Nachtrag — der Pflicht-Approver hat drei davon unabhängig bestätigt**
(gpt-5.6-sol, PR #110, Runde 4): die Nummern 3, 4 und 6. Sie sind damit keine
Verdachtsmomente mehr und behoben:

* **Nr. 3 — das Einspielen war nicht atomar.** `cp` schrieb direkt auf
  `app.db`, das Entfernen von `-wal`/`-shm` kam danach. Ein Abbruch dazwischen
  hinterließ neues `app.db` neben altem WAL — genau die Kombination, die SQLite
  beim nächsten Öffnen zum stillen No-op macht (B3/1). Jetzt in drei Schritten,
  von denen kein Zwischenstand gefährlich ist: in eine Nebendatei kopieren,
  dann WAL und SHM entfernen, dann atomar umbenennen. Bricht es nach Schritt 2
  ab, bleibt das ALTE `app.db` ohne WAL zurück — der letzte festgeschriebene
  Stand, in sich stimmig, und der vollständige alte Stand liegt ohnehin als
  `pre-rollback-*.db` daneben.
* **Nr. 4 — der Wachhund-Stand wurde ungeprüft und nicht atomar geschrieben.**
  Die Umlenkung kürzt die Datei, bevor sie schreibt; bei voller Platte blieb
  eine leere zurück, der nächste Lauf las „kein Stand", `rotSeit` fing wieder
  bei 1 an — und die Stoppschwelle wurde NIE erreicht. Bitter, weil eine volle
  Platte einer der klassischen Auslöser genau dieser Schleife ist. Jetzt über
  eine Nebendatei mit `mv`, und ein misslungenes Schreiben beendet den Lauf mit
  1 (nach dem Handeln, damit ein echter Stopp oder Alarm nicht ausbleibt).
* **Nr. 6 — der No-op-Wächter hing an einer Regex auf dem eigenen Kommentar.**
  `/identisch/i` und `/previous.*latest/s` trafen den Kommentar über der
  Prüfung; man hätte die Prüfung ersatzlos streichen können, und der Test wäre
  grün geblieben. Der Textvergleich läuft jetzt über den Quelltext OHNE
  Kommentare, und dass der Rollback bei gleichen Image-IDs wirklich abbricht,
  misst `tests/rollback-ablauf.test.ts` am laufenden Skript.

**Zweiter Nachtrag.** Nach der fünften Veto-Runde sind die restlichen Punkte
IM ZWEIG nicht mehr abgewartet, sondern selbst geprüft und behoben worden —
die Nummern 1, 2 und 7. Fünf Runden haben gezeigt, dass ein Verdacht in einer
Datei, die dieser Zweig ohnehin umbaut, nicht liegen bleiben sollte: Er kommt
als Veto zurück.

**Was bewusst OFFEN bleibt — und warum:**

* **Nr. 5 (`scripts/wachhund.mjs:59`)** ist die einzige der Beobachtungen, die
  eine echte ENTWURFSÄNDERUNG verlangt, nicht eine Absicherung. Heute setzt
  eine gesunde Messung `neuerStand: null` und verwirft damit auch den
  Neustartzähler; eine Schleife, die zwischendurch kurz gesund aussieht (etwa
  ein OOM-Kill nach dem Warmlaufen), erreicht die Schwelle von drei
  ununterbrochen roten Beobachtungen nie. Das Zurücksetzen selbst ist
  ABSICHTLICH (ein überstandener Holperstart darf sich nicht anrechnen), und
  die kleine Variante — den Zähler behalten, nur `rotSeit` nullen — schließt
  die Lücke NICHT, weil die Schleifenbedingung weiterhin an `rotSeit` hängt.
  Es braucht ein zusätzliches Kriterium („der Neustartzähler ist seit der
  ersten Beobachtung um mehr als N gestiegen"), also neuen Zustand und eine
  neue Schwelle. Das ist ein Eingriff in eine Sicherheitskomponente, den
  niemand angefordert hat und der bisher von keiner Gegenprüfung bestätigt
  wurde. Er gehört in einen eigenen Schritt mit eigener Messung, nicht als
  Beifang in diesen Zweig.

Die beiden vorbestehenden Punkte außerhalb des Zweigs (Nummern 8 und 9)
bleiben ebenfalls offen und unbestätigt.

Im Zweig von PR #110 (also selbst verursacht, gehört zuerst geprüft):

1. ~~`deploy/rollback.sh:74`~~ — ERLEDIGT 08/2026. Der Probelauf endet jetzt
   NACH den Vorprüfungen statt vor ihnen; alles oberhalb ist lesend, er kann
   sie also vollständig fahren, ohne etwas anzufassen. Vier Fälle in
   `tests/rollback-ablauf.test.ts`, alle vier fallen gegen den vorigen Stand.
2. ~~`deploy/rollback.sh:231`~~ — ERLEDIGT 08/2026. Die Sicherung des jetzigen
   Standes läuft jetzt durch denselben `integrity_check` wie das eingehende
   Backup, und zwar bevor die Datenbank ersetzt wird — später ginge es nicht
   mehr.
3. ~~`deploy/rollback.sh:238`~~ — ERLEDIGT, siehe oben.
4. ~~`deploy/wachhund.sh:53`~~ — ERLEDIGT, siehe oben.
5. `scripts/wachhund.mjs:59` — ein einziger gesunder Augenblick setzt
   `neuerStand: null` und verwirft damit auch den Neustartzähler. Eine
   flatternde, aber echte Schleife würde nie erkannt.
6. ~~`tests/deploy-betrieb.test.ts:314`~~ — ERLEDIGT, siehe oben.
7. ~~`scripts/regime/rollback-check.mjs:54`~~ — ERLEDIGT 08/2026. Die literale
   Alternative ist raus; geblieben ist die strukturelle Prüfung, dass nach der
   Health-Schleife ein `fail` oder `exit 1` steht. Gegenprobe: Ersetzt man das
   `fail` durch ein `log`, wird das Gate rot (vorher blieb es grün).

Außerhalb dieses Zweigs (vorbestehend, hier nur notiert):

8. `deploy/backup.sh:33` — meldet Erfolg, wenn das DB-Backup fehlschlägt, und
   rotiert die letzten vorhandenen trotzdem weg. Das nächtliche Cron läuft ohne
   Login-Session, wo rootless `podman run` scheitern kann.
9. `scripts/regime/restore-drill.sh:38` — der Drill belegt B-31 über einen Weg,
   den der Betrieb nicht geht: eigene Quelle, Host-node statt `deploy/backup.sh`,
   `cp` in ein leeres Verzeichnis.

Sowie zwei Beobachtungen ohne eigene Fundstelle: das Health-Gate des Rollbacks
verwirft den Antwortrumpf, obwohl `/health` den `commit` liefert (es könnte
also feststellen, WELCHER Stand antwortet); und `$COMPOSE up -d` im Rollback
kennt kein `--force-recreate`, anders als die Schwesterstelle in `deploy.sh`
— seit Befund 2 oben ist das aber entschärft, weil der Container davor
nachweislich weg ist.

