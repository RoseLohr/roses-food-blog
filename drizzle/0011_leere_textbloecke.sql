-- Textblöcke ohne sichtbaren Inhalt entfernen.
--
-- Sie entstanden im Editor: Ein Klick auf „H2", „H3" oder „❝" in einem leeren
-- Textblock hinterließ `<h2><br></h2>`, und daraus machte htmlToMarkdown die
-- Zeichenkette `##`. Die ist nicht leer, überlebte also die `.trim()`-Prüfung
-- im Speicherweg und wurde gespeichert. Im Bericht rendert sie zu einem leeren
-- `<h2>`: unsichtbar, aber mit Abstand darüber und darunter.
--
-- Der Schaden war nicht der Abstand, sondern die BLOCKGRENZE: Eine Bildzeile
-- endet an jedem Nicht-Bildblock. Stand so ein unsichtbarer Block zwischen
-- zwei Bildern, brach die Zeile — zwei Bilder nebeneinander, das dritte
-- darunter, dazwischen die weiße Fläche. Weder im Editor noch im Bericht war
-- zu sehen, woran es lag.
--
-- Die Ursache ist in src/lib/rich-text.ts behoben (ein Block ohne sichtbaren
-- Inhalt erzeugt kein Markdown mehr) und in src/lib/travel-save.ts (dieselbe
-- Prüfung serverseitig). Diese Migration räumt auf, was vorher entstanden ist:
-- Die Bildblöcke rücken damit wieder zusammen, ihr gespeichertes
-- `mit_vorherigem` wirkt sofort, und die leeren Einträge im
-- Inhaltsverzeichnis verschwinden.
--
-- Bewusst KONSERVATIV: gelöscht wird nur, was nach Abzug reiner Auszeichnung
-- (Raute, Zitatpfeil, Listenzeichen, Zaun eines Codeblocks) und unsichtbarer
-- Zeichen (Leerraum, geschütztes Leerzeichen U+00A0, Nullbreiten-Leerzeichen
-- U+200B, Wortverbinder U+2060, BOM U+FEFF, &nbsp;) NICHTS übrig lässt.
-- Trenner (`---`) und Bilder bleiben: sie zeigen auch ohne Text etwas.
DELETE FROM `travel_block`
WHERE `type` = 'text'
  -- Bilder zeigen etwas, auch ohne Text.
  AND `markdown` NOT LIKE '%![%](%'
  -- Trenner ebenso: drei oder mehr gleiche Zeichen. GLOB statt LIKE, weil in
  -- LIKE der Unterstrich ein Platzhalter wäre.
  AND TRIM(`markdown`) NOT GLOB '---*'
  AND TRIM(`markdown`) NOT GLOB '[*][*][*]*'
  AND TRIM(`markdown`) NOT GLOB '___*'
  AND (
    -- (a) Leerer Eintrag einer nummerierten Liste („1.", „12)"). Ziffern
    --     werden in (b) NICHT pauschal abgezogen — sonst verschwände ein
    --     Absatz, der nur aus einer Jahreszahl besteht. Deshalb als eigene
    --     Form, gedeckelt auf drei Stellen: Was darüber liegt, räumt das
    --     nächste Speichern weg (der Speicherweg schreibt alle Blöcke über
    --     hatSichtbarenInhalt neu).
       TRIM(`markdown`) GLOB '[0-9].'          OR TRIM(`markdown`) GLOB '[0-9])'
    OR TRIM(`markdown`) GLOB '[0-9][0-9].'     OR TRIM(`markdown`) GLOB '[0-9][0-9])'
    OR TRIM(`markdown`) GLOB '[0-9][0-9][0-9].' OR TRIM(`markdown`) GLOB '[0-9][0-9][0-9])'
    -- (b) Nach Abzug reiner Auszeichnung (Raute, Zitatpfeil, Listenzeichen,
    --     Zaun eines Codeblocks, Hervorhebung) und unsichtbarer Zeichen
    --     (Leerraum, U+00A0, U+200B, U+2060, U+FEFF, &nbsp;) bleibt nichts.
    OR TRIM(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          `markdown`,
          '&nbsp;', ''),
          char(160), ''),
          char(8203), ''),
          char(8288), ''),
          char(65279), ''),
          '```', ''),
          '~~~', ''),
          '#', ''),
          '>', ''),
          '*', ''),
          '_', ''),
          '`', ''),
          '~', ''),
          '-', ''),
          '+', ''),
          '.', ''),
          char(9), '')
      , ' ' || char(10) || char(13)) = ''
  );
