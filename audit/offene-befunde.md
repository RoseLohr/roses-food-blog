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

Der Archivvertrag ist additiv geblieben: Ein Archiv von vor dem Umbau bringt
`groesse` noch mit, ohne den Import zu kippen (festgehalten in
`tests/data-transfer.integration.test.ts`).

**Nachtrag 08/2026 — dieser Eintrag stand hier falsch.** Er sagte „Der
Bildblock trägt keine Layout-Felder mehr". Das war der Zustand zwischen 0012
und dem Bildsteuerungs-Umbau; seither trägt er wieder drei: `gruppe`,
`groesse`, `ausrichtung`. Export und Import führen alle drei (siehe
`src/lib/data-transfer/types.ts`). Der Unterschied zur alten, verworfenen
Fassung ist nicht die Anzahl der Felder, sondern worüber sie sprechen: Jedes
beschreibt seinen EIGENEN Block. Das verworfene `mitVorherigem` beschrieb
seinen Nachbarn.

---

## B5 — Referenzaufnahmen decken den Admin nicht ab — ERLEDIGT 08/2026

**Befund war.** `seiten-referenz.spec.ts` hielt elf ÖFFENTLICHE Seitentypen an
drei Breiten fest. Für `/admin` gab es keine einzige Aufnahme; fünf der zwölf
Reduktions-Kandidaten lagen dort und waren damit nicht abnehmbar.

