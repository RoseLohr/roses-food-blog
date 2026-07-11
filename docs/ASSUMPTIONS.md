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
- **B18 — Healthcheck:** `/health` prüft auch die DB-Verbindung (einfaches
  `SELECT 1`) und liefert Commit/Version aus dem Build.
