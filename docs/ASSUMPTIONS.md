# ASSUMPTIONS — dokumentierte Annahmen

Die Annahmen A1–A11 aus dem Projektauftrag gelten unverändert. Zusätzliche
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
- **B10 — Bildformate:** Uploads (JPEG/PNG/WebP, max. 15 MB) werden mit sharp
  neu verarbeitet (EXIF entfernt) zu WebP in den Breiten 320/640/960/1280/1920 px
  plus Original-Reencode. AVIF ist bewusst deaktiviert (Encode-Zeit auf kleinem
  Server); WebP + `srcset` erfüllt das Performance-Ziel. Erweiterbar per Option.
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
- **B19 — Schriften:** Statt heruntergeladener Webfonts werden hochwertige
  System-Schrift-Stacks verwendet (Serif für Überschriften, Sans für Text).
  Das erfüllt „selbst gehostet/keine externen CDNs" (A7) mit 0 KB Font-Payload
  und bestmöglicher Ladezeit. Eigene Font-Dateien können später einfach unter
  `public/fonts` + `@font-face` ergänzt werden.
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
  (m=19456 KiB, t=2, p=1, 32-Byte-Hash).
- **B22 — Next-Bild-Optimizer deaktiviert:** `images.unoptimized = true`. Die
  App erzeugt eigene WebP-Varianten und liefert sie über `<img srcSet>` aus;
  der eingebaute `/_next/image`-Optimizer wird nicht gebraucht und würde auf
  CPUs ohne SSE4.2 (LOW_CPU) beim Laden von sharp einen unabfangbaren SIGILL
  auslösen. Deaktiviert liefert die Route sofort 404, ohne sharp zu laden.
- **B18 — Healthcheck:** `/health` prüft auch die DB-Verbindung (einfaches
  `SELECT 1`) und liefert Commit/Version aus dem Build.
