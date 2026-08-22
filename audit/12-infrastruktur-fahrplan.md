# Fahrplan zu den offenen Spuren aus `11-infrastruktur-befund.md`

**Stand: 2026-08-22.** Dieses Dokument entscheidet nichts am Server. Es hält
fest, was von den Umsetzungsplänen zu den Spuren A–F nach einer Gegenprüfung
übrig geblieben ist, und trennt sauber, was im Repository machbar ist, was
erst eine Messung braucht und was eine Entscheidung der Betreiberin ist.

## Wie dieser Fahrplan entstanden ist

Sechs Spuren wurden getrennt und ohne Kenntnis voneinander untersucht, jede
mit dem Auftrag, ihre Belege am Quelltext zu führen. Zu jedem Ergebnis lief
anschließend eine **Gegenprüfung mit dem ausdrücklichen Auftrag zu widerlegen**.

Das Ergebnis ist unbequem und deshalb wichtig: **Alle sechs Umsetzungspläne
wurden von ihrer Gegenprüfung als nicht tragfähig zurückgewiesen** — nicht
wegen Kleinigkeiten, sondern mit jeweils mindestens einem blockierenden
Einwand. Die BEFUNDE tragen weitgehend; die FAHRPLÄNE trugen nicht.

Zwei Fehlerklassen traten in fünf von sechs Plänen auf:

1. **Belege, die nicht fehlschlagen können.** Ein Schritt, dessen Nachweis
   auch dann grün ist, wenn die Änderung nichts bewirkt hat. Beispiel: „Seite
   umstellen, Beleg: Änderung sofort sichtbar" — auf einer weiterhin dynamisch
   gerenderten Seite trivial wahr.
2. **Reihenfolgen, die der vorhandene Deploy gar nicht herstellen kann.**
   `deploy.sh` startet die Anwendung in Abschnitt 5 und spielt das
   Proxy-Schnipsel erst in Abschnitt 9c ein. „Beide Hälften im selben Zug" ist
   damit nicht erfüllbar — und `fail()` rollt den Container nicht zurück.

Beide Klassen sind in diesem Fahrplan die Messlatte für jeden Schritt.

## Sofort erledigt (in diesem Zug, ohne offene Voraussetzung)

Diese Punkte fielen bei der Gegenprüfung als Nebenbefunde an, waren im
Repository belegbar und hingen an keiner Messung:

- **Sieben Selbsttests liefen nirgends** — `bundle-budget`,
  `independent-verify`, `license-scan`, `lighthouse-budget`, `secret-scan`,
  `separation-check`, `source-gates`. Für `secret-scan` (B-06, STOP-SHIP) und
  `source-gates` (A-16/B-13) hieß das: die Kontrolle lief, ihr
  Wirksamkeitsnachweis nie. Wurzel war die Aufzählung, nicht die Zahl —
  `tests/gate-verdrahtung.test.ts` entdeckt jetzt, statt aufzuzählen.
- **Der Shell-Syntax-Schritt sah neue Dateien nicht** (`git ls-files '*.sh'`
  ohne `--others --exclude-standard`). Dieselbe Klasse wie der Vorfall vom
  2026-08-21; die Regressionssperre dafür hatte selbst die Lücke.
- **Ein TLS-Fehler am Ursprung wurde der Kompression angelastet** — siehe
  Spur A1/B2/F1. Datiert: `npm-20` läuft am 31.10.2026 ab.
- **Vier Sicherheitsregeln waren mit falscher Begründung entschärft** — siehe
  den eigenen Abschnitt „DAST" unten.
- **Der Deploy-Webhook-Kommentar nennt einen falschen Default-Branch.**
  `src/app/api/deploy-hook/route.ts` behauptet, der Default-Branch dieses
  Repositories sei `claude/roses-food-blog-vxs3vm`; über die GitHub-API
  geprüft ist er `main`. Wer den Kommentar liest, schließt daraus, dass ein
  Push auf den Arbeits-Branch ein Produktionsdeployment auslöst. Gehört in die
  A2/A3-Änderung, weil es dieselbe Fehlerklasse ist.

## Spur A2/A3 — Doku beschreibt einen Server, den es nicht gibt

**Trägt:** Der reine Doku-Anteil. README §4, die Portangaben (`3000` statt des
tatsächlichen Ports), `docs/ABNAHME.md`, die „Cloudflare, falls davor"-Formel.
Das ist der Teil, der den A-37-Drill unmittelbar rettet, und er hängt an keiner
Messung.

**Blockiert:**

- `bootstrap.sh` Abschnitt 5 darf **nicht ersatzlos** gestrichen werden. Die
  Begründung „deploy.sh erledigt das besser" ist falsch: Auf einem frischen
  Server gibt es keinen Proxy-Host, `npm-container-finden.sh` ordnet nichts zu,
  `kompression-pruefen.sh --ebene ursprung` scheitert und `deploy.sh` bricht ab
  — **noch bevor** der geplante Ersatzhinweis gedruckt würde. Der
  Proxy-Host-Schritt muss **vor** `./deploy.sh` in die Reihenfolge, nicht in
  die Abschlusshinweise danach.
