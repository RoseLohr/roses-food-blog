# PLAN — Roses Food Blog

Deutschsprachiger Food- & Reiseblog mit CMS, CRM, Newsletter (Double-Opt-in) und
automatisiertem Podman-Deployment auf einem eigenen Ubuntu-Server.

## Stack-Entscheidung

Es gilt die Empfehlung aus dem Auftrag (Annahme A1), ohne Abweichung:

| Baustein        | Wahl                                             | Begründung |
|-----------------|--------------------------------------------------|------------|
| Framework       | **Next.js 16** (App Router, TypeScript, SSR)     | SSR für alle öffentlichen Seiten (SEO/GEO), Server Actions machen die Admin-CRUD-Formulare ohne separate API-Schicht produktiv, eine Codebasis für Public + Admin, gut wartbar durch eine Person. |
| Datenbank       | **SQLite** (better-sqlite3) + **Drizzle ORM**    | Ein Server, ein Admin, 100–200 Rezepte — SQLite ist ideal. Drizzle liefert typsichere Queries und SQL-Migrationen im Repo. Volltextsuche über **FTS5**. |
| Styling         | **Tailwind CSS 4**                               | Schnelle, konsistente UI-Entwicklung, kein Runtime-CSS. |
| Bilder          | **sharp**-Pipeline (WebP, responsive Größen; AVIF bewusst deaktiviert, B10)| Eigene Medienbibliothek, keine externen Dienste. |
| Auth            | Sessions (HttpOnly-Cookie) + **argon2id** (über `hash-wasm`, siehe `docs/ASSUMPTIONS.md` B23) | Wie gefordert; Rate-Limiting in-memory, CSRF via Origin-Prüfung + SameSite. |
| E-Mail          | **Nodemailer** (SMTP aus `.env`)                 | Standard, providerneutral. |
| Scheduler/Queue | **node-cron** im selben Prozess (Start via `instrumentation.ts`), Versand-Queue als DB-Tabelle | Kein zweiter Container/Worker nötig — bewusst kein Over-Engineering. |
| Geo             | Lokale IP-Country-DB (DB-IP Lite, mmdb), IP wird nie gespeichert | DSGVO-konform, first-party. Fallback „unbekannt“, wenn DB fehlt. |
| Deployment      | Ein Container-Image (Multi-Stage), Podman **rootless** + compose, `deploy.sh`, Daten in Bind-Mounts | Harte Anforderung aus Abschnitt 9. Der Prozess im Container läuft als root; abgesichert wird das durch rootless-Betrieb, nicht durch einen `USER`-Eintrag — siehe `docs/ASSUMPTIONS.md` B21. |

## Architekturüberblick

- **Ein Container**: Next.js-Server (standalone build) inkl. Scheduler.
  Entrypoint führt beim Start Migrationen aus und legt ggf. das Admin-Konto an.
- **Persistenz** unter `/data` im Container (Bind-Mount, z. B. `/srv/roses-blog/data`):
  `app.db` (SQLite), `uploads/` (Originale + Derivate), optional `geoip/country.mmdb`.
- **Auslieferungskette** (Stand 08/2026, korrigiert): Cloudflare am Rand →
  Nginx Proxy Manager (OpenResty) in einem **Container** → App auf
  `127.0.0.1:<PORT aus der .env>`. TLS terminiert Cloudflare am Rand und der
  Proxy am Ursprung. Hier stand früher „nginx auf dem Host terminiert TLS und
  proxied auf 127.0.0.1:3000" — der Host-nginx ist zwar installiert, sein
  Dienst ist aber `enabled` UND `failed` und nicht Teil der Kette. Über welche
  Upstream-Adresse der Proxy die App erreicht, ist offen (M1,
  `audit/12-infrastruktur-fahrplan.md`).
- **Migrationen**: drizzle-kit generiert SQL-Dateien ins Repo; ein Migrator-Skript
  wendet sie beim Containerstart an. `deploy.sh` sichert die DB **vor** dem Neustart.
- **i18n-Vorbereitung**: alle UI-Texte in `src/i18n/de.ts` (ein Wörterbuch-Modul),
  keine hartkodierten Strings in Komponenten.

## Etappenplan (jede Etappe lauffähig, Tests grün, deploybar)

- **E0 Fundament** — Repo, Next-Skeleton mit `/health`, Containerfile, compose.yml,
  `deploy.sh`, `deploy/` (nginx-Vorlage, systemd/Quadlet, backup.sh), `.env.example`, README.
  Die nginx-Vorlage `deploy/nginx.conf.example` beschreibt einen Host-Betrieb, den
  es hier nicht gibt — sie bleibt trotzdem erhalten, weil sie als einzige Stelle
  `client_max_body_size` und `proxy_read_timeout` niederschreibt (siehe ihren Kopf).
- **E1 Datenmodell** — Drizzle-Schema (alle Entitäten aus Abschnitt 6), Migrationen,
  FTS5-Indizes, Seed-Skript (Beispielrezepte, eine Reise, Zutaten).
- **E2 Admin-Grundlage** — Login (argon2id, Sessions, Rate-Limit), Admin-Layout,
  Admin-Benutzerverwaltung, Medienbibliothek mit sharp-Pipeline.
- **E3 Rezept-CRUD** — Editor mit Abschnitten/Schritten/Zutaten+Mengen, Notizen mit
  Sichtbarkeitsschaltung, SEO-Felder, Taxonomien-Verwaltung, Status + Vorschau.
- **E4 Öffentliche Rezepte** — Übersicht, Rezeptseite (JSON-LD Recipe),
  Portionsrechner, Druckansicht, Teilen (Web Share/Copy/mailto).
- **E5 Reisen** — CRUD Reisebeiträge mit Restaurants/Gerichten (inkl. Zutaten),
  öffentliche Seiten (JSON-LD Article).
- **E6 Suche & Filter** — FTS5-Suche, alle Facetten, Zutatensuche über Rezepte
  UND Restaurant-Gerichte mit Zutatenbild.
- **E7 Startseite & Likes** — konfigurierbarer Slider, Sektionen, Sidebar,
  Like-API mit anonymem Dedup-Schlüssel.
- **E8 Tracking** — serverseitige Erfassung + sendBeacon-Dauer, Bot/LLM-Klassifikation,
  Tagesaggregation (Cron), Admin-Dashboard.
- **E9 Newsletter-Kern** — Formulare, Double-Opt-in, Bestätigungs-/Abmelde-Mails,
  Kontaktverwaltung.
- **E10 CRM & Versand** — Segmente (manuell + regelbasiert), Tags, Notizen, CSV-Export,
  Löschung/Anonymisierung, Kampagnen mit Testversand + Versandlog, Willkommenssequenz.
- **E11 Qualitäts-Feinschliff** — SEO/GEO (Sitemap, robots, OG, llms.txt),
  Barrierefreiheit, Performance, Security-Header, statische Seiten.
- **E12 Betrieb & Abnahme** — Backup/Restore-Test, Autostart, Doku,
  Abgleich mit allen Akzeptanzkriterien.

## Tests

- **Unit** (Vitest): Portionsumrechnung/Rundung, Slugs, Segmentregeln,
  Bot-/LLM-Klassifikation, Mengenformatierung.
- **Integration** (Vitest gegen echte SQLite in tmp): Auth, CRUD-Kern,
  kompletter Double-Opt-in-Flow, Kampagnenversand (SMTP gemockt).
