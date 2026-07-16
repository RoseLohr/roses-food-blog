# audit/00 — System-Map & Freeze

**Erzeugt:** Phase 0 des Due-Diligence-Mandats (Track A/B, Katalog v1.0).
**Charakter:** rein lesend, keine Änderungen am Prüfgegenstand.

## Eingefrorener Prüfstand
- **Commit:** `ad3ff3179a2b4f374908c49cf34918d9ddcef2e7`
- **Branch:** `claude/roses-food-blog-vxs3vm`
- **Stand:** 2026-07-16

## Was dieses System ist (und was das Mandat voraussetzt)
Das Mandat ist für ein **vollautonom, ohne menschliches Code-Review, über eine
CI-Pipeline mit deterministischen Policy-Gates betriebenes** System geschrieben.
**Dieses System ist das nicht.** Es ist ein **von einer Person betriebener,
einzeln-administrierter Next.js-Food-Blog**, der **manuell per `./deploy.sh`**
auf einen Server (podman rootless) ausgerollt wird. Diese Diskrepanz ist selbst
der wichtigste Befund (siehe `A-01`, `A-39`, `B-01`, `B-35`): Die
„Verifikations-Maschine", die das Mandat prüfen will, **existiert hier nicht**.

## Technischer Stack
- **Framework:** Next.js 16.2.10 (App Router, `output: standalone`, Turbopack)
- **Sprache:** TypeScript (strict), React 19
- **Datenhaltung:** SQLite (`app.db`, WAL) über `better-sqlite3` + Drizzle ORM;
  FTS5-Virtualtabellen für Volltextsuche; Uploads im Dateisystem (`DATA_DIR`)
- **Auth:** ein Admin-Konto; Passwort-Hash über `hash-wasm` (WASM, CPU-portabel);
  Session-Cookie (`src/lib/auth-core.ts`)
- **Bildpipeline:** `sharp` bzw. libvips-CLI-Fallback (LOW_CPU)
- **Deployment:** `Containerfile` (Multi-Stage) + `compose.yml` (podman);
  Migrationen im Container-Entrypoint (`scripts/entry.sh` → `scripts/migrate.mjs`)

## Modelle & Provider
- **Ein KI-Feature:** Rezeptentwurf aus eingefügtem Rohtext.
- **Modell:** `claude-opus-4-8` — **gepinnt** (dated snapshot, **kein** „latest"-Alias). Gut (vgl. `B-13`).
- **Provider:** Anthropic Messages API (`@anthropic-ai/sdk`), structured output via Zod-Schema.
- **Kein Tool-Use:** Das Modell kann nichts schreiben, senden, ausgeben, löschen oder ausführen — es liefert nur JSON, das der Admin **vor** der Übernahme prüft. Damit sind die „lethal trifecta"-/Tool-Gateway-Prüfungen (C-06/C-08 usw.) weitgehend N/A.

## Egress-Pfade
- `api.anthropic.com` — nur wenn ein API-Key hinterlegt ist (Einstellungen oder `ANTHROPIC_API_KEY`).
- optionales GeoIP-Update-Skript.
- Sonst keine ausgehenden Ziele aus dem Anwendungscode (Karten-/Schema-Links sind reine `href`-Strings, keine Server-Requests).

## Identitäten
- Genau **eine** menschliche Identität (Admin). **Kein** Multi-Tenant-Modell, **keine** Agenten-Identitäten, **keine** Service-Accounts.
- Folge: die gesamte **Cross-Tenant-/Multi-Agent-Familie** des Katalogs (z. B. `C-01`) ist hier N/A oder trivial — es gibt keinen zweiten Mandanten, gegen den isoliert werden müsste.

## Das „Policy-Bundle", das Merges gated
- **Existiert nicht.** Es gibt keine CI, kein Gate, kein Bundle, keine getrennten Schreib-Credentials. Entwicklung → `git push` → manuelles `./deploy.sh`. Das ist für `A-01`/`B-01`/`B-35` maßgeblich.

## Audit-Oberfläche (Denominator)
Maschinenlesbar in `audit/00-audit-surface.json`. Kurzfassung:
309 versionierte Dateien · 62 Seiten-Routen · 12 API-Routen · 45 Lib-Module ·
3 Migrationen · 5 Skripte · 28 Test-Dateien · 19 Laufzeit-Abhängigkeiten.
