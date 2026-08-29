# Agenten-Instruktionen — Roses Food Blog

Diese Datei ist der Einstiegspunkt für jeden Agenten (und jede Person), der in
diesem Repository arbeitet. Sie ist Teil des Governance-Regimes (A-32/A-33/A-37).

## Zuerst lesen, dann ändern
1. **`governance/constitution.md`** — die ratifizierte Verfassung (v1.0). Sie
   bindet jede Änderung. Ihr Hash ist attestiert; eine Änderung an ihr ohne
   `node scripts/regime/constitution-hash.mjs --attest` schlägt in CI fehl.
2. **`governance/adr/`** — die Architektur-Entscheidungen (Datastore, Auth,
   KI-Provider, Deployment, kein Multi-Tenant). Nicht dagegen arbeiten;
   Abweichung = neuer ADR.
3. **`audit/10-exceptions-ledger.md`** — beschlossene Ausnahmen (F1–F4) und
   ihre Tripwires. **Wer eine Voraussetzung schafft (z. B. ersten Tool-Use im
   KI-Pfad, zweiten Mandanten, IaC), reaktiviert die zugehörigen Prüfungen.**

## Keine Workarounds — nur Ursachen (verbindlich, angeordnet 2026-07-17)
- **Rote CI-Checks, fehlschlagende Gates oder Fehler werden an der WURZEL
  behoben, nie umgangen.** Kein Unterdrücken, kein Tolerieren, kein „skip/allow",
  kein Weichspülen einer Kontrolle, kein Vorbei-Mergen an einer roten Ampel.
- **Es werden auch keine Workarounds mehr VORGESCHLAGEN.** Wenn nur ein
  Workaround möglich wäre, ist das der Befund — dann Root-Cause benennen und
  korrekt lösen (oder ehrlich sagen, dass es (noch) nicht sauber lösbar ist),
  statt eine Umgehung anzubieten.
- Ausnahmen sind ausschließlich die schriftlich ratifizierten Einträge im
  `audit/10-exceptions-ledger.md` (F1–F4) mit Tripwire — nichts Ad-hoc.

## Harte Regeln (vom Gate erzwungen — nicht diskutabel)
- Jede Änderung muss das CI-Gate bestehen: `npm run typecheck && npm run lint
  && npm test && npm run build` plus die Regime-Skripte (`scripts/regime/`).
- **Kein** Inline-System-Prompt außerhalb `src/lib/prompts/` (A-20).
- **Kein** floating Modell-Alias (`…latest`/`…preview`) — nur gepinnte
  Snapshots (B-13).
- **Keine** leeren `catch {}`-Blöcke (A-26), **keine** Stub-Marker in `src/`
  (A-16), **keine** Secrets im Quelltext (B-06 — STOP-SHIP).
- Mutation-Score Kernlogik ≥ 78 % (`npm run mutation`), Duplikation ≤ 5,5 %
  (`npm run clones`), axe-A11y 0 serious/critical (`npm run test:a11y`).
- Deploy-Freigabe liest `audit/engagement-status.json` → `production_eligible`
  (aktuell `false`, bis Part 2/Track C schließt). **Fail-closed.**

