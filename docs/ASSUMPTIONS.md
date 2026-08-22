# ASSUMPTIONS — dokumentierte Annahmen

Die Annahmen A1–A11 stammen aus dem Projektauftrag und sind im Repository
nirgends niedergeschrieben (`governance/mandate.md` kennt sie nicht); sie gelten. Zusätzliche
Annahmen, die während der Umsetzung getroffen wurden:

- **B1 — Next.js 16:** „Aktuelle stabile Version" ist Next.js 16 (App Router).
- **B2 — Geo-Datenbank:** Verwendet wird die frei nutzbare **DB-IP IP-to-Country
  Lite** (CC BY 4.0) im MMDB-Format. Sie wird NICHT ins Repo eingecheckt, sondern
  per `scripts/update-geoip.sh` auf den Server nach `/srv/roses-blog/data/geoip/`
  geladen (Cron-Beispiel im README). Fehlt die Datei, wird das Land als
  „unbekannt" erfasst — die Anwendung funktioniert ohne Einschränkung.
- **B3 — Portionsrechner clientseitig:** Die Umrechnung läuft als kleines
  Vanilla-JS auf Basis von `data-`Attributen (Menge/Einheit serverseitig
  gerendert) — kein Framework-JS nötig, SSR-Inhalt bleibt vollständig.
- **B4 — Rundungsregeln Portionsrechner:** Mengen werden „küchentauglich"
  gerundet: glatte Brüche (¼, ⅓, ½, ⅔, ¾) für Stück-/Löffel-Einheiten,
  sinnvolle Dezimalrundung für Gramm/Milliliter (< 10 → 1 Nachkommastelle,
  10–100 → ganze Zahl, > 100 → auf 5 gerundet). Dokumentiert in
  `src/lib/servings.ts`, per Unit-Tests abgesichert.
- **B5 — Rate-Limiting in-memory:** Bei einem einzelnen Container genügt ein
  In-Memory-Sliding-Window-Limiter (Login, Newsletter-Formular, Like-API).
  Nach einem Neustart beginnen die Zähler bei 0 — akzeptabel.
- **B6 — Versand-Queue:** E-Mails (Kampagnen, Sequenzen) werden in die Tabelle
  `email_queue` geschrieben; ein Cron-Job im App-Prozess versendet mit
  konfigurierbarer Rate (`EMAIL_RATE_PER_MINUTE`, Default 30/min).
- **B7 — Sessions in der DB:** Admin-Sessions liegen in der Tabelle `session`
  (Token-Hash), Lebensdauer 14 Tage, Sliding Expiration.
- **B8 — CSRF-Schutz:** Server Actions prüfen Origin (Next-eingebaut); eigene
  POST-Route-Handler (Likes, Tracking-Beacon, Newsletter) prüfen zusätzlich den
  `Origin`/`Sec-Fetch-Site`-Header. Session-Cookie ist `SameSite=Lax`.
- **B9 — Likes-Dedup:** Anonyme Client-ID (UUID in `localStorage`) + serverseitig
  gespeicherter Hash (Client-ID + Rezept). Best effort, wie im Auftrag erlaubt.
- **B10 — Bildformate:** Uploads (JPEG/PNG/WebP, max. 15 MB) werden mit
  sharp neu verarbeitet (EXIF entfernt) zu WebP; Breiten-Leiter
  und Encoder-Einstellungen (Qualität/effort/smart-subsample) kommen zentral
  aus `config/bild-encoder.json` (Stand rev 3: 160–1920 px in neun Stufen,
  Q68/effort 6). Die Stufe 1152 kam mit rev 3 dazu — belegt durch das
  Auslieferungs-Budget in `tests/e2e/bild-auslieferung.spec.ts`, das die
  über den Bedarf hinaus gelieferte Pixelfläche misst (41,2 % → 28,8 %).
  Ändert sich dort etwas, MUSS `rev` steigen: der Container-Start zieht dann
  alle Bestands-Uploads nach (`scripts/regenerate-variants.mjs`, idempotent,
  Quelle = größte Variante, die selbst nie re-kodiert wird — das Original
  wird aus Datenschutzgründen nicht aufbewahrt, der einmalige
  Generationsverlust beim Nachziehen kleinerer Breiten ist abgewogen) und
  die Bild-URLs busten den immutable-Jahrescache über `?v=rev`. Da der
  Nachzug im Hintergrund läuft, gibt die Auslieferungs-Route `immutable`
  nur marker-bestätigt aus (`.encoder-rev` je Bild == aktuelle rev, sonst
  `max-age=300`) — sonst würden alte Bytes unter der neuen ?v-URL für ein
  Jahr festgenagelt (Panel-Befund gpt-5.6-sol). AVIF ist
  bewusst deaktiviert (Encode-Zeit auf kleinem Server); WebP + `srcset`
  erfüllt das Performance-Ziel.