- `deploy/nginx.conf.example` darf **nicht gelöscht** werden, solange
  `client_max_body_size 200m` und `proxy_read_timeout 600s` für den
  Admin-Import (200 MB, `route.ts`) nirgends sonst niedergeschrieben sind.
  `/data/nginx/custom/server_proxy.conf` ist dafür **kein** Ersatz: Die Datei
  gilt für ALLE Domains auf diesem Proxy — ein `location`-Block darin greift in
  fremden Betrieb ein. Und es gibt bis heute keinen Einspielweg dafür:
  `deploy.sh` spielt genau eine Datei ein.
- Die neue Aussage „Proxy-Host auf `127.0.0.1:$PORT`" wäre **unbelegt**. Im
  NPM-Container ist `127.0.0.1` die eigene Loopback-Adresse, nicht die des
  Hosts. Wie der funktionierende Proxy-Host die Anwendung erreicht, steht
  nirgends im Repository — das wäre dieselbe Fehlerklasse, die diese Spur
  beheben soll.

**Nächster Schritt:** Doku korrigieren, **ohne** zu löschen und **ohne** die
Upstream-Adresse zu behaupten; `nginx.conf.example` im Kopf als „historisch,
beschreibt nicht diesen Server; die Werte hier sind die einzige Niederschrift"
kennzeichnen. Löschung und `bootstrap.sh`-Umbau an die Messung M1/M2 binden.

*Inventar erstellt (2026-08-22).* Fünf Bereiche einzeln durchgegangen — README,
`docs/`, `bootstrap.sh` + `deploy/`, Quelltext-Kommentare, und die Tests, die
den Host-nginx-Betrieb heute festhalten —, jeder mit einer Gegenprüfung, die
jede Datei-Zeile am Arbeitsbaum nachgeschlagen hat. Von 565 nachgeschlagenen
Referenzen waren **53 Zeilennummern falsch, 31 Ersatzaussagen unbelegt und 43
Fundstellen übersehen**; alle drei Klassen sind vor der Konsolidierung
korrigiert worden. Ergebnis: sechs Änderungsgruppen (Vorlagenkopf, Portangaben,
README, `docs/`, Quelltext-Kommentare, DAST-Begründung) mit Reihenfolge und
Gate-Risiko je Gruppe.

Zwei Dinge, die das Inventar zusätzlich festhält:
- **`tests/kompression.test.ts` nagelt die falsche Welt aktiv fest.** 14 seiner
  22 Prüfungen werden rot, sobald A3 *entfernt* statt *kennzeichnet* — unter
  anderem verbietet `:110-137` ausgerechnet `gzip_vary on;`, also die am
  Ursprung richtige Direktive.