## Layout-Regeln, die nicht verhandelbar sind
- **Bilder im Reisebericht (Fassung 08/2026, ersetzt die Fassung von 0012):**
  Jedes Bild trägt eine **Marke** (`gruppe`) — oder keine.
  - **Mit Marke:** Ein ununterbrochener Lauf von Bildblöcken MIT DERSELBEN
    Marke ist eine Gruppe. Das ERSTE Bild steht über die ganze Breite, ALLE
    weiteren darunter in EINER Reihe, gleich hoch. Innerhalb der Gruppe folgt
    die Anordnung **allein aus der Position** — ein Bild mit Marke trägt
    weder Größe noch Seite, und das ist erzwungen (Vertrag: `refine` in
    `travel-blocks.ts`; Datenbank: `travel_block_bild_regler_check`).
  - **Ohne Marke:** ein Einzelbild mit genau zwei Reglern — Größe
    (s = 1/3, m = 1/2, l = 2/3 der Inhaltsspalte) und Seite (links/rechts).
    Der Text läuft darum herum. Unter 640 px steht es über die volle Breite.
  - **Kein Einzelbild teilt sich seine Zeile** (`clear: both`). Gemessen an
    echtem Chromium: s links + m rechts ließ dem Text acht Zeilen à ~49 px
    von 816. Eine Regel „nur s+s darf nebeneinander" wäre eine Aussage über
    ein PAAR — also wieder eine, die den Nachbarn kennen muss.

  **Warum das nicht der Regler von 0012 zurück ist:** Verboten war ein Feld,
  das eine Aussage über den NACHBARN macht (`mitVorherigem`) — es wurde still
  falsch, sobald sich dazwischen etwas änderte. Die Marke ist symmetrisch und
  handelt nur vom eigenen Block: Zwei Bilder gehören zusammen, weil BEIDE
  dieselbe Marke tragen. Fällt der Nachbar weg, bleibt die eigene Marke
  richtig. Größe und Seite beschreiben ebenfalls nur ihr eigenes Bild und
  gelten nur dort, wo es keine Gruppe gibt, die ihnen widersprechen könnte.
  Wer hier ein Feld einführt, das über einen ANDEREN Block spricht, führt die
  Fehlerklasse wieder ein.

  - **Bildunterschrift (08/2026):** Jedes Bild im Bericht kann seinen Alt-Text
    sichtbar darunter zeigen — je Foto, standardmäßig AUS. Auch innerhalb einer
    Gruppe, und dort je Foto einzeln: Anders als Größe und Seite sagt eine
    Unterschrift nichts darüber, WO das Bild steht, kann der Anordnung also
    nicht widersprechen. Sie ist wie `gruppe` eine Marke über das Bild selbst.
    NICHT an Restaurant- und Gericht-Fotos — die waren ausdrücklich ausgenommen.
    Der Renderer packt ein Foto mit Unterschrift in eine `<figure>` und hängt
    die Rahmen-Angaben (Float-Anteil, `--ar`) DORTHIN; bliebe der Rahmen am
    Knopf, stünde die Unterschrift außerhalb des Bildplatzes. Gemessen an echtem
    Chromium (`tests/e2e/bildunterschrift.spec.ts`): Die Bilder einer Reihe
    bleiben gleich hoch, und beim Einzelbild hängt der Text im schwebenden
    Platz.

  **Im Admin ist eine Gruppe EIN Block** (`src/lib/travel-editor-items.ts`):
  ein Knopf „+ Bildgruppe", eine Karte, darin die Fotos in einem Zug aus der
  Bibliothek gewählt und mit ←/→ geordnet. Die Marke vergibt der Editor beim
  Absenden; sie ist kein Bedienelement mehr. Vorher stand je Foto eine Karte
  mit einem Auswahlfeld „Zugehörigkeit" — fünf Handgriffe für eine Aussage,
  die einmal gilt. Diese Bedienung kommt nicht zurück. Dass die Umrechnung
  Karten ⇄ Blockfolge den ausgelieferten Bericht NICHT verändert, ist als
  Gleichung festgenagelt (`tests/travel-editor-items.test.ts`); der Weg durch
  die Oberfläche in `tests/e2e/reise-bildgruppe-editor.spec.ts`.

  Die Regeln für das Einzelbild stehen in **`src/app/einzelbild.css`** —
  eigenständig, damit `tests/e2e/mocks/einzelbild.html` sie LÄDT statt sie
  abzuschreiben. Die Abschrift dort hatte die Handy-Regel nie mitbekommen: ein
  Prüfstand, der grün war für etwas, das die Seite gar nicht auslieferte.
- **Nachtmodus (08/2026): ein TOKEN-Tausch unter `[data-theme="dark"]`.** Jede
  Tailwind-Farb-Utility löst auf eine CSS-Variable auf
  (`.bg-cream{background-color:var(--color-cream)}`); wer die Variablen unter
  einem Selektor neu setzt, dreht alle auf einmal um — im Admin über 400
  Fundstellen. Wer eine Farbe hart in eine Komponente schreibt statt eine
  Utility zu nehmen, nimmt sie aus dem Nachtmodus heraus.
  **Zwei Token dürfen NICHT umdefiniert werden**, weil sie zwei Rollen tragen:
  `--color-white` (Kartenfläche UND Schrift auf farbigen Knöpfen) und
  `--color-rose-primary` (Linkfarbe UND Knopffläche). Für die gibt es gezielte
  Flächenregeln.
  **Diese Regeln stehen in `@layer nachtmodus`, angemeldet NACH `utilities`.**
  Eine Regel in `components` verliert gegen jede Utility, egal wie spezifisch —
  Schichtreihenfolge schlägt Spezifität. Genau daran ist der erste Anlauf
  gescheitert (Karten blieben reinweiß). Ungelayert wäre die Falle aus B7.
  **Der Seed setzt `nachtmodus` fest auf `hell`.** Sonst hinge jede
  Admin-Referenzaufnahme an der Tageszeit statt an den Daten.
- **`src/app/globals.css` benutzt kein `@layer`.** Tailwind v4 legt seine
  Utilities in `@layer utilities`; eine blanke Projektklasse schlägt deshalb
  JEDE Utility (`class="bildgruppe mb-8"` bliebe wirkungslos). Wer einen Wert
  von außen überschreibbar machen will, braucht `@utility`. Siehe
  `audit/offene-befunde.md` B7.