- **B11 — Tracking-Rohdaten:** TrackingEvents werden 90 Tage vorgehalten und
  nachts zu Tagesaggregaten verdichtet; ältere Events löscht der Cron. Es wird
  zu keinem Zeitpunkt eine IP gespeichert (Country-Lookup im Request-Speicher).
- **B12 — Browserfamilie:** Grobe UA-Klassifikation (Chrome, Firefox, Safari,
  Edge, Sonstige) ohne Fingerprinting, eigene kleine Funktion statt Fremdpaket.
- **B13 — „Letzter Kontakt":** wird aus `contact_activity` abgeleitet
  (Anmeldung, Bestätigung, Kampagnen-/Sequenzmail, Abmeldung, Notiz).
- **B14 — Willkommenssequenz:** Eine Standard-Sequenz wird per Seed angelegt
  (pausiert, 2 Beispielschritte); Schritte/Inhalte sind im Admin editierbar.
  Trigger: Statuswechsel auf „aktiv" (Double-Opt-in bestätigt).
- **B15 — Admin-UI-Sprache:** Auch der Admin-Bereich ist Deutsch; alle Texte
  liegen in `src/i18n/de.ts` (i18n-vorbereitet, A3).
- **B16 — Kalorien:** `kcal` gilt pro Portion (Anzeige kennzeichnet das).
- **B17 — Container-Basisimage:** `node:22-bookworm-slim` (glibc) statt Alpine,
  damit better-sqlite3/sharp/argon2 als Prebuilds funktionieren — kein
  Compiler-Toolchain im Image nötig.
  *Ergänzt am 2026-08-16 (Fehlschlag Commit 298e6b6):* Die Annahme trug nicht von
  selbst. better-sqlite3 13 bringt eine `binding.gyp` ohne eigenes
  `install`-Skript mit; npm ergänzt dann `node-gyp rebuild`, und dessen
  configure-Schritt braucht Python — obwohl die mitgelieferte Binärdatei jede
  Übersetzung überflüssig macht. Getragen wird B17 seither von
  `npm ci --ignore-scripts` im Containerfile, ratifiziert in
  `tests/build-abhaengigkeiten.test.ts` und ausgeführt vom CI-Job `image`.
- **B19 — Schriften:** Ursprünglich System-Schrift-Stacks (0 KB Payload).
  Diese Annahme gilt seit der Marken-Umsetzung NICHT mehr: Unter `public/fonts`
  liegen drei selbst gehostete Variable-woff2 — Raleway (`--font-display`,
  Überschriften), Nunito Sans (`--font-sans`, Fließtext) und Jost
  (`--font-brand`, ausschließlich das Marken-Lockup). Kein externes CDN, kein
  Laufzeit-Download; A7 bleibt damit erfüllt, nur eben mit eigenen Dateien.
  *Stand 2026-08-16:* zusammen 92.916 B. Die Dateien sind latin-subgesetzt
  (221–231 Zeichen); der verbliebene Ballast steckt in der `gvar`-Tabelle, also
  in der Breite der Gewichtsachse. Die Achsen sind deshalb auf die im Browser
  GEMESSEN benutzten Schnitte beschnitten (Jost 400–500, Nunito Sans 400–800,
  Raleway 100–800) — das nimmt 13.000 B heraus, davon allein 9.400 B bei Jost.
  `tests/schrift-achsen.test.ts` hält Achse, `@font-face`-Spanne und die im
  Quelltext angeforderten Gewichte gegeneinander fest und deckelt die Summe.
- **B20 — CSP und Inline-Skripte:** Die CSP erlaubt `'unsafe-inline'` für
  script-src, weil Next.js Bootstrap-Inline-Skripte nutzt; sämtliche externen
  Quellen bleiben blockiert (default-src 'self'). Nonce-basierte CSP wäre mit
  Middleware nachrüstbar, wurde aber als Over-Engineering für dieses
  Bedrohungsmodell eingestuft.
