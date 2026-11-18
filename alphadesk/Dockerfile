# syntax=docker/dockerfile:1.7
# NidhikshDesk container image (multi-stage). Debian slim instead of Alpine so better-sqlite3 and Prisma
# engines use prebuilt glibc binaries.
#   docker build -t nidhikshdesk .                                              # SQLite client (local demo)
#   docker build --build-arg PRISMA_SCHEMA=prisma/postgres/schema.prisma -t nidhikshdesk:pg .   # phase two
ARG NODE_VERSION=22

# ---- deps: install exact lockfile deps (incl. dev deps needed for build, prisma CLI and tsx seed) ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---- build: generate the Prisma client for the chosen schema, then next build ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ARG PRISMA_SCHEMA=prisma/schema.prisma
ENV NEXT_TELEMETRY_DISABLED=1 PRISMA_SCHEMA=${PRISMA_SCHEMA}
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema "$PRISMA_SCHEMA" && npm run build

# ---- runtime ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ARG PRISMA_SCHEMA=prisma/schema.prisma
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4200 PRISMA_SCHEMA=${PRISMA_SCHEMA}
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/tsconfig.json ./
USER node
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4200/api/auth/csrf >/dev/null || exit 1
# Sync schema (idempotent), then serve on all interfaces (npm start binds 127.0.0.1 for local dev only).
CMD ["sh", "-c", "npx prisma db push --skip-generate --schema \"$PRISMA_SCHEMA\" && npx next start -H 0.0.0.0 -p ${PORT}"]
