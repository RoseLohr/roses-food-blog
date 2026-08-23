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

# Fingerabdruck des UNBERÜHRTEN gemeinsamen Zustands (B8).
#
# Alle Specs teilen sich diese eine Datenbank. `cms-paket.spec.ts` änderte über
# den Admin den Einleitungstext der Reisen-Seite und räumte nicht auf — alles,
# was danach lief, sah den geänderten Stand. Die Referenzaufnahmen waren allein
# grün und im Verbund rot, und die Ursache war von der Wirkung durch mehrere
# Testdateien getrennt.
#
# Hier, unmittelbar nach dem Seeden, ist der Zustand nachweislich unberührt.
# `tests/e2e/zustand-ende.spec.ts` läuft als LETZTES und vergleicht.
node -e "
  const D = require('better-sqlite3');
  const db = new D('.pw-data/app.db', { readonly: true });
  const zeilen = db.prepare('SELECT key, value FROM setting ORDER BY key').all();
  db.close();
  require('fs').writeFileSync('.pw-data/zustand-saat.json', JSON.stringify(zeilen, null, 2));
  console.log('[e2e] Zustands-Fingerabdruck: ' + zeilen.length + ' Einstellungen');
"

npm run build
exec npx next start -p "$PORT"