**Erledigt** mit `tests/e2e/admin-referenz.spec.ts`: 27 Admin-Seiten × drei
Breiten = 81 Aufnahmen, 8,1 MB (seit der Bildsteuerung 28 Seiten = 84
Aufnahmen — der Reise-Editor kommt zweimal vor, einmal mit Gruppe und einmal
mit Einzelbildern, weil sonst die Hälfte der Bedienung unfotografiert bliebe). Die Mechanik (Breiten, Warten, Masken,
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

## B11 — Ein Prüfstand bewies Regeln, die die Seite nicht auslieferte — ERLEDIGT 08/2026

**Befund.** `tests/e2e/mocks/einzelbild.html` hielt die geprüften CSS-Regeln
als ABSCHRIFT in einem eigenen `<style>`. Der Prüfstand maß damit nicht die
ausgelieferte Seite, sondern eine Kopie — und beide durften auseinanderlaufen,
ohne dass irgendetwas rot wurde.

**Beleg, und zwar sofort.** Beim Umstellen auf die echte Datei fielen auf
Anhieb fünf Fälle um (`s/m/l × links/rechts @ 360 px`): Die Abschrift kannte
die Medienabfrage `@media (max-width: 639px)` nicht, mit der ein Einzelbild
unter 640 px über die volle Breite steht. Der Prüfstand war ein halbes
Dutzend Fälle lang grün für ein Verhalten, das die Seite nie hatte.

**Wurzel behoben.** Die Regeln liegen jetzt in `src/app/einzelbild.css`.
`globals.css` bindet sie per `@import "./einzelbild.css" layer(components)`
ein — mit `layer(...)`, weil ungelayertes CSS sonst jede Tailwind-Utility
schlüge (B7). Der Prüfstand lädt dieselbe Datei per `<link>`; deshalb steht
dort reines CSS ohne Tailwind-Syntax, damit eine `file://`-Seite es laden
kann. Eine Abschrift gibt es nicht mehr.

**Was dabei noch herauskam.** Die Zusage „ein linkes und ein rechtes Bild
dürfen nebeneinander" war nie gemessen worden. Nachgemessen an echtem
Chromium (816 px Spalte): `s` links + `m` rechts ließ dem Text ACHT Zeilen à
rund 49 px — fünf Zeichen je Zeile. Jetzt gilt `clear: both` für jedes
Einzelbild. Der Prüfstand zählt seither Zeilen unter einem Viertel der Spalte
statt die schmalste zu messen: Am Übergang von einem Float zum nächsten liegt
IMMER eine kurze Zeile, und an der war die erste Fassung der Kontrolle
hängengeblieben (sie hätte den behobenen Zustand weiter als Fehler gemeldet).

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

## B14 — Elf weitere Befunde aus derselben Prüfung — SIEBEN DAVON ERLEDIGT 08/2026

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

**Dritter Nachtrag — auch Nr. 5 ist erledigt.** Sie war hier als bewusst offen
vermerkt, mit der Begründung, sie verlange eine Entwurfsänderung und sei von
keiner Gegenprüfung bestätigt. Runde 6 hat sie bestätigt, und zwar als
einzigen Blocker. Damit war die Begründung hinfällig.

Der Entwurf steht jetzt auf ZWEI Kriterien nebeneinander:

* **(a) Der Zähler wächst.** `RestartCount` ist monoton, solange der Container
  derselbe ist. Wächst er innerhalb von `FLATTER_FENSTER` (6) Beobachtungen um
  `NEUSTART_GRENZE` (5), IST das eine Schleife — unabhängig davon, wie die
  einzelne Gesundheitsmessung ausfällt. Damit ist der OOM-Fall erfasst, der
  bei jeder zweiten Messung gesund aussieht.
* **(b) Durchgehend rot und steigend** — der alte Fall, unverändert.

Zwei Entscheidungen dabei, die nicht offensichtlich sind:

* **Was gerade antwortet, wird nicht gestoppt.** Trifft (a) auf eine gesunde
  Messung, wird nur gemeldet. Einen laufenden Dienst abzuschalten, weil er eine
  halbe Stunde zuvor geflattert hat, wäre der Ausfall, den der Wachhund
  verhindern soll.
* **Ein sinkender Zähler setzt das Fenster zurück.** Jeder Deploy legt den
  Container neu an, `RestartCount` fängt bei 0 an; ohne diese Unterscheidung
  addierte man die Neustarts zweier verschiedener Container.

**Und dabei wäre die Reparatur um ein Haar wirkungslos geblieben.** Die CLI in
`scripts/wachhund.mjs` baute `vorher` aus einer WEISSEN LISTE mit `neustarts`
und `rotSeit` zusammen. Die neuen Fensterfelder fielen damit bei jedem Aufruf
weg — das Fenster hätte über Läufe hinweg nie wachsen können, die Erkennung
wäre im Betrieb tot gewesen, und ALLE Tests von `beurteile()` wären grün
geblieben, weil sie die Funktion direkt rufen. Aufgefallen ist es nur beim
echten Durchlauf durch die CLI, nicht im Test. `tests/wachhund.test.ts` fährt
deshalb jetzt zusätzlich die CLI selbst — samt Stand aus der alten Fassung und
unlesbarem Müll. Gegenprobe: Nimmt man allein die weiße Liste zurück und lässt
`beurteile()` unangetastet, fallen genau diese CLI-Fälle um; die zwölf
übrigen bleiben grün.

Die beiden vorbestehenden Punkte außerhalb des Zweigs (Nummern 8 und 9)
bleiben offen und unbestätigt.

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
5. ~~`scripts/wachhund.mjs:59`~~ — ERLEDIGT 08/2026, siehe unten.
6. ~~`tests/deploy-betrieb.test.ts:314`~~ — ERLEDIGT, siehe oben.
7. ~~`scripts/regime/rollback-check.mjs:54`~~ — ERLEDIGT 08/2026. Die literale
   Alternative ist raus; geblieben ist die strukturelle Prüfung, dass nach der
   Health-Schleife ein `fail` oder `exit 1` steht. Gegenprobe: Ersetzt man das
   `fail` durch ein `log`, wird das Gate rot (vorher blieb es grün).

Außerhalb dieses Zweigs (vorbestehend, hier nur notiert):

8. ~~`deploy/backup.sh:33`~~ — ERLEDIGT 08/2026, siehe B16.
9. ~~`scripts/regime/restore-drill.sh:38`~~ — ERLEDIGT 08/2026, siehe B17.

Sowie zwei Beobachtungen ohne eigene Fundstelle: das Health-Gate des Rollbacks
verwirft den Antwortrumpf, obwohl `/health` den `commit` liefert (es könnte
also feststellen, WELCHER Stand antwortet); und `$COMPOSE up -d` im Rollback
kennt kein `--force-recreate`, anders als die Schwesterstelle in `deploy.sh`
— seit Befund 2 oben ist das aber entschärft, weil der Container davor
nachweislich weg ist.

---

## B15 — Die Reparatur eines Befundes war selbst eine Lücke — ERLEDIGT 08/2026

**Befund (gpt-5.6-sol, PR #110, Runde 7).** Um den stummen Alarm zu beheben
(B13/4), reicht `deploy.sh` und `deploy/wachhund.sh` die SMTP-Zugangsdaten in
den Alarm-Container. Geschrieben war das als `-e VAR=Wert` — damit steht
`SMTP_PASS` im Klartext in der Argumentliste von podman, und die liest jeder
lokale Nutzer aus der Prozessliste oder aus `/proc/<pid>/cmdline`, solange der
Alarm läuft.

Das ist ein Geheimnis in einer Prozesszeile, also dieselbe Familie wie B-06,
nur zur Laufzeit statt im Quelltext — und es war MEINE Reparatur, die es
eingeführt hat. Zwei Runden zuvor war der Alarm stumm; die Behebung machte ihn
laut und undicht zugleich.

**Wurzel behoben.** `-e VAR` OHNE Wert: podman nimmt den Wert aus seiner
eigenen Umgebung und reicht ihn weiter, auf der Befehlszeile steht nur der
Name. Die Variable wird dafür ausdrücklich exportiert, damit es nicht davon
abhängt, wie der Aufrufer sie gesetzt hat. Nicht gesetzte Variablen werden
weiterhin gar nicht genannt — ein leerer Wert im Container würde den Rückfall
auf die `setting`-Tabelle aushebeln.

Belegt an BEIDEN Aufrufstellen (`tests/wachhund-verdrahtung.test.ts` und
`tests/deploy-betriebsabsicherung.test.ts`): Der Wert taucht in keiner
podman-Argumentliste auf, der Name sehr wohl — und die Attrappe zeigt zugleich,
dass der Wert in ihrer Umgebung ankommt, also weitergereicht werden kann.
Gegenprobe gegen den vorigen Stand: beide Fälle fallen um.

**Anmerkung zur Runde.** Die beiden anderen Stimmen des Panels haben in
derselben Runde Punkte genannt, die auf diesem Stand nicht mehr zutreffen (der
Container-Stopp im Rollback ist seit Runde 4 geprüft, die SMTP-Übergabe seit
Runde 3/4 vorhanden). Nachgesehen und verworfen; der Pflicht-Approver hatte
recht, die dritte Stimme las einen älteren Stand.

---

## B16 — Ein Backup-Lauf, der Erfolg meldet und nichts gesichert hat — ERLEDIGT 08/2026

**Befund (B14/8, vorbestehend).** `deploy/backup.sh` meldete Erfolg, wenn das
DB-Backup fehlschlug: ein `echo "WARNUNG…"` und Exit 0. Für Cron war der Lauf
in Ordnung. Und die Rotation lief danach UNBEDINGT weiter — nach vierzehn
Fehlläufen in Folge war kein Backup mehr da. Gemerkt hätte es erst, wer eines
gebraucht hätte. Das nächtliche Cron läuft ohne Login-Session, wo rootless
`podman run` scheitern kann; der Fall ist also nicht theoretisch.

**Beim Nachlesen kamen drei weitere Fehler im selben Block heraus:**

* Lief `podman` durch und scheiterte erst `gzip`, löschte der Aufräum-Zweig
  eine GÜLTIGE unkomprimierte Sicherung. Er unterschied nicht, was er wegwarf.
* Die Sicherung wurde nie GELESEN. Nur der Exit-Status von `db.backup()`
  zählte. `deploy/rollback.sh` prüft jedes Backup mit `integrity_check`, bevor
  es sich darauf verlässt — die Stelle, die es ERZEUGT, tat es nicht.
* Ein `podman`, das 0 meldet und nichts schreibt, ergab einen „erfolgreichen"
  Lauf ganz ohne Backup. **Diesen dritten Fehler hat erst der Test gefunden,
  nicht das Nachdenken** — er entstand in der Reparatur selbst und ist damit
  wieder ein Fall der Klasse „die Behebung war die nächste Lücke" (vgl. B15).

**Wurzel behoben.** Die Regeln, die das Skript jetzt trägt:

1. Ein Lauf ohne gültiges DB-Backup endet mit Exit ≠ 0.
2. Gelöscht wird nur, was ERSETZT ist: Rotation läuft nur für die Familie, für
   die dieser Lauf etwas Gültiges erzeugt hat — und die jüngste Datei bleibt
   IMMER liegen (`app-*.db` und `app-*.db.gz` sind EINE Familie).
3. Eine Sicherung gilt erst als gut, wenn sie DA ist (`-s`) und der
   `integrity_check` sie liest.
4. Ein gescheitertes `gzip` kostet die geprüfte Sicherung nicht.

Mitgenommen, weil es dieselbe Klasse ist: Die Konfigurations-Rangfolge ist jetzt
die von `rollback.sh` (Aufrufer > `.env` > Standard). Vorher überschrieb ein
blindes `set -a; source` die Angabe des Aufrufers — wer `DATA_DIR=… backup.sh`
rief, sicherte stillschweigend etwas anderes.

**Belegt in `tests/backup-lauf.test.ts` (11 Fälle), am AUSGEFÜHRTEN Skript**
gegen ein aufzeichnendes podman/gzip/tar. Gegenprobe gegen den vorigen Stand:
zehn der elf fallen um. Der elfte prüft, dass überhaupt rotiert wird, und muss
auf beiden Ständen grün sein; die neue Zusage „die jüngste Datei überlebt jedes
Alter" ist über einen normalen Lauf nicht erreichbar (wer rotiert, hat gerade
eine frische Datei erzeugt) und wird deshalb an der aus dem Skript
GESCHNITTENEN Funktion `rotieren()` einzeln geprüft — entfernt man die
Schutzregel, fällt genau dieser Fall.

---

## B17 — Der Restore-Drill übte einen Weg, den die Produktion nie geht — ERLEDIGT 08/2026

**Befund (B14/9, vorbestehend).** `scripts/regime/restore-drill.sh` stellte mit
`cp` in ein LEERES Verzeichnis wieder her. Die Produktion stellt über eine
LEBENDE Datenbank wieder her, neben der ein gefülltes `-wal` liegt — der
Container ist gerade hart weggenommen worden. Genau dieser Weg war
katastrophal kaputt (B3: SQLite spielte das alte WAL über das eingespielte
Backup, der Restore war ein stiller No-op und meldete Erfolg), und der Drill
blieb Monat für Monat grün, weil er ihn nie ging.

**Nachgemessen, statt angenommen.** Ein naives `cp` über `app.db` mit
liegengebliebenem WAL: die nach dem Backup geschriebenen Daten ÜBERLEBEN den
Restore. Mit der Dreierfolge (Nebendatei → WAL/SHM weg → `mv`): die Datenbank
trägt exakt den Inhalt des Backups.

**Wurzel behoben.** Nicht „der Drill baut den Ablauf richtiger nach" — der
Ablauf steht jetzt genau EINMAL, in `deploy/db-restore.sh`, und wird von
`deploy/rollback.sh` UND vom Drill GEQUELLT. Auseinanderlaufen ist damit keine
Frage der Disziplin mehr, sondern unmöglich. Der Drill:

* stellt über eine lebende Datenbank mit nachgewiesen gefülltem WAL wieder her
  (der Schreiber beendet sich mit SIGKILL, weil ein `close()` einen Checkpoint
  führe und genau die Bedingung beseitigte, um die es geht),
* fährt `db_einspielen` — denselben Aufruf wie der Ernstfall,
* führt eine NEGATIVKONTROLLE mit: derselbe Aufbau, naiv mit `cp`. Sie MUSS den
  Fehler zeigen; tut sie es nicht, kann der Drill die beiden Wege nicht
  unterscheiden, und er bricht ab statt grün zu melden,
* benennt im Beleg, was er NICHT abdeckt (podman, Container-Stopp,
  Image-Rollback, Uploads-Archiv).

**Und das Gate hält es fest.** `scripts/regime/rollback-check.mjs` prüft jetzt
zusätzlich `deploy/db-restore.sh` (drei Schritte in Reihenfolge, kein direktes
`cp` auf `app.db`, Fehlschläge münden in `fail`) und den Drill (quellt die
Produktionsfunktion, fährt sie, lebende DB, Negativkontrolle wird AUSGEWERTET).
Gegenprobe an den echten Dateien: Restore naiv gemacht → 2 Verstöße; `source`
im Drill entfernt → Verstoß; Negativkontrolle entfernt → Verstoß; `rollback.sh`
legt sich wieder ein eigenes `cp` hin → Verstoß.

**Belegt zusätzlich in `tests/rollback-wal.test.ts`:** Die Prüfung des
Einspielens führt jetzt die ECHTE Funktion aus, statt sie in TypeScript
nachzubauen — ein Nachbau ließe genau die Lücke, um die es hier geht.

**Beim Schreiben selbst hineingelaufen.** Der erste Aufbau kopierte nur
`app.db` in das Übungsverzeichnis. Der Seed hinterlässt aber ein 2 MB großes
`-wal`; die Daten standen also gar nicht in `app.db`, und der Drill arbeitete
ab da mit einer leeren Tabelle. Aufgefallen ist das ausschließlich, weil die
Negativkontrolle nicht anschlug — also an der Kontrolle, die eigens dafür da
ist. Ohne sie wäre ein grüner, wirkungsloser Drill entstanden: dieselbe Klasse
Fehler, die er beheben sollte.



## B18 — Die Referenzaufnahme sieht kleine Änderungen auf großen Seiten nicht — GEMESSEN 08/2026, offen

**Beobachtet beim Umbau der Zutatenzeile.** An jeder Zutat kamen zwei Knöpfe
dazu (↑ ↓). Der Lauf `npx playwright test admin-referenz` meldete das NICHT:
`admin-rezept-neu` und `admin-rezept-bearbeiten` blieben grün. Ebenso blieb
`reise-detail @ desktop-1280` grün, obwohl der Restaurant-Titel sich geändert
hatte — die beiden schmaleren Breiten derselben Seite schlugen an.

**Die Ursache ist die Toleranz, und sie ist kein Fehler.** Verglichen wird mit
`maxDiffPixelRatio: 0.002`, also 0,2 % der Bildpunkte. Auf einer 1280 × 2996
Punkte großen Aufnahme sind das rund 7 700 Punkte; zwei kleine Knöpfe
verändern weniger. Die Kontrolle ist damit nicht kaputt — sie ist eine Aussage
über die FLÄCHE einer Änderung, nicht über ihr Vorhandensein.

**Die Toleranz zu senken ist keine Lösung, und das ist gemessen, nicht
vermutet.** Derselbe Lauf mit `maxDiffPixelRatio: 0` meldete achtzehn
Abweichungen, darunter `admin-medien` und `saisonkalender` — zwei Seiten, die
diese Änderung nicht anfasst. Bei Null ist jedes Rasterrauschen ein Fund; die
Kontrolle würde bei jedem Lauf rot und wäre damit wertlos. Die 0,2 % sind der
Preis dafür, dass sie überhaupt benutzbar ist.

**Was daraus folgt, bis jemand es besser löst:** Wer eine kleine Änderung an
einer großen Seite macht, verlässt sich NICHT darauf, dass der Referenzlauf
sie meldet. Er benennt die betroffenen Seiten vorher selbst und nimmt sie mit
`--update-snapshots=all` gezielt neu auf — `--update-snapshots` allein schreibt
nur die Dateien neu, deren Unterschied über der Toleranz liegt, und lässt
genau die zurück, die hier gemeint sind. Bei diesem Umbau waren das
`admin-rezept-neu`, `admin-rezept-bearbeiten` und `reise-detail @ desktop-1280`:
sechs Basisbilder, die sonst eine Oberfläche gezeigt hätten, die es nicht mehr
gibt.

**Denkbare Wurzel-Lösung, noch nicht gebaut:** je Seite einen Ausschnitt
aufnehmen statt der ganzen Seite (`clip`), damit die Bezugsfläche zur Größe der
Sache passt, über die die Aufnahme etwas aussagen soll. Das ist ein eigener
Umbau der Mechanik in `tests/e2e/referenz.ts` und gehört nicht in eine
Funktionsänderung.

## B19 — Eine stumme Prüfstimme galt als Ablehnung — ERLEDIGT 08/2026

**Befund.** Das Fremd-Vendor-Panel (`scripts/regime/independent-verify.mjs`)
wiederholte einen Versuch nur, wenn die ZUSTELLUNG scheiterte: Netzfehler,
5xx, 429, 401. Antwortete der Endpunkt dagegen mit HTTP 200 und einer
Nutzlast ohne verwertbares `refuted`, zählte das als abgegebene Stimme — ohne
jeden weiteren Versuch.

Beobachtet an PR #122, zweimal hintereinander: `combo/SOTA-C` lieferte
`refuted=undefined confidence=undefined` und „(keine Begründung geliefert)".
Der Strikt-Modus blockte daraufhin — mit der Meldung

    ⛔ Strikt-Modus: combo/SOTA-C refutiert (confidence=?) → fail-closed

Zwei Dinge daran waren falsch:

1. **Die Behandlung.** Eine leere Nutzlast ist kein Urteil, sondern derselbe
   Ausfall wie ein abgerissenes Netz, nur eine Schicht höher. Sie gehört in
   dieselbe Wiederholung. Ohne sie war der einzige Weg zurück, den ganzen Job
   neu zu starten — was beim zweiten Mal genauso endete.

2. **Die Meldung.** „refutiert" schickt den Leser auf die Suche nach einem
   Befund, den es nicht gibt. Genau das ist hier passiert: Der Quelltext wurde
   nach einem Fehler abgesucht, den keine Stimme je behauptet hatte.

**Wurzel behoben.** Die Frage „ist das eine Stimme?" steht jetzt einmal
(`istStimme`) statt dreimal wortgleich als lokales `isValid`, und
`zustellung()` entscheidet in EINER reinen Funktion zwischen „stimme",
„erneut" und „endgueltig". Eine zugestellte Nicht-Antwort ist „erneut".

**Das Gate wird dadurch NICHT weicher.** Sind alle drei Versuche verbraucht,
blockt die Nicht-Antwort weiterhin — nur eben nach drei Anläufen statt nach
einem, und mit der Begründung „ohne verwertbares Urteil" statt „refutiert".

### Der erste Anlauf hielt genau diesen Satz NICHT — und das Panel hat es gesehen

Er etikettierte die erschöpfte Nicht-Antwort einfach auf `{ok:false}` um, wie
einen Netzfehler. `strictAnyRefutation` sieht aber nur Stimmen mit `ok`; die
stumme dritte Stimme blockte damit nicht mehr. Am Modell nachgerechnet:

    VORHER (200 + leere Nutzlast als Stimme): BLOCK
    NACHHER (auf ok:false umetikettiert)   : DURCH

Zwei grüne Stimmen plus eine stumme wurden also aus ROT ein GRÜN — das
Gegenteil der Zusage, die zwei Absätze weiter oben stand. Ein **fail-open**,
eingeführt von der Behebung eines fail-closed-Ärgernisses.

Zwei Stimmen des Panels haben es unabhängig benannt, und die zweite auch
gleich, warum mein Test es nicht fand: Er reichte `strictAnyRefutation` ein
von Hand gebautes `{ok:true, v:{}}` — einen Zustand, den die geänderte
Schleife gar nicht mehr liefert. **Grün für etwas, das die Produktion nicht
tat**: dieselbe Fehlerklasse, die dieses Verzeichnis seit Monaten sammelt, nur
diesmal in der Prüfung der Prüfung.

**Wurzel:** Ein Netzfehler und eine stumme Antwort sind NICHT dasselbe. Der
eine ist Zustellung, die andere ein Endpunkt, der antwortet und nichts sagt.
Für die Wiederholung zählt beides gleich, für das Urteil nicht. Die stumme
Stimme trägt deshalb ein eigenes Merkmal (`stumm`), und der Strikt-Modus
blockt sie — vor der `decide()`-Prüfung, weil sie dort mangels `ok` nie
ankäme. Ein reiner Netzfehler blockt weiterhin nicht; so war es vor B19 und so
bleibt es.

**Und der Test geht jetzt die ganze Kette.** Die Versuchsschleife steht als
`stimmeHolen(versuch, attempts, warte)` da, damit der `--selftest` sie WIRKLICH
fährt — von der Antwort des Endpunkts bis zum Urteil des Gates, ohne
Zwischenzustand von Hand. Gegenprobe zu beiden Hälften gefahren; jede lässt
genau die Zeile umfallen, die sie hält.

### Und der zweite Anlauf hatte dasselbe Loch eine Schicht tiefer

Das `stumm`-Merkmal lag nur in `last` — und `last` wird zu Beginn jedes
Versuchs überschrieben. Am Modell nachgerechnet:

    200+ungültig → 500 → 500   endete als {ok:false, status:500}
    200+ungültig → 400         kehrte sofort mit dem 400 zurück

Beide ohne `stumm`, also unsichtbar für den Strikt-Modus; mit zwei gültigen
Grün passierte der Rest der Gates. **Wieder ein fail-open**, gefunden von
derselben Stimme, die schon den ersten gefunden hatte.

**Wurzel:** Ein Endpunkt, der EINMAL geantwortet und nichts gesagt hat, ist
belegt stumm. Späteres Rauschen — Netzfehler, 5xx, auch ein deterministisches
400 — löscht diese Beobachtung nicht. Die Schleife merkt sie deshalb getrennt
(`warStumm`), nicht im überschriebenen Zwischenergebnis.

Reines Rauschen ohne je eine Antwort bleibt dagegen ein Zustellfehler und
blockt den Strikt-Modus nicht — so war es vor B19, und daran ändert sich
nichts.

**Zweimal hintereinander dieselbe Richtung.** Beide Male habe ich eine
Blockade in ein Durchlassen verwandelt, während ich das Gegenteil in den Text
schrieb. Das ist kein Zufall, sondern die Richtung, in die ein Fehler kippt,
wenn man ein Ärgernis beseitigen will: Wer eine Sperre als lästig empfindet,
baut versehentlich an ihr vorbei. Deshalb steht jede Zusage dieses Befundes
jetzt als ausgeführte Gegenprobe da und nicht als Satz.

**Reichweite, ehrlich.** Das behebt die stumme Stimme, nicht ihre Ursache beim
Anbieter. Bleibt eine Stimme über alle drei Versuche stumm, ist der PR
weiterhin rot — das ist beabsichtigt, denn dann hat nachweislich niemand
geprüft.
## B20 — Backup und Restore waren uneins, und der Alias-Wächter sah nur die Hälfte — GEMESSEN 08/2026, behoben

Vier Befunde aus der sechsten Panel-Runde zu `deploy/backup.sh`,
`deploy/restore.sh` und `deploy/health-gate.sh`. Alle vier sind dieselbe Klasse
wie **B16**: eine Kontrolle, die grün ist, ohne das zu prüfen, was sie zu
prüfen vorgibt.

### 1. Gesichert wurde, was sich nie einspielen ließ — und die Rotation hing daran

Der Typ-Vertrag für Medien-Archive („nur Verzeichnisse und reguläre Dateien")
stand **nur** in `restore.sh`. `backup.sh` packte ein, was ihm vorlag.
Gemessen mit einem Symlink in `uploads/`:

```
tar -czf … uploads      Exit 0   ->  UPLOADS_OK=1, Lauf gilt als ERFOLG
Typgate im Restore      ABBRUCH  ->  dieses Archiv wird NIE eingespielt
```

Weil die Rotation an genau diesem grünen Lauf hängt, löschte sie danach die
letzten Archive weg, die sich noch einspielen ließen. Ein Medienverzeichnis, in
das je ein Link gerät, hätte damit **still jede Wiederherstellbarkeit
verloren** — bemerkt hätte es, wer eines gebraucht hätte.

**Wurzel:** Der Vertrag steht jetzt einmal in `deploy/archiv-typen.sh` und wird
von beiden Skripten gequellt, wie `health-gate.sh` seit 08/2026. Das Backup
prüft das ERZEUGTE Archiv dagegen — dieselbe Stelle, an der die Datenbank seit
B16 ihren `integrity_check` bekommt. Scheitert es, bleibt `UPLOADS_OK=0`, der
Lauf endet rot, und die Rotation läuft nicht.

### 2. `kein_link` übersah Hardlinks — die Live-Datenbank war danach ein gzip-Archiv

Der Wächter fragte allein `[[ ! -L ]]`. Ein Hardlink teilt sich den Inode mit
seinem Ziel und ist für `-L` unsichtbar. Gemessen am nackten Werkzeug:

```
ln  daten/app.db  backups/uploads-STAMP.tar.gz
tar -czf backups/uploads-STAMP.tar.gz -C daten uploads   -> Exit 0
file daten/app.db   ->  "gzip compressed data"
```

`tar -czf` öffnet mit `O_TRUNC` und schreibt in den **Inode**, nicht in den
Namen. Die laufende Datenbank war weg, und der Lauf meldete Erfolg.

**Wurzel:** Die richtige Frage ist nicht „ist das ein Link?", sondern „steht
hier überhaupt etwas?". Die Zielpfade tragen einen Zeitstempel; dort steht nie
etwas, das dieses Skript angelegt hat. `platz_frei` verlangt jetzt
`! -e && ! -L`. **Nicht** für `BACKUP_DIR` selbst — das Verzeichnis darf
existieren und wird gleich darauf mit `mkdir -p` angelegt; dort bleibt die
Frage nach dem Link die richtige.

### 3. „Bewusst kein `-L`" war ein Satz, keine Zusage

`curl` liest ohne `-q` seine Konfiguration aus `$CURL_HOME/.curlrc` bzw.
`$HOME/.curlrc` und nimmt von dort **jede** Option an — gemessen: eine kaputte
Zeile darin quittiert curl mit „warning:", die Datei wird also wirklich
gelesen. Ein `-L` oder `--connect-to` darin dreht das Health-Gate um: Es folgte
einer Umleitung oder fragte einen ganz anderen Rechner, und beides gälte als
Antwort DIESER Anwendung. Dafür braucht es keinen Angreifer — die
Bequemlichkeitszeile eines Betreibers genügt.

Bitter daran: `scripts/regime/rollback-check.mjs` prüft den Quelltext auf die
Abwesenheit von `-L`. Diese Kontrolle war grün, während die Umgebung das `-L`
jederzeit wieder hineinreichen konnte.

**Wurzel:** `curl -q` als erste Option, und eine Invariante, die das festhält.

### 4. Ausgepackt wurde unbegrenzt, auf das Dateisystem der laufenden Datenbank

Die Nebenablage liegt unter `$DATA_DIR` — also dort, wo SQLite schreibt, und
das Auspacken läuft **vor** dem Stopp des Dienstes. Ein Archiv, dessen Inhalt
größer ist als der freie Platz, lässt die Anwendung in ENOSPC laufen, während
sie noch bedient.

**Wurzel, mit ehrlich benannter Reichweite:** Geprüft wird, was das Archiv
ANKÜNDIGT (Spalte 3 von `tar -tvzf`) gegen den freien Platz mit einem Viertel
Luft. Ein Kopf kann lügen; tut er das, greift die Grenze nicht — dann scheitert
`tar` am vollen Dateisystem, `ARCHIV_ABBRUCH` räumt die Nebenablage weg und
gibt den Platz zurück, und eingespielt ist nichts. Diese Prüfung nimmt also dem
EHRLICH angekündigten Fall den Schaden; den unehrlichen fängt erst das
Aufräumen.

### Nicht übernommen

Der fünfte Punkt derselben Runde: `-L` auf `BACKUP_DIR/` dereferenziere wegen
des Schluss-Schrägstrichs den Link. Im Quelltext steht `[[ ! -L "$BACKUP_DIR" ]]`
**ohne** Schrägstrich (Zeile 62). Dass `link/` dereferenzieren *würde*, stimmt —
gemessen —, nur steht diese Form dort nicht.

### Und noch einmal derselbe Fehler, diesmal in der Kontrolle selbst

Die neuen Invarianten für den Typ-Vertrag standen zuerst **nur** im
`--selftest` von `rollback-check.mjs`. Entschärfte man `backup.sh` oder
`restore.sh`, blieb der normale Lauf grün — eine Kontrolle, die nichts
kontrolliert, mitten in der Behebung von vier Befunden über genau das.
Gefunden hat es die Gegenprobe, nicht das Nachdenken. Sie wird jetzt in beiden
Läufen ausgewertet.

## B21 — Der Wert, das Wettrennen und der Dateimodus — GEMESSEN 08/2026, behoben

Drei Befunde aus der siebten Panel-Runde. Der erste ist eine Korrektur an mir
selbst.

### 1. Ein Schluss-Schrägstrich im WERT hebelte den Link-Wächter aus

`[[ -L "$BACKUP_DIR" ]]` prüft den Pfad, wie er dasteht. Ein Schrägstrich am
Ende zwingt das Betriebssystem, ihn als Verzeichnis aufzulösen — der Test sieht
dann das ZIEL und nicht den Link. Gemessen:

```
BACKUP_DIR=…/verweis    ->  [[ -L ]] wahr    (Wächter greift)
BACKUP_DIR=…/verweis/   ->  [[ -L ]] falsch  (Wächter LÄSST DURCH)
```

Der Wert kommt von außen: aus der Umgebung des Aufrufers oder aus `.env`. Ein
Pfad mit Schrägstrich am Ende ist dort nichts Ungewöhnliches.

**Das hatte ich in B20 schon einmal auf dem Tisch und abgewiesen.** Der
damalige Hinweis lautete, `-L` auf `BACKUP_DIR/` dereferenziere den Link. Ich
habe im Quelltext nachgesehen, dort keinen Schrägstrich gefunden und den Punkt
für erledigt erklärt. Die Feststellung war richtig und die Schlussfolgerung
falsch: Zu prüfen ist der **Wert**, nicht die Schreibweise an der Prüfstelle.
Der Schrägstrich muss nicht im Code stehen — er kommt mit der Konfiguration.

**Wurzel:** Der Wert wird normalisiert, bevor der Wächter ihn sieht.

### 2. Das Wettrennen zwischen Prüfung und Schreiben — jetzt geschlossen statt benannt

`platz_frei` fängt den VORHER gelegten Alias ab. Zwischen dieser Prüfung und
dem Augenblick, in dem `tar` bzw. die Backup-API die Datei öffnet, kann jemand
einen Link an den Zielnamen legen; die Zielnamen tragen einen Zeitstempel und
sind damit vorhersagbar. Bisher stand genau das nur als ehrlicher Satz im
Kommentar — als Reichweite, die wir nicht erreichen.

**Wurzel:** Gearbeitet wird jetzt in einem frisch angelegten Verzeichnis mit
unvorhersagbarem Namen (`mktemp -d`, 0700). Dort hinein kann niemand vorab
etwas legen. Fertig wird die Datei mit `mv` an ihren Platz gebracht — und `mv`
benennt um, es schreibt nicht durch einen Link hindurch. Gemessen:

```
ln -s opfer ziel;  mv -f quelle ziel
-> "opfer" unverändert, "ziel" ist danach eine echte Datei.
```

Damit gibt es kein Fenster mehr: Während des Schreibens ist der Name geheim,
und beim Veröffentlichen wird nicht geschrieben, sondern umbenannt.

### 3. Der Restore öffnete die Datenbank jedes Mal ein Stück weiter

`cp` legt die neue Datei mit dem Modus der QUELLE an. Eine Sicherung liegt
regelmäßig als 0644 da (sie entsteht im Container unter dessen umask), die
laufende Datenbank ist 0600. Gemessen:

```
vorher   app.db 600, backup 644
nachher  app.db 644
```

Still, und ausgerechnet im Ernstfall.

**Wurzel:** Der Modus des laufenden Standes wird vor dem Ersetzen abgelesen und
auf die neue Datei gesetzt — **vor** dem `mv`, sonst stünde die Datenbank
zwischen Umbenennen und `chmod` offen da. Gibt es noch keine Datenbank, gilt
0600.

### Nicht übernommen

Der `h`-Zweig in `archiv_typen_ok` (`deploy/archiv-typen.sh`) sei wirkungslos,
weil `tar -tvzf` Hardlinks als `-` melde. (Der Befund nannte dafür Zeile 64 —
die Datei hat 63.) Gemessen mit GNU tar 1.35:

```
[h]  hrw-r--r-- root/root   0 … uploads/kopie.jpg link to uploads/echt.jpg
```

Der Typ steht als `h` in der ersten Spalte, der Zweig greift.

### Und wieder ein grüner Test, der nichts prüfte

Der Test für das Wettrennen hängte den Angriff an die podman-Attrappe **an** —
hinter deren `exit 0`. Die Zeile lief nie, der Test war grün, und erst die
Gegenprobe (`mv` durch `cp` ersetzen, das einem Link folgt) hat es gezeigt: Sie
blieb ebenfalls grün. Der Angriff steht jetzt VOR der ersten Verzweigung.
Das ist innerhalb dieses Zweiges der dritte Fall dieser Art.

## B22 — Die Referenzaufnahme wird sporadisch rot und reißt den ganzen E2E-Lauf mit — GEMESSEN 08/2026, OFFEN

**Beobachtet** am 27.08. auf `claude/betriebsbefunde-backup-drill`:
`Referenz: reise-detail @ desktop-1280` scheiterte mit

```
Failed to take two consecutive stable screenshots.
3052147 pixels (ratio 0.25 of all image pixels) are different.
```

**Was gemessen ist:**

* Die zuletzt aufgenommene Datei war **byte-identisch** mit dem Basisbild
  (gleiche MD5). Die Seite rendert also richtig; die Behauptung „sieht aus wie
  die Basis" stimmt.
* Gescheitert ist allein die Forderung nach **zwei aufeinanderfolgenden
  stabilen** Aufnahmen: Der erste Schuss wich um 25 % ab, der zweite passte.
  Innerhalb der zehn Sekunden (`expect: { timeout: 10_000 }`) kam Playwright
  nicht zur Ruhe.
* Zweimal reproduziert, danach fünfmal grün — **auch auf dem Commit davor**.
  Es hängt nicht an einer Codeänderung, sondern am Lauf: Der Fehlschlag trat
  im vollen Lauf (parallele Arbeiter) auf, die grünen Läufe waren einzeln.

**Warum das nicht bloß lästig ist:** Das `referenz`-Projekt ist eine
Abhängigkeit von `alles-weitere` (`playwright.config.ts`). Fällt eine einzige
Aufnahme, läuft der Rest gar nicht erst — aus 329 Tests wurden 116. Und
`test:e2e` ist seit B9 Teil des CI-Gates. Ein sporadisch rotes Bild blockiert
damit jeden PR, unabhängig von seinem Inhalt.

**Was NICHT die Lösung ist:** die Zeitschranke hochsetzen oder
`maxDiffPixelRatio` anheben. Das erste verschiebt das Problem, das zweite
zerstört die Kontrolle — und beides ist in `CLAUDE.md` ausdrücklich untersagt.

**Was ich NICHT herausgefunden habe, und das ist der offene Teil:** was im
ersten Schuss fehlte. Eine naheliegende Vermutung — Bilder sind bei `complete`
zwar geladen, aber noch nicht dekodiert, und `tests/e2e/bilder-fertig.ts`
wartet nur auf `complete` — habe ich nachgemessen und **widerlegt**: Auf der
geprüften Seite liegen zwei Bilder, `decode()` kehrt nach 0 ms zurück. Die
Artefakte des Fehllaufs (`*-previous.png`, `*-diff.png`) hatten die späteren
grünen Läufe bereits aufgeräumt, bevor ich die abweichenden Zeilen bestimmen
konnte.

**Nächster Schritt, wenn es wieder auftritt:** Die Artefakte SOFORT sichern und
bestimmen, welche Zeilenbereiche abweichen — daran hängt, was noch nicht
gemalt war. Erst dann lässt sich die Wurzel benennen. Eine Behebung auf eine
unbelegte Vermutung zu bauen, wäre genau die Kontrolle, die grün ist und nichts
prüft, gegen die B16, B20 und B21 geschrieben sind.

## B23 — Drei Lücken in den Behebungen von B21 — GEMESSEN 08/2026, behoben

Die achte Panel-Runde traf **ausschließlich** das, was ich eine Runde davor
repariert hatte. Alle drei haben dieselbe Form: Ich hatte **einen Fall
gemessen und die Klasse für erledigt erklärt**.

### 1. Die Normalisierung sah nur den Schrägstrich

`verweis/.` trägt keinen Schluss-Schrägstrich und dereferenziert trotzdem:

```
'verweis'    -> normalisiert 'verweis'    -> Wächter greift
'verweis/'   -> normalisiert 'verweis'    -> Wächter greift
'verweis/.'  -> normalisiert 'verweis/.'  -> Wächter LÄSST DURCH
```

**Wurzel, und diesmal keine Fallunterscheidung mehr:** eine Regel über die
FORM des Wertes. Ein Sicherungsverzeichnis wird als schlichter Pfad angegeben;
trägt der Wert ein `.`- oder `..`-Glied, wird er **abgewiesen** statt
zurechtgebogen. Ein zurechtgebogener Wert wäre wieder eine Vermutung darüber,
was der Betreiber gemeint hat.

### 2. `mv` folgt einem Link auf ein VERZEICHNIS sehr wohl

In B21 hatte ich gemessen: `mv -f` über einen Symlink lässt das Opfer
unberührt. Das stimmt — für einen Link auf eine **Datei**. Zeigt er auf ein
**Verzeichnis**, verschiebt `mv` die Datei hinein:

```
ln -s fremdes-verzeichnis ziel
mv -f  quelle ziel   -> ziel bleibt Link, quelle liegt IM Fremdziel
mv -fT quelle ziel   -> Link ersetzt
```

Die Sicherung wäre in einem fremden Verzeichnis gelandet, der Lauf grün
geblieben.

**Wurzel:** `mv -fT` an allen drei Stellen. `-T` sagt: Das Ziel ist ein NAME,
kein Verzeichnis.

### 3. `TAR_OPTIONS` — dieselbe Frage, die ich für `curl` gestellt hatte

GNU tar liest `TAR_OPTIONS` aus der Umgebung und nimmt von dort jede Option
an. Gemessen:

```
ln -s /pfad/geheim.txt uploads/harmlos.jpg
TAR_OPTIONS=--dereference tar -czf …
-> Mitglied trägt Typ '-', der Typ-Vertrag ist zufrieden,
   und `tar -xzO` liefert GEHEIM.
```

Der Symlink wird also als **reguläre Datei mit fremdem Inhalt** archiviert; die
Zusage „kein Link-Mitglied" bliebe wahr und wäre trotzdem wertlos, und der
Restore veröffentlichte den Inhalt unter `uploads/`.

Das ist **genau die Klasse, die ich in B20 für `curl`/`.curlrc` behoben habe**
— dort mit `-q`. Dieselbe Frage für `tar` habe ich damals nicht gestellt.

**Wurzel:** `unset TAR_OPTIONS` in `backup.sh` und `restore.sh`, dazu ein
lokales `TAR_OPTIONS=` in `archiv_typen_ok`, damit der Vertrag auch dann hält,
wenn ihn jemand anders quellt.

### Was ich daraus mitnehme

Drei Runden in Folge lautete der Befund nicht „hier fehlt eine Kontrolle",
sondern „die Kontrolle, die du gerade eingebaut hast, deckt ihre eigene Klasse
nicht ab". Eine Messung an einem Beispiel belegt das Beispiel, nicht die Regel.
Wo eine Regel gemeint ist, gehört sie als Regel formuliert — deshalb steht bei
Punkt 1 jetzt eine Aussage über die Form des Wertes und keine Liste von
Schreibweisen.

## B24 — Der Name lügt, der Inode nicht — GEMESSEN 08/2026, behoben

Die neunte Panel-Runde. Der erste Punkt ist ein Befund, den ich **zweimal
abgewiesen habe und der beide Male richtig war**.

### 1. Ein Hardlink verschwindet im Archiv, wenn sein zweiter Name draußen liegt

Die Behauptung lautete seit Runde 6: Der `h`-Zweig im Typ-Vertrag sei
wirkungslos, weil `tar -tvzf` Hardlinks als `-` melde. Ich habe sie zweimal
zurückgewiesen, mit dieser Messung:

```
[h]  hrw-r--r-- … uploads/kopie.jpg link to uploads/echt.jpg
```

Die stimmt — und widerlegt nichts. In ihr liegen **beide** Namen des Inodes im
Archiv; dann hat tar einen früheren Eintrag, auf den es verweisen kann. Liegt
der zweite Name **außerhalb**, gibt es nichts zu verlinken:

```
ln $DATA_DIR/app.db $DATA_DIR/uploads/leak.webp
tar -czf … -C $DATA_DIR uploads
-> [-] -rw-r--r-- 17 uploads/leak.webp
   Inhalt: GEHEIME-DATENBANK
```

Der Typ-Vertrag ist zufrieden (Typ `-`), und der Restore veröffentlicht die
**Datenbank** unter `uploads/`.

**Wurzel:** Gefragt wird nicht mehr, wie etwas heißt oder wie tar es
serialisiert, sondern ob die Datei **mehr als einen Namen hat**
(`find … -type f -links +1`). Ein Name kann lügen, ein Inode nicht. Ein
Medienverzeichnis, das die Anwendung füllt, enthält keine Hardlinks.

### 2. `-L` sieht nur die letzte Komponente

`verweis/sub` ist selbst kein Link und löst trotzdem durch `verweis` hindurch
auf. Gemessen: `[[ -L "verweis/sub" ]]` → falsch.

**Wurzel:** keine weitere Komponente mehr, sondern eine Aussage über den
**ganzen** Pfad — er muss seiner kanonischen Form (`readlink -m`) entsprechen.
Das deckt zugleich die Fälle aus B21 (Schluss-Schrägstrich) und B23 (`/.`) ab,
die vorher als eigene Regeln danebenstanden.

### 3. Die Vorbedingung, die alle Wächter still annahmen

Werkstatt, `platz_frei` und `mv -fT` verhindern, dass *dieses Skript* durch
einen Alias schreibt. Gegen jemanden, der **in** `BACKUP_DIR` schreiben darf,
halten sie nicht: Der kann die Werkstatt wegbenennen und einen Link an ihre
Stelle setzen, während der Lauf läuft.

Das ist keine Lücke, die sich im Skript schließen lässt — es ist eine
Eigenschaft der Rechte. **Wurzel:** Sie wird nicht mehr angenommen, sondern
verlangt. Ist `BACKUP_DIR` für Gruppe oder andere beschreibbar, bricht der Lauf
ab. Damit fällt die ganze Klasse weg, statt Fall für Fall abgefangen zu werden.

### Nicht übernommen

Die Neutralisierung von `TAR_OPTIONS` in `archiv_typen_ok` sei wirkungslos,
weil eine lokale Shell-Variable die Umgebung des Kindprozesses nicht ändere.
Gemessen:

```
TAR_OPTIONS=--dereference bash -c 'zeig(){ local TAR_OPTIONS=; env | grep -c …; }; zeig'
-> 0     (neutralisiert)
ohne local, zum Vergleich
-> 1
```

Bash behält beim Überdecken einer exportierten Variablen das Export-Merkmal
und reicht den **neuen** (leeren) Wert weiter. Die Behebung greift.

### Das Muster, jetzt zum vierten Mal

Runde 7, 8 und 9 trafen jeweils genau das, was in der Runde davor gebaut wurde.
Immer derselbe Grund: **eine Messung an einem Beispiel belegt das Beispiel,
nicht die Regel.** Bei Punkt 1 kommt erschwerend dazu, dass ich mit so einer
Messung einen *richtigen* Befund zweimal abgewiesen habe — eine Widerlegung
muss den Fall treffen, den der andere meint, nicht den bequemsten Nachbarfall.

Deshalb steht in dieser Runde bei jedem Punkt eine Aussage über die Sache
selbst statt über ihre Erscheinungsform: der Inode statt des Namens, der ganze
Pfad statt der letzten Komponente, die Rechte statt des Wettrennens.

## B25 — Zahlen, die nicht die Sache messen — GEMESSEN 08/2026, behoben

Vier Punkte aus der zehnten Panel-Runde. Drei davon sind Zahlen oder Modi, die
eine bequeme Nachbargröße statt der Sache selbst erfassen.

### 1. Die veröffentlichte Sicherung war weltlesbar

Eine DB-Sicherung IST die vollständige Datenbank. Sie entstand unter der umask
des Aufrufers:

```
umask 0022  ->  app-STAMP.db.gz = 644
```

Das widerspricht direkt dem, was B21 für den Restore festgelegt hat: Dort wird
der Modus `0600` der laufenden Datenbank sorgfältig erhalten — und daneben lag
eine frei lesbare Kopie derselben Daten.

**Wurzel:** `umask 077` als Regel für den ganzen Lauf, nicht `chmod` je Datei.
Eine Liste von `chmod`-Zeilen wäre wieder eine Aufzählung von Fällen; gemeint
ist eine Aussage über alles, was dieser Lauf anlegt — auch über das, was später
dazukommt.

### 2. Geprüft wurde nur das Blatt, nicht der Weg dorthin

Wer in einem **Eltern**verzeichnis schreiben darf, benennt `BACKUP_DIR` um und
stellt ein eigenes an seine Stelle. Der Modus des Blattes sagt darüber nichts.
Geprüft wird jetzt der ganze Pfad bis zur Wurzel.

**Mit einer Unterscheidung, die zur Sache gehört:** Das **Sticky-Bit**.
`/tmp` ist `1777` — jeder darf dort anlegen, aber niemand fremde Einträge
umbenennen oder löschen, und genau das ist der Angriff. Ohne diese
Unterscheidung wäre die Regel schlicht falsch und wiese jede Anlage unterhalb
von `/tmp` ab. Eine Kontrolle, die den Regelfall verbietet, wird abgeschaltet
und schützt dann gar nichts.

### 3. Das Inhaltsverzeichnis lag komplett im Speicher

`zeilen="$(tar -tvzf …)"` puffert die ganze Liste. Ein winziges Archiv aus
Millionen Kopfsätzen ergibt hunderte Megabyte — der Prüfer stirbt am Speicher,
bevor er ein Urteil fällt. Eine Kontrolle, die am zu prüfenden Gegenstand
zugrunde geht, ist keine.

**Wurzel:** gelesen wird im Strom, über eine Prozess-Ersetzung (eine Pipe legte
die Schleife in eine Unterschale, aus der `return 1` nie ankäme).

**Und der heikle Teil, den erst die Gegenprobe zeigte:** Scheitert `tar` in der
Prozess-Ersetzung, liefert es KEINE Zeilen. Die Schleife liefe nie, und die
Funktion antwortete „Typen in Ordnung" — über ein Archiv, das sich gar nicht
öffnen lässt. Die Lesbarkeit wird deshalb eigens festgestellt.

### 4. Das Platz-Gate zählte Nutzbytes statt Blöcke

Eine Datei belegt immer einen ganzen Block und immer einen Inode. Gemessen:

```
3000 Dateien à 1 Byte
angekündigt:      3 000 Byte
belegt:      12 365 824 Byte   (Faktor 4121)
Archivgröße:     38 385 Byte
```

Das Gate lag um drei Größenordnungen daneben. **Wurzel:** aufgerundet wird je
Mitglied auf die Blockgröße des Ziel-Dateisystems, und die Anzahl der Mitglieder
wird gegen die freien **Inodes** gehalten.

### Und wieder zwei Kontrollen, die nichts kontrollierten — beide meine

Die Gegenprobe zur Blockrechnung ließ die Testsuite **grün**: Es gab keinen
Test, den das Entfernen der Rechnung umgeworfen hätte. Ebenso beim Typ-Vertrag:
Entfernte man die Lesbarkeitsprüfung, blieb alles grün, weil der Vertrag bisher
nur MITTELBAR geprüft war — über die beiden Skripte, die ihn umgeben und ihre
eigenen Vorprüfungen mitbringen.

Dass die Aufrufer das heute abfangen, macht den Vertrag nicht richtig: Ein
gemeinsamer Baustein, der nur zusammen mit seinen jetzigen Aufrufern hält, ist
genau die Abhängigkeit, wegen der er herausgezogen wurde. Deshalb jetzt
`tests/archiv-typen.test.ts` — der Vertrag für sich allein gefahren.

## B26 — Zwei Lesevorgänge, ein verworfener Status — GEMESSEN 08/2026, behoben

Die elfte Panel-Runde, ein Befund, und er trifft genau die Behebung aus B25.

Um das Puffern des Inhaltsverzeichnisses loszuwerden, hatte ich dort ZWEIMAL
gelesen: erst `tar -tzf` nach `/dev/null` als Lesbarkeitsprüfung, dann
`tar -tvzf` in einer Prozess-Ersetzung für die Typen. **Der Exit-Status des
zweiten Laufs ging dabei verloren.** Scheitert er, liefert er keine Zeilen, die
Schleife läuft nie — und die Funktion antwortet „Typen in Ordnung".

Gemessen, mit einem Archiv, das einen Symlink **enthält**, und einer
tar-Attrappe, die nur den ausführlichen Lauf scheitern lässt:

```
tar -tzf  gelingt  /  tar -tvzf scheitert
-> archiv_typen_ok: „Typen in Ordnung"     (fail-open)
```

Das ist **dieselbe Lehre wie aus Runde 4** — die Liste ist nicht der Baum —,
nur diesmal auf meine eigenen zwei Lesevorgänge angewandt: Was der erste Lauf
festgestellt hat, muss für den zweiten nicht mehr gelten. Zwischen beiden liegt
die Datei offen.

### Wurzel

**Ein** Lesevorgang, und das Urteil kommt über dessen Exit-Status zurück statt
über eine Variable, die eine früh abgebrochene Schleife nie gesetzt hat.
`awk` fällt die Entscheidung im selben Lauf; `pipefail` lässt ein gescheitertes
`tar` durchschlagen; `awk` läuft bis zum Ende durch (kein vorzeitiges `exit`),
damit `tar` kein SIGPIPE bekommt und sein Status die Lesbarkeit bezeichnet und
nur sie.

```
Status 0  — jedes Mitglied ist Verzeichnis oder reguläre Datei
Status 3  — Typverstoß; die Begründung steht auf stdout
sonst     — tar konnte das Archiv nicht lesen
```

Dieselbe Konstruktion stand im **Namensgate** von `deploy/restore.sh` und ist
dort mitgezogen. Auch das Platz-Gate liest jetzt unter `pipefail`: Ein
gescheitertes `tar` ergäbe sonst „0 Byte, 0 Mitglieder" — und das Gate ließe
genau dann durch, wenn es nichts weiß.

### Was daran allgemein ist

Eine Prüfung und die Sache, über die sie urteilt, müssen **denselben**
Lesevorgang teilen. Zwei Läufe über dieselbe Datei sind zwei Beobachtungen,
und die Kontrolle spricht dann über die erste, während gehandelt wird auf
Grundlage der zweiten. Das galt in Runde 4 für Inhaltsverzeichnis gegen
ausgepackten Baum und gilt hier für Vorabprüfung gegen Detailprüfung.

---

## B27 — die umask galt für den Lauf, aber die Sicherung schrieb ein Container

**Gefunden:** Panel-Runde 12 (`combo/SOTA-A`, refutiert).
**Betrifft:** `deploy/backup.sh`, `tests/backup-lauf.test.ts`.

Runde 10 hatte eine DB-Sicherung, die weltlesbar dalag, mit `umask 077`
geschlossen — als **Regel** über den ganzen Lauf statt als Liste von
`chmod`-Zeilen. Die Begründung war gut und die Behebung trotzdem unvollständig:
Eine umask vererbt sich entlang des **Prozessbaums**, und die DB-Sicherung
schreibt nicht dieser Lauf, sondern ein **Container**. Der hängt nicht an
unserem Baum; podman gibt ihm seine eigene umask (Vorgabe 0022). Gemessen:

```
Aufrufer umask 077
  Kindprozess (erbt)             ->  600
  Container (eigene umask 0022)  ->  644
  gzip erhält den Modus          ->  644
  mv  erhält den Modus           ->  644   in BACKUP_DIR
```

`BACKUP_DIR` darf 0755 sein — der Ahnen-Wächter aus Runde 10 verbietet
Schreib-, nicht Leserechte. Die **vollständige Datenbank** läge damit für jeden
lokalen Benutzer lesbar da, also genau in dem Zustand, gegen den die Regel
geschrieben wurde.

### Warum der Prüfstand grün war

Das ist der eigentliche Befund. Die podman-Attrappe ist ein Bash-Kindprozess
von `backup.sh` und **erbt** dessen `umask 077` — sie legte von sich aus 0600
an. Der Test verlangte 600, bekam 600 und maß dabei die **Vererbung**, nicht
die Produktion. Eine Kontrolle, die grün ist, ohne das zu prüfen, was sie zu
prüfen vorgibt: dieselbe Fehlerklasse wie B16, und damit die dritte Stelle in
diesem Zweig, an der eine Attrappe für die Sache genommen wurde.

### Wurzel

Nicht eine zweite umask, sondern eine Aussage über **die Datei, die wir
veröffentlichen**: `chmod 600 "$ROH"`, solange sie noch in der 700er-Werkstatt
liegt. `gzip` und `mv -fT` reichen den Modus unverändert weiter, also gilt er
für das, was am Ende in `BACKUP_DIR` steht — unabhängig davon, wer die Datei
angelegt hat und mit welcher umask. Scheitert das `chmod`, wird die Sicherung
verworfen wie eine beschädigte: `DB_OK` bleibt 0, der Lauf endet rot, die
Rotation läuft nicht.

Die Attrappe schreibt seither in einer Subshell mit `umask 0022`, also so wie
podman. Gegengeprüft: ohne das `chmod` steht dort 644, und der Test fällt um.

### Reichweite, ehrlich

Das Uploads-Archiv legt `tar` in **unserem** Prozessbaum an; dort gilt die
`umask 077` wirklich, und die Zusage 0600 dafür trägt. `deploy/db-restore.sh`
setzt den Modus seit B21 ohnehin ausdrücklich. Was ein laufender
Anwendungscontainer im Regelbetrieb neben `app.db` anlegt (`-wal`, `-shm`),
entsteht nicht in diesem Skript und wird hier weder behauptet noch geregelt —
wer das prüfen will, prüft die Anwendung, nicht die Sicherung.

### Was daran allgemein ist

Eine Regel über „diesen Lauf" endet am Prozessbaum. Wo etwas **außerhalb**
davon schreibt — Container, `sudo`, ein Dienst —, gilt sie nicht mehr, und eine
Attrappe, die ein Kindprozess ist, verdeckt genau diesen Unterschied. Der Modus
einer Datei, auf den es ankommt, gehört deshalb gesetzt und nicht geerbt.

## B29 — das Fremd-Vendor-Panel ist als Pflicht-Gate unzuverlässig

**Offen.** Gemessen und eingegrenzt, nicht behoben — die Ursache liegt
außerhalb des Repositories.

`cross-vendor` (Workflow `Independent-Verify`) ist ein Pflichtcheck: Ohne sein
Urteil ist kein PR mergefähig. Er antwortet mal in **20 Sekunden**, mal
**35 Minuten lang gar nicht**.

### Gemessen an PR #134 (drei Läufe auf demselben Commit `b30d312`)

    Versuch 1  01.09. 15:09 – 15:44   35 min   fetch failed   -> verweigert
    Versuch 2  01.09. 15:46 – 16:22   35 min   fetch failed   -> verweigert
    Versuch 3  02.09. 16:22 – 16:23   20 s     echtes Urteil  -> bestätigt

Derselbe Diff, dreimal. Zwei Fehlschläge, ein Erfolg — die Kontrolle hat also
nicht zweimal etwas gefunden, sondern zweimal nichts gesehen.

### Was in den Fehlschlägen passiert

    [independent-verify] /v1/models nicht verfügbar → Fallback-Modell für alle Stimmen.
    [independent-verify] Stimme 1/2/3: /responses nicht nutzbar (Netzfehler: fetch failed)
      Verifier 1/3, 2/3, 3/3: Fehler (fetch failed)
    ⛔ Pflicht-Approver „combo/SOTA-A" nicht im Panel aufgelöst → fail-closed

Erst fällt die Modell-Liste aus, alle drei Stimmen laufen auf ein Ersatzmodell
zurück; dann scheitert auch der Aufruf selbst. **Das Gate schließt dabei
korrekt** — ein Pflicht-Approver, der nie geantwortet hat, darf nicht als
Zustimmung gelten. Der Fehler liegt nicht in der Entscheidung, sondern darin,
dass es überhaupt so oft nichts zu entscheiden gibt.

### Dass es kein Einzelfall ist

    31.08. 16:21  claude/ernaehrung-menue    success   ← nach zwei Fehlschlägen
    31.08. 11:46  claude/medien-kachel       success   ← Versuch 3
    02.09. 16:23  claude/schritt-nummern     success   ← Versuch 3

Die letzten drei Merges brauchten je zwei bis drei Anläufe. #134 hing dadurch
**einen Tag** fest, obwohl alle übrigen Checks von der ersten Minute an grün
waren.

### Dass es nicht am Inhalt liegt

Gegengeprüft an zwei Diffs ohne jede Gemeinsamkeit, im selben Zeitfenster:

    #134  Tailwind-Klasse, ein Test, zwei PNG   ->  panel rot
    #135  acht Zeilen CLAUDE.md, kein Code      ->  panel rot

### Was zu untersuchen wäre

Alles davon liegt im Betrieb, nicht im Quelltext dieses Repositories:

* Erreichbarkeit von `VERIFIER_BASE_URL` aus dem GitHub-Läufer heraus — DNS,
  Egress-Regeln, Ratenbegrenzung am Gateway.
* Die Zeitgrenzen in `scripts/regime/independent-verify.mjs`: 35 Minuten bis
  zum Aufgeben sind lang genug, dass niemand nebenher wartet, und kurz genug,
  dass der Lauf trotzdem verfällt.
* Die Wiederholstrategie: Der Rückfall `/responses` → `/chat/completions`
  greift, das Gateway bleibt aber unerreichbar — wiederholt wird also etwas,
  das aus demselben Grund erneut scheitert.

### Was NICHT die Lösung ist

Das Panel herabstufen, überspringen oder daran vorbeimergen. Und ebenso wenig:
so lange neu starten, bis es grün ist. Ein Gate, das im Regelfall drei Anläufe
braucht, erzieht genau dazu — und dann ist der dritte Lauf keine Bestätigung
mehr, sondern eine Gewohnheit.
