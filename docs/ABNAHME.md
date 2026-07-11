# Abnahme — Akzeptanzkriterien und Prüfschritte

Stand: Abschluss E12. Alle automatisierten Tests: `npm test` (51+ Tests).

| # | Kriterium | Umsetzung | Prüfung |
|---|-----------|-----------|---------|
| 1 | Rezept anlegen → Entwurf → Vorschau → veröffentlichen → erscheint in Übersicht, Suche, Sitemap | Rezept-Editor (`/admin/rezepte`), Statusfeld, Vorschau-Seite; Übersicht/Suche/Sitemap filtern auf `veroeffentlicht` | Integrationstest `recipe-crud` + manuell: Rezept anlegen, `/rezepte`, `/suche?q=…`, `/sitemap.xml` prüfen |
| 2 | Portionsrechner rechnet korrekt um (sinnvolle Rundung) | `src/lib/servings.ts` (Brüche ¼–¾, 5er-Rundung >100 g, Dezimalregeln) | Unit-Tests `servings.test.ts` + manuell: +/− auf Rezeptseite |
| 3 | Zutatensuche liefert Rezepte UND Restaurant-Gerichte, zeigt Zutatenbild | `searchIngredients()` in `src/lib/search.ts`, Suchseite zeigt Bild der Zutat | Integrationstest `search` + manuell: `/suche?q=tomate` |
| 4 | Likes ohne Anmeldung, Dedup best effort, „Beliebteste“ nach Likes | `/api/likes` (SHA-256 aus Client-UUID+Rezept, Unique-Index), Startseiten-Sektion sortiert nach `like_count` | Smoke-Test (Dedup verifiziert: zweiter Like zählt nicht) + manuell |
| 5 | Slider (Bilder, Rezept-Links, Intervall in Sekunden) im Admin konfigurierbar, wirkt sofort | `/admin/startseite`, Startseite ist `force-dynamic` (kein Cache) | Manuell: Intervall ändern → neu laden |
| 6 | Double-Opt-in komplett; Abmeldelink in jeder Mail; CSV-Export; Löschung/Anonymisierung | `src/lib/newsletter.ts`, Mail-Footer in `mailer.ts` (immer Abmeldelink), Export-Route, `anonymizeContact()` | Integrationstests `newsletter` + `crm` |
| 7 | Kampagne an Segment; Testversand; Protokoll; „letzter Kontakt“; Willkommenssequenz zeitversetzt | `src/lib/campaigns.ts`, `campaign_log`, `recordContactActivity`, `src/lib/sequences.ts` | Integrationstests `crm` + `newsletter` |
| 8 | Tracking-Dashboard: Aufrufe, Häufigkeit, Ø-Dauer, Land, Browser, Aufrufart; keine IP/PII | `/admin/statistik`; Test verifiziert, dass die IP nirgends gespeichert wird | Integrationstest `tracking` + manuell |
| 9 | Druckansicht sauber, ohne Navigation/Sidebar | `/drucken/rezepte/[slug]` (eigenes Layout, Auto-Druckdialog) | Manuell: „Drucken“-Button |
| 10 | `./deploy.sh` genügt für jedes Update; Autostart nach Reboot | `deploy.sh` (pull→build→DB-Backup→Migration im Entrypoint→Neustart→Healthcheck→Status), `podman-restart.service` + Linger | Auf dem Server: `./deploy.sh`, danach `sudo reboot` und `curl 127.0.0.1:3000/health` |
| 11 | Backup wiederherstellbar, Restore dokumentiert und getestet | `deploy/backup.sh` (Online-Backup-API + tar, 14-Tage-Rotation), README „Backup & Restore“ | **Restore-Test durchgeführt** (E12): Backup→gunzip→tar→Server startet auf wiederhergestellten Daten, Health ok, Rezeptseite 200 |
| 12 | Lighthouse mobil ≥ 90 auf Startseite und Rezeptseite | SSR, WebP+srcset+lazy, minimales JS, Caching-Header, A11y-Grundlagen | **Gemessen (E12, mobil, Production-Build):** Startseite 97/96/96/100, Rezeptseite 100/100/96/100 (Perf/A11y/BP/SEO) — auf dem Produktivserver wiederholen |
| 13 | Alle Newsletter-Mails enthalten Abmeldelink + Absenderangaben | Fester Footer in `renderEmail()` (Absender, URL, Abmeldelink), zusätzlich `List-Unsubscribe(-Post)`-Header | Integrationstest prüft Abmeldelink in HTML und Text |
| 14 | Notizen je Notiz öffentlich/intern schaltbar; Autor nie öffentlich sichtbar | `recipe_note.is_public`; öffentliche Ansicht rendert nur `publicNotes`; Autor wird in keiner öffentlichen Komponente ausgegeben | Integrationstest `recipe-crud` (public/admin Notes) + Code-Review |

## Manuelle Restprüfungen auf dem Produktivserver

1. Ersteinrichtung nach README (Klonen, `.env`, `./deploy.sh`, nginx+certbot).
2. Reboot-Test: `sudo reboot`, danach ist die Website ohne manuelles Zutun erreichbar.
3. SMTP-Echtversand: Newsletter-Anmeldung mit echter Adresse, Bestätigungslink,
   Willkommensserie (Sequenz aktivieren!), Kampagnen-Testversand.
4. Backup-Cron eintragen (README Abschnitt 6) und nach 24 h prüfen:
   `ls /srv/roses-blog/data/backups/`.
5. GeoIP-Datenbank laden (`scripts/update-geoip.sh`), danach erscheinen Länder
   in der Statistik.
6. Lighthouse (mobil) gegen die echte Domain laufen lassen — TLS/HTTP2 via
   nginx verbessern die Werte gegenüber dem lokalen Lauf.

## Bekannte bewusste Vereinfachungen

Siehe `docs/ASSUMPTIONS.md` (B1–B20), insbesondere: In-Memory-Rate-Limits (B5),
WebP statt AVIF (B10), System-Schrift-Stacks (B19), CSP mit `unsafe-inline`
für Next-Bootstrap (B20).
