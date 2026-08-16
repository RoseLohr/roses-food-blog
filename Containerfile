# ---------------------------------------------------------------------------
# Multi-Stage-Build: deps -> build -> runtime (standalone)
# Basisimage bookworm-slim (glibc), damit better-sqlite3/sharp/argon2
# als Prebuilds laufen (siehe docs/ASSUMPTIONS.md B17).
#
# Der Container läuft als root, wird aber ausschließlich rootless betrieben
# (podman rootless). Dann ist Container-"root" der unprivilegierte Host-
# Benutzer (User-Namespace-Mapping) — kein echter Root auf dem Host. Das
# löst zugleich die Bind-Mount-Rechte: der Prozess kann das dem Host-User
# gehörende DATA_DIR beschreiben, und erzeugte Dateien gehören dem Host-User,
# sodass host-seitige Backup-Tools (gzip/tar/rm) funktionieren. Siehe README.
# ---------------------------------------------------------------------------
FROM docker.io/library/node:22-bookworm-slim AS deps
WORKDIR /app
# LOW_CPU=1: für CPUs ohne SSE4.2/x86-64-v2 (z. B. Intel Atom/Bonnell oder
# VMs mit qemu64/kvm64-CPU-Typ). sharps native Bibliothek würde dort mit
# SIGILL abstürzen; stattdessen nutzt die Bildpipeline die Debian-libvips-CLI
# (IMAGE_BACKEND=vips, gesetzt vom Entrypoint). deploy.sh erkennt das selbst.
ARG LOW_CPU=0
# @playwright/test ist eine reine Test-Abhängigkeit (E2E-Frontend-Tests). Seine
# postinstall würde sonst ~150 MB Browser herunterladen — im Produktions-Build
# unnötig und auf schwacher Hardware/eingeschränktem Netz fehleranfällig. Die
# Browser werden nur lokal/CI zum Testen gebraucht, nie zur Laufzeit.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
# --ignore-scripts: KEIN Fremdcode beim Installieren — und genau deshalb baut
# hier auch nichts mehr aus Quelltext.
#
# WARUM (Deploy-Fehlschlag 2026-08-16, Commit 298e6b6): better-sqlite3 13
# liefert im veröffentlichten Paket fertige Binärdateien mit
# (`prebuilds/linux-x64.node`) — aber eben AUCH eine `binding.gyp`, und es
# definiert kein eigenes `install`-Skript. In dieser Konstellation ergänzt npm
# von sich aus den Standardbefehl `node-gyp rebuild`:
#
#   npm error path /app/node_modules/better-sqlite3
#   npm error command sh -c node-gyp rebuild
#   npm error gyp ERR! find Python … Could not find any Python installation
#
# GESCHEITERT IST NICHT DAS ÜBERSETZEN, SONDERN DAS VORBEREITEN DES ÜBERSETZENS.
# Die binding.gyp des Pakets ist nämlich extra so gebaut, dass sie bei
# vorhandener Binärdatei NICHTS tut: Beide Targets stehen unter
# `['force_build==1 or prebuild_exists==0', …, { 'type': 'none' }]`, und
# `prebuild_exists` ermittelt `node lib/binding.js` aus dem Vorhandensein von
# `prebuilds/<plattform>-<arch>.node`. node-gyp kommt dort aber nie an: Schon
# der configure-Schritt braucht Python, und den gibt es im Basisimage
# (bookworm-SLIM) nicht. Übersetzt worden wäre also ohnehin nichts — es
# scheiterte an der Vorbereitung eines Leerlaufs.
#
# Bis Version 12 stand dort `prebuild-install || node-gyp rebuild`, das lud die
# Binärdatei und übersetzte nur im Notfall. Der Wechsel auf 13.0.1 (PR #46)
# entfernte dieses Skript — seither greift der npm-Standard. 13.0.2 und 13.0.3
# sind unverändert, ein Versionssprung behebt es also nicht.
#
# NICHT der Weg: Python und einen Compiler ins Build-Image legen. Sie würden
# einen Schritt ermöglichen, der nachweislich nichts erzeugt — Bauzeit und
# Angriffsfläche für einen Leerlauf. Ohne Install-Skripte wird die
# mitgelieferte Binärdatei benutzt, so wie vom Paket vorgesehen.
#
# Pakete mit Lifecycle-Skripten im Baum sind better-sqlite3, esbuild (dessen
# postinstall nur die Plattform-Binärdatei prüft; die API arbeitet auch ohne)
# und fsevents (nur macOS, im Linux-Image gar nicht installiert). Alle drei sind
# nachgemessen und in tests/build-abhaengigkeiten.test.ts ratifiziert. Kommt ein
# VIERTES hinzu, schlägt diese Kontrolle an — dann ist zu entscheiden, nicht zu
# hoffen.
RUN npm ci --no-audit --no-fund --ignore-scripts
# Schnelltest der nativen Module — schlägt hier gezielt fehl (mit Modulname
# im Log), statt später anonym im Next-Build. Passworthashing läuft über
# hash-wasm (WASM, CPU-portabel) — kein nativer Test nötig. sharp wird auf
# LOW_CPU nie geladen und daher dort auch nicht getestet.
#
# better-sqlite3 wird BENUTZT, nicht nur geladen: Seit die Binärdatei aus dem
# Paket kommt statt aus einem Build, ist „require() wirft nicht" zu wenig — die
# Abfrage unten beweist, dass die native Bindung wirklich arbeitet.
RUN node -e "const D=require('better-sqlite3');const db=new D(':memory:');db.exec('create table t(a)');db.prepare('insert into t values (?)').run(42);if(db.prepare('select a from t').get().a!==42)throw new Error('better-sqlite3 liefert falsche Daten');" \
 && echo "OK better-sqlite3" \
 && node -e "require('hash-wasm')" && echo "OK hash-wasm" \
 && if [ "$LOW_CPU" != "1" ]; then node -e "require('sharp')" && echo "OK sharp"; \
    else echo "LOW_CPU=1 — sharp übersprungen (Bildpipeline nutzt libvips-CLI)"; fi