- **Eine Prüfung gegen Doku-Drift gibt es heute nicht** und kann es für
  Aussagen über die Topologie auch nicht geben, solange M1–M8 offen sind.
  Möglich und lohnend sind zwei rein statische Gates: ein Negativ-Gate gegen
  die Wiedereinführung fester Portzahlen, `certbot`, `sites-available` außerhalb
  ausdrücklich historischer Blöcke, und ein Querverweis-Gate (`README §N`,
  `ASSUMPTIONS Bxx`, Dateipfade in Codeblöcken, die toten A-Nummern). Beides
  ist Regressionsschutz, nicht Drift-Erkennung — und muss auch so heißen.

  *Gebaut 2026-08-22:* `scripts/regime/doku-gate.mjs`, blockierend in CI, mit
  Selbsttest. Es prüft drei Klassen: veraltete Anleitung (nur in dem, was
  Markdown als Code liest, ausgenommen unter einer Überschrift mit „historisch" —
  Fließtext darf weiter sagen, dass es certbot hier nicht gibt), tote
  Annahmenummern und Pfadverweise ins Leere. Gemessen am Bestand: 312
  Pfadverweise, 4 historische Codeblöcke, alle in Ordnung.

  **Der Pflicht-Approver hat in SECHS Runden SECHZEHN Umgehungen gefunden,
  eine siebzehnte kam beim eigenen Nachsehen dazu** — dreizehn von ihm benannt,
  vier beim Nachziehen derselben Klasse. Sechs davon haben
  dieselbe Form: *eine Prüfung, die sich still selbst abschaltet.* Eine
  Shell-Zeile „# historisch" INNERHALB eines Codeblocks setzte die Ausnahme für
  alles Folgende; ein Zaun aus drei Tilden galt gar nicht als Code; eingerückter
  Code wurde nie geprüft; ein Zaun aus VIER Backticks wurde von einem inneren
  Dreier geschlossen; nur Kommentare am Zeilenanfang wurden gesehen, ein
  nachgestelltes „// A7" lief durch; die Zeilenprüfung sprang bei einer
  Abkürzung mit Fantasiezeile ab; Zeilennummer an einem VERZEICHNIS, Bereich
  rückwärts und Zeile 0 galten als gültig; und die Zeilenzählung addierte bei
  abschließendem Umbruch eine Phantomzeile.

  **Die eigentliche Lehre steckt in der Verteilung.** Fünf der acht Löcher waren
  keine Flüchtigkeitsfehler, sondern Sonderfälle von Markdown und TypeScript —
  entstanden, weil das Gate beide Sprachen VON HAND zerlegte. Ein
  handgeschriebener Zerleger hat so viele Löcher, wie das Format Sonderfälle
  hat; jede Runde hätte weitere gefunden. Die Wurzel ist nicht der einzelne
  Sonderfall, sondern der Nachbau.

  Beide Zerleger gibt es im Projekt längst: `marked` treibt
  `src/lib/markdown.ts`, `typescript` treibt `npm run typecheck`. Das Gate
  benutzt jetzt sie. Damit fallen alle fünf Grammatik-Löcher **ersatzlos weg**
  statt geflickt zu werden — und ein Fall, den keine der Handfassungen
  beherrschte, fällt gratis mit ab: `const r = /a\/\//; // A5`. Der reine
  Scanner liest daraus „//; // A5" und liegt falsch; der Parser liefert
  „// A5". Übrig als eigene Logik bleiben die drei Löcher, die von Dateien und
  Zahlen handeln statt von Grammatik.

  **Runde drei fand ein neuntes Loch — und es war das gefährlichste**, weil es
  die Prüfung nicht umging, sondern ihren Zweck aushöhlte: Ein Pfadverweis galt
  als gültig, sobald er ein eindeutiger PRÄFIX einer vorhandenen Datei war.
  Damit lief jeder vertippte oder verkürzte Pfad grün durch — nachgemessen an
  drei Beispielen, die die Vorfassung alle auflöste und die neue Fassung alle
  zurückweist. Ausgerechnet die Frage „gibt es diese Datei?" wäre damit
  wirkungslos gewesen.

  Gebraucht wird die Abkürzung an GENAU EINER Stelle im ganzen Bestand: Die
  Verfassung nennt das Residuals-Register bei seiner Nummer, und sie ist
  hash-attestiert — sie für eine Linting-Bequemlichkeit umzuschreiben wäre die
  falsche Richtung. Die Ausnahme heißt deshalb jetzt, was sie ist: zweistellige
  Dokumentnummer als letztes Wegstück, gefolgt von einem Bindestrich in der
  gefundenen Datei. Benannt statt offen. Im selben Zug fiel eine Bereinigung
  nachgestellter Interpunktion weg, die dasselbe tat — Tippfehler waschen.

  **Runde vier fand zwei weitere, und beide sind lehrreich.** Eine Überschrift
  IN einem Zitat oder Listenpunkt machte einen Abschnitt auf und schaltete die
  „historisch"-Ausnahme für alles Folgende ein — auch außerhalb des Zitats; an
  beiden Formen nachgestellt. Und die Liste der obersten Verzeichnisse war
  VERDRAHTET und unvollständig: `.zap`, `.lighthouse`, `.admin-data` und
  `.repro-data` fehlten, Verweise dorthin wurden gar nicht erst geprüft. Sie
  wird jetzt aus dem Repository hergeleitet — dieselbe Lehre wie beim
  Shell-Syntax-Schritt und bei `tests/gate-verdrahtung.test.ts`: entdecken statt
  aufzählen. Die Abdeckung stieg dadurch von 300 auf 312 Verweise.

  Zum zweiten Teil desselben Befunds — nackte Dateinamen wie „package.jso" —
  steht die Messung im Skriptkopf: Von über neunzig solchen Stücken in der
  Dokumentation sind neun tatsächlich Dateien im Wurzelverzeichnis; der Rest
  sind Kurzformen für Dateien in Unterverzeichnissen, Versionsnummern, Adressen
  und Ausdrücke aus dem Quelltext. Eine Prüfung darauf bräuchte eine
  Ausnahmeliste, und die ist hier ausgeschlossen. Das bleibt eine benannte
  Grenze, keine stille.

  **Runde fünf fand den ersten echten Ausbruch.** Die Auflösung eines
  Pfadverweises fragte nur, ob auf der Platte etwas an dieser Stelle liegt —
  nicht, ob es zu diesem Repository gehört. Ein Verweis auf eine Datei
  ausserhalb galt damit als gültig, und die Zeilenprüfung hätte sie anschließend
  zum Zählen gelesen. Der Approver nannte den Weg über das ausdrückliche
  „Punkt-Schrägstrich"; beim Nachstellen zeigte sich, dass der Aufstieg über
  Punkt-Punkt durch JEDES zugelassene Wurzelverzeichnis genauso funktioniert —
  das Loch war größer als der benannte Sonderfall. Geprüft wird jetzt zweierlei:
  dass der aufgelöste Pfad innerhalb der Repo-Wurzel bleibt, und dass er in der
  Dateiliste des Repositories vorkommt. Vorhandensein allein genügt nicht mehr.

  Dazu ein zweiter Befund derselben Runde: Ein vorangestellter Bindestrich
  verdeckte die tote Nummer, „laut Annahme-A7" blieb grün. Die Ausnahme ist
  gefallen; am Bestand nachgemessen erzeugt das null Fehlalarme.

  **Runde sechs traf die Lehre in ihrem eigenen Rücken.** Zwei der drei neuen
  Löcher waren wieder Markdown-Sonderfälle — und zwar an der Stelle, an der ein
  Rest Handarbeit übrig geblieben war, nachdem die Blockzerlegung längst auf
  `marked` stand: Inline-Code-Spannen wurden gar nicht als Code geprüft (eine
  Anweisung mitten im Satz blieb grün), und der eigene Backtick-Wähler verbot
  Leerraum, sodass eine nach CommonMark gültige Spanne mit Rand-Leerraum
  ungeprüft blieb. Beides ist jetzt ebenfalls Token-Arbeit. Von sechzehn Löchern
  kamen damit acht aus nachgebauter Grammatik — die Hälfte.

  Der dritte war der zweite Ausbruch: Das Containment rechnete rein lexikalisch,
  ein verfolgter Symlink aus dem Repository heraus kam durch. Geprüft wird
  zusätzlich der aufgelöste echte Pfad; der Selbsttest legt dafür wirklich einen
  Symlink an, statt die Annahme zu glauben.

  Damit die Regel gegen Fließtext nicht kippt, ist sie gemessen worden, bevor
  sie kam: Von 2468 Inline-Spannen in README und `docs/` tragen drei ein
  verbotenes Wort, alle drei einwortig — Teil genau des Zitatblocks, der die
  Abwesenheit feststellt. Eine Spanne zählt deshalb nur als Anweisung, wenn sie
  mehr als ein Wort ist. Null Fehlalarme am Bestand.

  **Das siebzehnte Loch habe ich selbst gesucht, statt auf Runde sieben zu
  warten — und es war die reinste Form der ganzen Klasse:** Aus einem
  Unterverzeichnis gestartet prüfte das Gate NICHTS und meldete das als „grün".
  `git ls-files` liefert Pfade relativ zum Aufrufverzeichnis; aus `src/` heraus
  fand die Filterung keine einzige Markdown-Datei. Das ist genau der Fehlertyp,
  den dieser Fahrplan im Kopf als „Belege, die nicht fehlschlagen können"
  benennt — im eigenen Werkzeug.

  Behoben doppelt, weil eine Hälfte nicht genügt: Die Dateiliste kommt jetzt aus
  der Repo-Wurzel, UND ein Lauf ohne eine einzige geprüfte Datei ist ein
  Fehlschlag statt eines Erfolgs. Der Selbsttest fährt das Gate dafür in einem
  frisch angelegten leeren Repository und verlangt den Rückgabewert 1 — die
  Bedingung nur hinzuschreiben wäre wieder ein Beleg, der nicht fehlschlagen
  kann. Die Ausgabe nennt seither auch die Zahl der geprüften Dateien, damit ein
  Leerlauf beim Lesen auffällt.

  70 Selbsttestfälle, Gegenprobe gegen alle sechs Vorfassungen gefahren (alle
  siebzehn Löcher rutschen dort durch), dazu eine Positivkontrolle am echten
  Baum: drei eingeschleuste Verstöße in README, `docs/` und `src/` werden mit
  exakter Zeilennummer gemeldet.

  Die Gegenbeispiele stehen hier bewusst OHNE Backticks: Das Gate kann eine
  Veranschaulichung nicht von einem echten Verweis unterscheiden — und hat
  genau diesen Absatz beim ersten Lauf beanstandet. Das ist kein Mangel,
  sondern die Kontrolle bei der Arbeit.

  **Zwei Dinge, die es NICHT tut, damit sich niemand darauf verlässt:**
  - Feste Portzahlen bleiben ungeprüft. `localhost:3000` ist im
    Entwicklungsabschnitt richtig und am Proxy falsch; ein Gate, das beides
    nicht auseinanderhalten kann, hätte eine Ausnahmeliste gebraucht — und
    eine Ausnahmeliste ist der Anfang der Weichspülung. Die Portfrage hängt
    ohnehin an M1.
  - `ASSUMPTIONS Bxx` bleibt ungeprüft: `B1`–`B10` sind gleichzeitig die
    Befundnummern in `audit/offene-befunde.md` und `B-06`/`B-13` die
    Prüfkennungen. Drei Bezugssysteme auf demselben Zeichen — mechanisch nicht
    trennbar, ohne zu raten.

  In `audit/` gilt eine engere Regel, mit inhaltlichem Grund: Ein Fahrplan nennt
  planmäßig Dateien, die es noch nicht gibt (`scripts/regime/erhebung.sh` aus
  Spur A1). Ein Verweis MIT Zeilennummer kann das nie sein — man zitiert keine
  Zeile einer Datei, die nicht existiert. Genau die werden dort geprüft.

  **Das Gate war beim ersten Lauf rot, auf zwei echten Fundstellen**, die das
  A2/A3-Inventar übersehen hatte, weil es nur Doku durchsucht hatte:
  `src/i18n/de.ts` verwies auf eine tote Annahmenummer, und `src/lib/mailer.ts`
  behauptete „Konfiguration ausschließlich über .env". Das zweite war nicht nur
  eine tote Nummer, sondern **sachlich falsch**: `getSmtpConfig()` liest zuerst
  die Einstellungen aus der Datenbank, `.env` ist bloß der Rückfall. Wer bei
  einer Störung dem Kommentar gefolgt wäre, hätte in der falschen Datei gesucht.