- **B21 — Container läuft als root unter rootless Podman:** Der Container
  wird als root gestartet, aber ausschließlich **rootless** betrieben. Dann
  ist Container-„root" via User-Namespace der unprivilegierte Host-Benutzer —
  kein echter Root auf dem Host. Das ist die zuverlässigste Lösung für die
  Bind-Mount-Rechte (das dem Host-User gehörende `DATA_DIR` ist beschreibbar,
  erzeugte Dateien gehören dem Host-User, sodass host-seitige Backup-Tools
  gzip/tar/rm funktionieren) und ist provider-unabhängig (kein `userns_mode`
  nötig, das der externe docker-compose-Provider evtl. nicht durchreicht).
  Ein fest verdrahtetes `USER node` (uid 1000) würde unter rootless auf eine
  Subuid gemappt und könnte das Host-Verzeichnis nicht beschreiben
  (SQLITE_CANTOPEN). Der ursprüngliche „non-root"-Wunsch zielt auf „kein
  echter Host-Root" — das ist unter rootless erfüllt.
- **B23 — Passworthashing via hash-wasm (WASM-argon2id):** Statt der nativen
  `@node-rs/argon2`-Bibliothek wird `hash-wasm` verwendet. Grund: die native
  argon2-Binärdatei nutzt bei der Berechnung CPU-SIMD-Befehle, die auf alten
  CPUs ohne SSE4.2 (Intel Atom/Bonnell) einen unabfangbaren SIGILL auslösen —
  die App/Migration stürzte dort beim Anlegen bzw. Prüfen von Passwörtern ab.
  hash-wasm (WebAssembly) läuft prozessorunabhängig und identisch auf jeder
  CPU; das Ausgabeformat ist Standard-PHC (`$argon2id$…`), also kompatibel zu
  bestehenden argon2-Hashes. Der Auftrag verlangt argon2id — das bleibt
  erfüllt (gleicher Algorithmus, nur WASM statt nativ). Parameter unverändert
  (m=19456 KiB, t=2, p=1, 32-Byte-Hash). *Anmerkung 2026-08-16:* Der
  SIGILL-Anlass ist mit dem Serverwechsel (AMD EPYC 7352) entfallen; die
  Entscheidung bleibt trotzdem, weil hash-wasm formatkompatibel ist und ein
  Rückbau auf eine native Bibliothek nichts gewönne außer Angriffsfläche.
- **B22 — Next-Bild-Optimizer deaktiviert:** `images.unoptimized = true`. Die
  App erzeugt eigene WebP-Varianten und liefert sie über `<img srcSet>` aus;
  der eingebaute `/_next/image`-Optimizer wird nicht gebraucht. Deaktiviert
  liefert die Route sofort 404, ohne sharp zu laden — das spart nicht nur
  Arbeit, es hält auch die native Bibliothek aus dem Anfragepfad heraus.
- **B18 — Healthcheck:** `/health` prüft auch die DB-Verbindung (einfaches
  `SELECT 1`) und liefert Commit/Version aus dem Build.
- **B24 — Auslieferungskette (nachgetragen 2026-08-22):** Die Kette ist
  Cloudflare am Rand → Nginx Proxy Manager (OpenResty) in einem **Container** →
  Next.js standalone auf `127.0.0.1:<PORT aus der .env>`. Ein nginx ist auf dem
  Host installiert, sein Dienst ist aber `enabled` UND `failed` und gehört
  nicht zur Kette.
  Daraus folgt, was an mehreren Stellen im Code vorausgesetzt wird:
  **brotli kommt ausschließlich vom Rand** (OpenResty hat kein brotli-Modul und
  bekommt keins), **am Ursprung komprimiert gzip** aus `deploy/npm/http_top.conf`,
  eingespielt von `deploy.sh` Abschnitt 9c, und **der Ursprungsport steht in
  `PORT`** — auf `*:3000` lauscht auf diesem Server ein fremder Dienst.
  Das ist eine **Lücke**, die hier geschlossen wird, keine Korrektur: Keine der
  Annahmen B1–B23 hat etwas Unwahres über die Kette behauptet, sie kam nur
  überhaupt nicht vor.
  Vier Punkte sind dabei ausdrücklich **nicht** erhoben und dürfen nirgends
  behauptet werden (`audit/12-infrastruktur-fahrplan.md`):
  **M1** die Upstream-Adresse des Proxy-Hosts — im Container ist `127.0.0.1`
  die eigene Loopback-Adresse; **M2** welche `client_max_body_size` und
  `proxy_read_timeout` am Proxy gelten; **M3** welche Weiterleitungs-Köpfe er
  setzt; **M5** welchen ACME-Weg er für die Zertifikate benutzt. Auch **wo HSTS
  gesetzt wird**, ist offen und von keiner dieser Messfragen abgedeckt.