- **Vor und nach jedem Layout- oder Struktur-Umbau die Referenzaufnahmen
  fahren:** `npx playwright test seiten-referenz admin-referenz` (117
  Aufnahmen: elf öffentliche Seitentypen und 28 Admin-Seiten × drei Breiten).
  Was sich ändern DARF, wird vorher benannt und danach gezielt neu aufgenommen —
  nie pauschal mit `--update-snapshots`.
  **Ändert ein Umbau eine Seite, die noch keine Aufnahme hat, wird sie ZUERST
  aufgenommen** — sonst gibt es hinterher nichts zu vergleichen. Ein Zustand,
  den keine Adresse zeigt (z. B. die Statusmeldung), braucht eine eigene
  Aufnahme mit dem passenden Suchparameter.
  **Was vom LAUF abhängt statt von den Daten** (Tagesdatum, Aufrufzähler)
  bekommt `data-referenz-maske="true"` im Markup und die Seite `maskiert: true`
  in ihrer Liste. Die Mechanik prüft beides gegeneinander: eine angemeldete
  Maske, die nichts trifft, ist ein Fehler — genau so war sie ein halbes Jahr
  wirkungslos.
  **Das ist ein ÖRTLICHES Werkzeug und läuft in CI nicht:** Der Läufer rastert
  Schrift anders, die Seiten werden dort unterschiedlich hoch (Zahlen in
  `playwright.config.ts` und `audit/offene-befunde.md` B9). Wer es zum Gate
  machen will, legt zuerst die Rasterungsumgebung fest — die Toleranz wird
  NICHT angehoben.

