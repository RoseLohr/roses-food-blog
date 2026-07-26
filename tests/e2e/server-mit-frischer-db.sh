#!/usr/bin/env bash
# E2E-Server: die Datenbank wird IMMER VOR dem Serverstart provisioniert.
#
# Wurzel-Fix (CI-Befund 07/2026): Playwright startet den webServer VOR dem
# globalSetup und wartet auf /health. Der Health-Ping öffnete dabei eine
# leere, gerade erst angelegte app.db (der DB-Singleton legt die Datei bei
# Bedarf an); das danach laufende Setup löschte das Verzeichnis (rm) und
# seedete eine NEUE Datei — Server-Chunks, die ihre DB-Instanz früh
# initialisiert hatten (Health + API-Routen im selben Chunk), hielten
# dauerhaft die entkettete leere DB („no such table: ingredient", nur die
# Zutaten-Suggest-Route betroffen, seitenweise Chunks initialisierten später).
# Reihenfolge jetzt: frische DB → build → start; danach wird NICHTS mehr
# gelöscht, jede früh geöffnete Verbindung zeigt auf die fertige Datei.
set -euo pipefail
PORT="${1:?Port fehlt}"

rm -rf .pw-data
node scripts/migrate.mjs
npx tsx scripts/seed.ts
npx tsx scripts/e2e-admin.ts

npm run build
exec npx next start -p "$PORT"