## Spur A1/B2/F1 — Erhebung als Regime-Skript, Schwellen, Kadenz

**Trägt:** `scripts/regime/erhebung.sh` als Skript. Zertifikatsrestlaufzeit
gehört in die Kennzahlen — sie ist der einzige streuungsfreie und zugleich
datierte Wert.

*Teilweise erledigt (2026-08-22).* Ein abgelaufenes Ursprungszertifikat ließ
`kompression-pruefen.sh` und damit `deploy.sh` scheitern, **ohne den Grund zu
nennen** — mit `--aufloesen` sogar mit der Meldung „blieb wirkungslos", weil
der Wirksamkeitstest `%{remote_ip}` liest und der bei einem TLS-Abbruch leer
bleibt. Nachgestellt an einem HTTPS-Server mit unbrauchbarem Zertifikat. Das
Skript trennt TLS jetzt von allem anderen und nennt Rückgabewert, Zertifikat
und Restlaufzeit; auf dem Erfolgspfad weist es die Restlaufzeit am Ursprung
aus — **als Auskunft, nicht als Grenze**, und nicht am Rand, wo das Zertifikat
Cloudflare gehört. Damit ist die Fehlermeldung geheilt und die Frist sichtbar.
Eine echte Überwachung ist das nicht: Sie sieht nur, wer deployt.

