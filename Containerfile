# ---------------------------------------------------------------------------
# Multi-Stage-Build: deps -> build -> runtime (non-root, standalone)
# Basisimage bookworm-slim (glibc), damit better-sqlite3/sharp/argon2
# als Prebuilds laufen (siehe docs/ASSUMPTIONS.md B17).
# ---------------------------------------------------------------------------
FROM docker.io/library/node:22-bookworm-slim AS deps
WORKDIR /app
# SHARP_WASM=1: sharp als WebAssembly statt nativer Binärdatei installieren.
# Nötig auf CPUs ohne SSE4.2/x86-64-v2 (z. B. VMs mit qemu64/kvm64-CPU-Typ),
# sonst stürzt der Build/Start mit SIGILL ab. deploy.sh erkennt das automatisch.
ARG SHARP_WASM=0
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
 && if [ "$SHARP_WASM" = "1" ]; then \
      echo ">> Installiere sharp als WASM (CPU ohne SSE4.2)"; \
      npm install --no-audit --no-fund --cpu=wasm32 sharp; \
    fi

FROM docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Sicherstellen, dass alle sharp-Laufzeitpakete im Standalone-Output liegen
# (bei WASM-Variante wird @img/sharp-wasm32 gebraucht)
RUN mkdir -p .next/standalone/node_modules/@img \
 && cp -r node_modules/@img/. .next/standalone/node_modules/@img/ 2>/dev/null || true

FROM docker.io/library/node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    HOSTNAME=0.0.0.0 \
    PORT=3000

ARG APP_COMMIT=unbekannt
ENV APP_COMMIT=$APP_COMMIT

# Standalone-Server + statische Assets + Migrations- und Startskripte
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build --chown=node:node /app/scripts/entry.sh ./scripts/entry.sh
RUN chmod +x ./scripts/entry.sh && mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
VOLUME ["/data"]

ENTRYPOINT ["./scripts/entry.sh"]
