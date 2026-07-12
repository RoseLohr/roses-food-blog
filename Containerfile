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
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# Schnelltest der nativen Module — schlägt hier gezielt fehl (mit Modulname
# im Log), statt später anonym im Next-Build. sharp wird auf LOW_CPU nie
# geladen und daher dort auch nicht getestet.
RUN node -e "require('better-sqlite3')" && echo "OK better-sqlite3" \
 && node -e "require('@node-rs/argon2')" && echo "OK @node-rs/argon2" \
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
COPY --from=build /app/scripts/entry.sh ./scripts/entry.sh
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
