FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
# sia-storage's npm-published linux-x64-gnu binary uses the upstream
# RECOVERY_PROBABILITY=0.75 constant, which rejects 2-of-6 erasure
# coding (only valid config on Zen testnet's tiny host pool). Replace
# with a 0.90-patched build (see vendor/README.md for provenance).
COPY vendor/sia-storage-linux-x64-gnu/sia-storage.node \
     node_modules/sia-storage-linux-x64-gnu/sia-storage.node
COPY --from=builder /app/dist ./dist/
# Drizzle migrations are loaded at runtime from ./drizzle by migrate.js.
COPY drizzle ./drizzle
RUN mkdir -p /app/uploads /app/transcode-output /app/cache
EXPOSE 3000
# Run idempotent migrations at boot so deploys to fresh DBs Just Work,
# and pre-existing schemas stay untouched (tracked via
# `__drizzle_migrations`).
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
