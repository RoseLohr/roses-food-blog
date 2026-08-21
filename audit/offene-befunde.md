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

## B4 — Export/Import verliert Layout-Angaben des Bildblocks

**Befund.** `src/lib/data-transfer/types.ts` bildet vom Bildblock nur `image`
und `groesse` ab; `import.ts` setzt beim Einlesen `platz: "rechts"` und
`mitVorherigem: false`. Ein exportierter und wieder eingelesener Bericht
verliert damit seine Bildanordnung.

**Beleg.** Vollständiger ZIP-Rundlauf in der Gegenprüfung.

**Status.** Wird durch den Bildgruppen-Umbau weitgehend gegenstandslos: Wenn
die Anordnung nur noch aus der POSITION folgt, gibt es keine Layout-Felder
mehr, die verloren gehen könnten. Bleibt hier stehen, bis der Umbau
abgeschlossen ist — dann streichen oder auf den Rest eindampfen.