FROM docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Auf normalen CPUs die nativen sharp-Laufzeitpakete in den Standalone-Output
# spiegeln. Auf LOW_CPU wird sharp NICHT gebraucht (Bildpipeline nutzt vips)
# — dort NICHT kopieren, damit keine SSE4.2-Binärdatei ins Image gelangt.
ARG LOW_CPU=0
RUN if [ "$LOW_CPU" != "1" ]; then \
      mkdir -p .next/standalone/node_modules/@img \
      && cp -r node_modules/@img/. .next/standalone/node_modules/@img/ 2>/dev/null || true; \
    fi

FROM docker.io/library/node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# LOW_CPU=1: Debians libvips-CLI als Bild-Backend (Baseline-x86-64, läuft
# auf jeder CPU). Der Entrypoint setzt dann IMAGE_BACKEND=vips.
ARG LOW_CPU=0
RUN if [ "$LOW_CPU" = "1" ]; then \
      apt-get update -qq \
      && apt-get install -y --no-install-recommends libvips-tools \
      && rm -rf /var/lib/apt/lists/*; \
    fi

ARG APP_COMMIT=unbekannt
ENV APP_COMMIT=$APP_COMMIT

# Standalone-Server + statische Assets + Migrations- und Startskripte
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/scripts/regenerate-variants.mjs ./scripts/regenerate-variants.mjs
COPY --from=build /app/config ./config
COPY --from=build /app/scripts/entry.sh ./scripts/entry.sh
# Healthcheck als Datei (compose.yml ruft /app/scripts/healthcheck.mjs auf) —
# Inline-JavaScript scheiterte an der /bin/sh-Auswertung von podman.
COPY --from=build /app/scripts/healthcheck.mjs ./scripts/healthcheck.mjs
RUN chmod +x ./scripts/entry.sh && mkdir -p /data
# LOW_CPU-Fail-Safe: natives sharp aus dem Image entfernen. So kann selbst ein
# versehentlicher sharp-Ladepfad nur noch einen abfangbaren MODULE_NOT_FOUND
# statt eines prozesstötenden SIGILL auslösen (Bildpipeline nutzt hier vips).
RUN if [ "$LOW_CPU" = "1" ]; then \
      rm -rf node_modules/sharp node_modules/@img; \
    fi

# Bewusst KEIN "USER node": rootless betrieben ist Container-root der
# unprivilegierte Host-User (siehe Kopf). Das macht das Host-Bind-Mount
# beschreibbar und hält erzeugte Dateien host-User-eigen.
EXPOSE 3000
VOLUME ["/data"]

ENTRYPOINT ["./scripts/entry.sh"]
