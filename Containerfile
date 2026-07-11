# ---------------------------------------------------------------------------
# Multi-Stage-Build: deps -> build -> runtime (non-root, standalone)
# Basisimage bookworm-slim (glibc), damit better-sqlite3/sharp/argon2
# als Prebuilds laufen (siehe docs/ASSUMPTIONS.md B17).
# ---------------------------------------------------------------------------
FROM docker.io/library/node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

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