**Blockiert:**

- **HTML-Rohgröße taugt nicht als harte Schwelle.** Die Startseite wechselt
  ihren Inhalt an jeder ISO-Wochengrenze (Saisonbox) und durch Besucher-Likes
  („Beliebteste Rezepte"). Ein Wochentimer gegen einen wochenweise springenden
  Wert erzeugt Falsch-Rot genau dann, wenn niemand hinsieht.
- **Drei der fünf vorgeschlagenen „booleschen" Schwellen beschreiben Zustände,
  die heute nicht gelten** (`real_ip_header`, `proxy_http_version`,
  `www.`-Status). Gepinnt wären sie ab dem ersten Lauf rot. Sie setzen C2/C3/C4
  voraus, nicht umgekehrt.
- **Die Kadenz (F1) hat keinen Meldepfad.** Ein Ergebnis, das die Anwendung
  liest, ist bei jedem Totalausfall stumm — genau die Lücke, die `audit/slo.md`
  bereits benennt. Und nichts meldet, wenn der Timer gar nicht lief. Ohne
  Frische-/Totmann-Prüfung wiederholt das die vier unbemerkten DAST-Läufe.
- **Port nicht „aus `podman ps` ableiten".** Autoritativ ist `PORT` aus der
  `.env` (so machen es `deploy.sh` und `rollback.sh`); die Portspalte ist genau
  die Konstruktion, an der die Erhebung selbst gescheitert ist.

**Nächster Schritt:** A1 ja, aber **messen und ausweisen statt deckeln**. B2
erst nach einer Nachmessung. F1 zurückstellen, bis der Meldepfad entschieden
ist — wenn es auf dem Host keinen Kanal außerhalb der Anwendung gibt, ist das
der ehrliche Befund, und F1 bleibt offen.

## Spur C2/C3/C4 — Proxy-Konfiguration

**Trägt:** Die Grundrichtung. Die eigentliche Schwachstelle ist die Anwendung
(`getClientIp` nimmt den linkesten `X-Forwarded-For`-Eintrag, also frei
wählbaren Client-Text), nicht nur der fehlende `real_ip`-Block.

C4 ist der einzige Punkt mit sichtbarem Nutzerschaden und braucht keine
Vorklärung mehr: Ein 525 entsteht nur, wenn Cloudflare die Anfrage annimmt und
selbst zum Ursprung verbindet — der proxied DNS-Eintrag für `www.` existiert
also. Der Handgriff liegt in der Cloudflare-Oberfläche.

**Blockiert:**

- **„X-Real-IP bevorzugen" ist eine Festlegung ohne Beleg.** Ob der aktive
  Proxy diesen Kopf überhaupt setzt, weiß niemand. Setzt er ihn nicht, wird die
  Lage schlechter: Der Kopf wäre dann reine Client-Eingabe.
- **Beide Hälften „im selben Zug" ist mit `deploy.sh` nicht herstellbar**
  (Anwendung Abschnitt 5, Proxy Abschnitt 9c). Und ein leerer Zustand der
  Cloudflare-Bereichsliste ist nach der App-Änderung **nicht** die sichere
  Seite, sondern der Ausfall: Alle Besucher teilen sich dann einen
  Ratenbegrenzungs-Topf, Newsletter (5/15 min) und Admin-Login (10/15 min)
  sperren.
- **Für eine neue `http.conf` gibt es keinen Wirkungsnachweis.** `nginx -t` ist
  grün, auch wenn das Image die Datei gar nicht einbindet. Bei C1 wurde genau
  diese Lücke geschlossen, indem `deploy.sh` danach die WIRKUNG misst; für C2
  fehlt das Gegenstück.
- **C3 kann seinen eigenen Beleg nicht erfüllen.** Ohne benannten
  `upstream {}`-Block mit `keepalive N;` erzeugt `proxy_http_version 1.1` keinen
  wiederverwendbaren Socket — die versprochene sinkende Verbindungszahl tritt
  nicht ein. Dazu: Ein Keepalive-Pool zum alten Container erzeugt beim
  Deploy-Austausch sichtbare 502er.
- **Der Nebenbefund zu `X-Forwarded-Host` gehört nicht in diese Spur.** Er
  bricht zwei bestehende Tests und entfernt eine bewusst gebaute
  Heilungseigenschaft, die auf einen echten Produktionsvorfall zurückgeht.

**Nächster Schritt:** C4 zuerst (Rand, kein Repo-Anteil), dann Messung M3/M4,
dann C2 in **zwei getrennten Deploy-Läufen** — Proxy zuerst, mit
Wirkungsprüfung dazwischen. C3 nur zusammen mit der Pool-Frage, oder gar nicht.

## Spur D1/D2 — `force-dynamic` auf den öffentlichen Seiten

**Trägt — und dreht den Befund um:** `force-dynamic` ist heute **nicht** die
Ursache der Nicht-Cachebarkeit. Das Root-Layout ruft über `getPublicBaseUrl()`
→ `headers()` den Anfragekontext ab und macht damit **jede** Seite dynamisch.
Die `force-dynamic`-Zeilen sind derzeit wirkungslos; das Entfernen allein
bewirkt nachweislich nichts. Das gehört so in `11-infrastruktur-befund.md`.

**Blockiert:** Der Fahrplan vollständig.

- **Die Leseseite ist nirgends getaggt.** Kein `unstable_cache`, kein
  `"use cache"`, kein `cacheTag` im ganzen `src/`. `revalidateTag` würde Tags
  aufrufen, die niemand gesetzt hat — fehlerfrei und wirkungslos.
- **Nicht nur das Layout ruft `headers()`.** Mindestens acht weitere Stellen
  tun es selbst; jede speist ein Canonical oder JSON-LD, das `seo-gate.mjs`
  erzwingt.
- **`cacheComponents` kollidiert mit einem blockierenden Gate**, das
  `export const dynamic = "force-dynamic"` für die SEO-Artefaktrouten VERLANGT.
- **Vorrendern gegen eine leere Datenbank fällt still**, nicht laut: Ein
  `try/catch` im Branding-Pfad liefert Standardwerte statt zu scheitern. Und es
  gibt keine Revalidierung beim Containerstart.
- **`Vary: RSC` gegenüber Cloudflare** ist das eigentliche Risiko von D3 und
  kam im Plan nicht vor.
- Solange `production_eligible=false` ist, sind die Belege, die einen
  Produktions-Deploy brauchen, ohnehin nicht zu erbringen.

**Nächster Schritt:** D2 auf ein **Entscheidungspapier** reduzieren. Vorher:
(1) die 41 ms Ursprungsmedian aufschlüsseln (SQLite / Render / Serialisierung)
— ohne diese Aufteilung ist der gesamte Nutzen unbelegt; (2) das Cache-Modell
entscheiden; (3) eine falsifizierbare „ist die Seite wirklich gecacht"-Prüfung
bauen, **bevor** irgendeine Seite umgestellt wird. Erst danach über Seiten
reden.

## Spur E2 — `ReadableStream is already closed`

**Trägt:** Der Kern. Die Upload-Route gibt einen Node-Stream als Antwortkörper
zurück; bricht der Client ab, während `fs` weiterschiebt, entsteht genau diese
unbehandelte Ausnahme. Datei über den bereits offenen Deskriptor vollständig
lesen und als Bytes ausliefern behebt Absturzpfad **und** ein gemessenes
Deskriptor-Leck bei `HEAD` in einem Zug. Die ausgelieferten Varianten sind
klein (größte Datei im Bestand: rund 8 KB), Streaming hat hier keinen Zweck.

**Blockiert:**

- **Der vorgeschlagene Regressionstest ist ein Rennen** und als Gate untauglich
  — er kann grün sein, obwohl der Defekt da ist. Deterministisch prüfbar sind
  stattdessen die Deskriptor-Dichtheit als Differenz und eine statische
  Zusicherung, wie sie für genau diese Datei schon existiert.
- **Der geplante Servernachweis kann nichts liefern:** `--trace-uncaught` ist
  wirkungslos, solange ein `uncaughtException`-Listener registriert ist, und
  der dafür nötige Neustart kollidiert mit dem Deploy-Weg. Der Stack steht
  ohnehin bereits im Journal — der vollständige Eintrag genügt.
- **Die Alternativhypothese darf nicht vorher aus dem Befund gestrichen
  werden.** Sie ist derzeit die einzige Offenhaltung einer zweiten Quelle.

**Nächster Schritt:** Der Fix ist repo-seitig machbar und hängt an keiner
Messung — mit deterministischen Prüfungen statt eines Rennens, mit der Länge
aus den gelesenen Bytes statt aus `fstat`, und ohne ein `close` im `finally`,
das den Originalfehler verdeckt. Der Befundtext ändert sich erst nach M6.

## Spur E1/E3/E4 — Absicherung und Aufräumen

**Trägt:** Die Risikohaltung — Behalten-Liste, Export vor dem Löschen,
Verbotsliste, keine Zielzahl für das Aufräumen.

**Blockiert:**

- **Der Proxy wird mit „erster Treffer auf npm|openresty|proxy" gesucht** —
  genau die Heuristik, die dieses Repository nach zwei Approver-Befunden
  abgeschafft hat. Trifft sie daneben, wird das falsche Image exportiert und das
  unersetzliche gelöscht. `scripts/regime/npm-container-finden.sh` existiert
  genau dafür, ist reines Bash+podman und läuft auf einem Host ohne Node.
- **Kein Ausgangsmesswert vor dem Eingriff.** Ohne einen Vorher-Lauf der
  Zertifikatserneuerung kann ein Fehlschlag danach nicht von einem bereits
  bestehenden Schaden unterschieden werden — und mindestens ein Name auf diesem
  Proxy ist nachweislich schon vorher kaputt (`www.`, 525).
- **Zwei Prüfungen können nicht fehlschlagen:** Die Namensprüfung ist bei
  Platzhalter- und Auffangnamen leer erfüllt, und die Firewall-Prüfung sieht die
  Voreinstellung nicht, von der die ganze Wirkung abhängt.
- **Rootless gegenüber rootful ist ungestellt.** Die Anwendung läuft belegt
  rootless, der Proxy belegt 80/443 — die Image-Speicher sind dann getrennt, und
  alle Größenangaben und Kommandos hängen daran.
- **E3 vor A2/A3 räumt nur den Beleg weg:** Ein `bootstrap.sh`-Lauf stellt den
  Host-nginx wieder her, und ein Test erzwingt heute sogar, dass er das kann.
- **Ehrlich dazusagen:** Eine Freigabe nach Quell-IP schließt die direkte
  Erreichbarkeit des Ursprungs nicht, sie verengt sie. Wer eine eigene
  Cloudflare-Zone auf die Adresse zeigen lässt, kommt weiter durch. Die
  Kontrolle, die das schließt, heißt Authenticated Origin Pulls.
- **Ein eingehender Verbraucher fehlt in der Betrachtung:** der
  Deploy-Webhook. Zeigt sein Ziel nicht auf die proxied Domain, stirbt das
  Auto-Deploy nach der Einschränkung still.

**Nächster Schritt:** Reihenfolge umdrehen — A2/A3 vor E3. E4 erst nach der
Speicherfrage. E1 zuletzt, mit Ausgangsmesswert und mit dem vorhandenen
Zuordnungsskript statt einer Heuristik.

## DAST — was ein echter Lauf gezeigt hat (2026-08-22)

`.zap/rules.tsv` stufte fünf Header-Regeln von FAIL auf WARN herab, begründet
mit „in Produktion von nginx gesetzt (in CI aber fehlen)". Für vier davon war
das falsch: Content-Security-Policy, X-Content-Type-Options, X-Frame-Options
und Permissions-Policy setzt die **Anwendung** für jede Route
(`next.config.ts`, `source: "/:path*"`). Sie sind auf dem Draht — an der
gebauten App in genau der Konfiguration von `dast.yml` nachgemessen, auf der
Startseite und auf `/health`.

Die vier stehen wieder auf FAIL. Ein angestoßener Lauf gegen den Arbeitsbranch
belegt, dass das trägt:

```
FAIL-NEW: 0   FAIL-INPROG: 0   WARN-NEW: 9   PASS: 58
```

Keine der verschärften Regeln feuert; `Permissions Policy Header Not Set
[10063]` steht ausdrücklich unter PASS. HSTS (10035) bleibt WARN — die
Anwendung setzt es bewusst nicht, und wo es gesetzt wird, ist nicht erhoben.

**Derselbe Lauf hat aber zwei weitere Befunde freigelegt, beide offen:**

**D-1 — Der DAST-Lauf ist nicht „informativ", er ist fail-closed und seit
Wochen rot.** Der Workflow-Kopf behauptete, er laufe informativ. Tatsächlich
steht `fail_action: true`, und die ZAP-Aktion scheitert bei **jedem** Alarm,
auch bei WARN (Docker-Rückgabewert 2). Neun WARN genügen. Das erklärt die vier
unbemerkten Fehlschläge, die im Kopf desselben Workflows als Gründungsbefund
stehen — und die Begründung dort zeigte in die falsche Richtung. Zu entscheiden
ist, was die neun Warnungen wert sind; sie einfach zu dulden wäre das
Weichspülen, das CLAUDE.md verbietet.

Die neun, mit erster Einschätzung (nicht entschieden):

| Regel | Zahl | Erste Einschätzung |
|---|---:|---|
| CSP: `script-src unsafe-inline` [10055] | 9 | **echt.** `next.config.ts` erlaubt `'unsafe-inline'` für Skripte. Behebbar nur mit Nonce/Hash — echte Arbeit, echter Nutzen. |
| Cross-Origin-Opener-Policy fehlt [90004] | 8 | **echt und billig.** Ein Kopf mehr in `next.config.ts`. |
| Absence of Anti-CSRF Tokens [10202] | 5 | zu prüfen: Die Anwendung hat eigenen Schutz (`src/lib/csrf.ts`, Origin/Sec-Fetch-Site). ZAP sieht ihn nicht. |
| User Controllable HTML Element Attribute [10031] | 13 | zu prüfen — betrifft `/suche` mit Parametern und die Startseite. |
| Content-Type Header Missing [10019] | 3 | betrifft nur 308-Weiterleitungen ohne Rumpf. |
| Non-Storable Content [10049] | 8 | Folge von `no-store` auf dynamischen Seiten — vermutlich beabsichtigt. |
| Big Redirect Detected [10044] | 1 | `/admin` 307. |
| Modern Web Application [10109] | 5 | rein informativ. |
| Authentication Request Identified [10111] | 1 | rein informativ. |

**D-2 — Die ZAP-Aktion kann ihr eigenes Artefakt nicht hochladen.** *Behoben
2026-08-22.*
`Create Artifact Container failed: The artifact name zap_scan is not valid` —
`zaproxy/action-baseline@v0.12.0` gegen die heutige Artefakt-Schnittstelle. Der
nachgelagerte eigene Upload (`zap-report`) gelingt, der Bericht ist also da;
die Fehlermeldung ist trotzdem eine weitere Spur, die in die Irre führt.

Die Wurzel ist nicht der Name — `zap_scan` ist zulässig. Die alte Aktion bringt
eine abgekündigte `upload-artifact`-Fassung mit, deren Dienst-Schnittstelle
abgeschaltet ist; die Meldung ist das Symptom davon. `v0.14.0` behebt genau das
(„stop using deprecated upload-artifact version"), `v0.15.0` ist der aktuelle
Stand und jetzt gepinnt. Die vier benutzten Eingaben (`target`,
`rules_file_name`, `fail_action`, `allow_issue_writing`) gibt es dort
unverändert — an der `action.yml` des Tags nachgesehen, nicht vermutet.

Der eigene Upload bleibt trotzdem stehen: Er liegt außerhalb der Aktion und
trägt `if: always()`, liefert den Bericht also auch dann, wenn die Aktion selbst
abbricht. Zwei Artefakte kosten nichts, ein fehlender Bericht kostet den Lauf.

**Was das NICHT heilt:** Der wöchentliche Lauf bleibt rot. Er ist fail-closed
und fällt über die neun WARN aus D-1 — D-2 war immer nur die irreführende
Meldung daneben.

**Nebenwirkung dieses Laufs:** Der Meldepfad hat wie vorgesehen einen Kommentar
an Issue #75 („Wiederkehrender Lauf fehlgeschlagen: DAST") geschrieben. Der
Kommentar stammt aus einem absichtlich angestoßenen Prüflauf, nicht aus einem
neuen Fehler.

## Was gemessen werden muss, bevor weitergebaut wird

Diese Fragen sind aus dem Repository **nicht** beantwortbar. Sie sind
Voraussetzung, nicht Fleißarbeit — jede blockiert mindestens einen Schritt oben.

| | Frage | blockiert |
|---|---|---|
| M1 | Wie erreicht der funktionierende Proxy-Host die Anwendung (welche Upstream-Adresse)? | A2 |
| M2 | Welche `client_max_body_size` und `proxy_read_timeout` gelten heute am Proxy? Bindet das Image `http.conf` und `server_proxy.conf` überhaupt ein? | A2, C2 |
| M3 | Setzt der Proxy `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Host` — und mit welcher Direktive? Wo stehen die 268 `set_real_ip_from`-Zeilen, in welchem Kontext, und wer schreibt sie? | C2 |
| M4 | Läuft der Proxy im Host-Netzwerk oder in einem Pod? In welchem podman-Speicher (rootless/rootful) liegt welches Image? | C2, E1, E4 |
| M5 | Welche Namen bedient dieser Proxy, welche Zertifikate gibt es, wann laufen sie ab, und über welchen ACME-Weg werden sie erneuert? Hängen alle hinter Cloudflare? | E1, A1 |
| M6 | Der **vollständige** Journal-Eintrag zum Absturz samt Stack, und die Neustart-Zeitstempel des Containers. | E2 |
| M7 | Wie verteilen sich die 41 ms Ursprungsmedian auf Datenbank, Render und Serialisierung? | D2 |
| M8 | Auf welche URL zeigt der GitHub-Webhook für das Auto-Deploy — auf die von Cloudflare bediente Domain oder auf die Ursprungsadresse? Zeigt er auf den Ursprung, stirbt das Auto-Deploy nach E1-2 **still**; das Symptom wäre „gemergte PRs erreichen die Produktion nicht mehr", und dafür gibt es keinen Alarm. Diese Sitzung hat kein `admin`-Recht auf dem Repository und kann die Hooks nicht auslesen — die Betreiberin muss in den Repository-Einstellungen nachsehen. | E1 |

Alle sieben sind **rein lesend**. Sie gehören in einen einzigen Erhebungslauf,
nicht in sieben Sitzungen — und ihr Ergebnis gehört **nicht** in dieses
öffentliche Repository, solange es Adressen enthält.