## Entwürfe im öffentlichen Bereich (08/2026) — nicht verhandelbar
Ein angemeldeter Admin sieht Startseite, Rezept-/Reiseliste und die drei
Detailseiten MIT seinen Entwürfen (Plakette „Entwurf"); alle anderen sehen sie
nicht. Die Regel steht EINMAL, in `src/lib/entwurfsansicht.ts`.

- **Der Parameter `sichtbarkeit` ist PFLICHT** und ein ausgeschriebenes Wort
  (`"nur-veroeffentlicht"` / `"auch-entwuerfe"`), kein `boolean`. Kein
  Vorgabewert — weder der sichere noch der bequeme: Eine Vorgabe macht genau
  die Aufrufstellen unsichtbar, an denen später jemand etwas ändert. Wer eine
  neue Abfrage schreibt, wird vom Übersetzer gefragt.
- **Erst nicht laden, dann nicht anzeigen — nie umgekehrt.** Was eine
  Server-Komponente an ihre Kinder reicht, steht im RSC-Payload und im HTML.
  „Laden und ausblenden" liefert den Entwurf im Quelltext mit. Die
  Entscheidung gehört in die WHERE-Bedingung bzw. unmittelbar hinter den
  Lader, nicht ins Layout (ein Layout kann die Datenabfrage seiner `children`
  nicht verhindern) und niemals in eine Client-Komponente.
- **Maschinen und Nebenwege bleiben bei Veröffentlichtem** — auch für den
  Angemeldeten: sitemap.xml, llms.txt, robots.txt, Suche, Weltkarte,
  Navigation, „ähnliche Rezepte", Kategorie- und Filterseiten, Newsletter,
  Druckansicht. `loadSeoContent()` bekommt KEINEN Sichtbarkeits-Parameter;
  sein Name ist die Zusage.
- **Ein Entwurf trägt KEIN JSON-LD** — auch nicht auf seiner eigenen
  Detailseite, die nur der Angemeldete öffnen kann. Strukturierte Daten sind
  eine Ausgabe für Maschinen, dieselbe Klasse wie Sitemap und llms.txt; ein
  Werkzeug, das die Seite in der Sitzung des Redakteurs liest (Erweiterung,
  Lesezeichendienst, Link-Vorschau), bekäme sonst einen unveröffentlichten
  Beitrag als `Recipe`/`Article` beschrieben — mit URL, Bild und einem
  Erscheinungsdatum, das es nicht gibt. Die drei Detailseiten prüfen dafür
  `istEntwurf(status)`; gemessen wird es in
  `tests/e2e/entwurf-sichtbarkeit.spec.ts` samt Gegenprobe an einer
  veröffentlichten Seite (sonst bliebe die Zusage auch dann grün, wenn das
  JSON-LD überall verschwände).
- **Kein Vorschau-Modus an einer indexierbaren URL.** Kein `?vorschau=1`, kein
  Token: Die Detailseiten tragen `alternates.canonical` auf die öffentliche
  Adresse, ein Parameter würde Entwurfsinhalt unter der kanonischen URL
  ausliefern. Sichtbarkeit hängt an der Sitzung, nicht an der Adresse.
- **Die Auslieferung trägt das mit:** Jede öffentliche Route ist
  `force-dynamic`, Next liefert dadurch `Cache-Control: private, no-store`.
  Fällt das weg, könnte ein geteilter Cache die für den Admin gerenderte
  Antwort an Anonyme geben. `tests/e2e/entwurf-sichtbarkeit.spec.ts` misst den
  Kopf, statt ihn vorauszusetzen — dort steht auch die vollständige Matrix
  (jede Adresse einmal mit und einmal ohne Sitzung). Wer hier etwas ändert,
  fährt diesen Spec.

## Gemeinsame Bausteine — benutzen statt abschreiben
Wer im Admin eine Seite anlegt oder ändert, nimmt diese und schreibt sie nicht
neu (B6, 08/2026):
- `<Meldung text={…} />` + `meldungAus(searchParams)` — die Statusmeldung über
  der Seite. Trägt `role="status"`; von Hand vergisst man das.
- `<Statuschip ton="gruen|gelb|blau|grau">` — die farbige Statusplakette.
- `<LoeschForm action={…} id={…} />` — das Löschen-Formular. Vorbelegt auf den
  Regelfall; `gestalt` und `beschriftung` nur für die Ausnahmen. **Eine
  Rückfrage vor dem Löschen gehört, wenn sie kommt, HIERHIN — einmal.**
- `listImageChoices()` (`src/lib/media.ts`) — die Auswahlliste für JEDEN
  `<ImagePicker>`. Sie führt neben Vorschau und Originalmaßen die große
  Variante (`fullUrl`) und den Fokuspunkt mit. **Daran hängt der Knopf
  „Ausschnitt" unter dem gewählten Bild**: Ohne `fullUrl` lässt der Picker ihn
  weg. Reise-Editor, Rezept-Editor und Zutaten-Seite bauten die Liste einmal
  selbst und ließen genau diese Felder weg — mit dem Ergebnis, dass sich der
  Bildausschnitt dort ein halbes Jahr lang nicht einstellen ließ, obwohl der
  Picker es konnte. Wer eine zweite Liste anlegt, holt diesen Ausfall zurück.
- In Tests: `frischeDb("kurzname")` am MODULANFANG (nicht in `beforeAll` —
  `DATA_DIR` muss stehen, bevor etwas `@/db` auswertet) und `adminAnlegen()`.
  Die Helfer dürfen `@/db` nicht statisch importieren; `tests/frische-db-helfer.test.ts`
  hält das fest.

## Arbeitsweise
- Deutsch in Kommentaren, Commits, UI-Texten. Kleine, atomare Commits.
- Committer: `Claude <noreply@anthropic.com>`; Push auf den Arbeits-Branch.
- Tests zuerst rot, dann grün; Verhalten mit Playwright/vitest real verifizieren.
- Temporäre Dateien ins Scratchpad, nie ins Repo.
- **Vor jedem Push den VOLLEN Gate-Lauf lokal fahren** (nicht nur die geänderten
  Skripte) — Root-Cause-Disziplin heißt auch, rote Checks nicht erst in CI zu
  entdecken.
- **IMMER den PR beobachten (angeordnet, verbindlich):** Nach jedem erstellten
  ODER aktualisierten Pull Request den PR abonnieren (CI- **und** Review-
  Aktivität, `subscribe_pr_activity`) und dranbleiben, bis er gemergt/geschlossen
  ist — Fehlschläge autonom an der Wurzel fixen (kein Workaround) und Review-
  Kommentare beantworten, sobald sie eintreffen. Nicht abwarten, bis jemand fragt.

## Betrieb (Kurzüberblick)
- Next.js 16 standalone in podman; Deploy: `./deploy.sh` auf dem Server
  (Schnellpfad, Layer-Cache, Healthcheck) oder Admin-Panel „Aktualisierung".
- Selbst-Monitor: alle 5 min SLO-Check; bei Verletzung E-Mail-Alarm über
  SMTP-Settings (`src/lib/observability.ts`, `audit/slo.md`).
- Backups: Pre-Deploy-DB-Backup + `deploy/backup.sh`; Restore-Drill:
  `scripts/regime/restore-drill.sh`.
- Erhebung: `scripts/regime/erhebung.sh [--basis <url>]` auf dem Server —
  beantwortet immer dieselben Fragen (M1–M6) und maskiert JEDE Zeile, damit die
  Ausgabe in dieses ÖFFENTLICHE Repository darf. Misst und weist aus, deckelt
  nicht.

## Takeover (Mensch, Break-Glass)
Ein kompetenter Engineer ohne Vorwissen: (1) README §Setup folgen,
(2) `npm ci && npm test` (muss grün sein), (3) diese Datei + Verfassung lesen,
(4) kleinste Änderung über das volle Gate schieben. Zeit bis zur ersten
sicheren Änderung bitte messen und in `audit/` notieren (A-37-Drill).
